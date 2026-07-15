import { randomUUID } from "node:crypto";
import { hasSupabaseAdminConfig, isMySqlDatabase } from "@/lib/config";
import { mysqlExecute, mysqlQuery, parseJson } from "@/lib/mysql";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import type {
  IntegrationConnector,
  IntegrationDeliveryLog,
  IntegrationDeliveryStatus,
  IntegrationDirectoryMember,
  IntegrationHealthStatus,
  IntegrationProvider,
  IntegrationRunStatus,
  IntegrationSyncRun,
  IntegrationUserIdentity
} from "@/lib/integrations/types";

type Row = Record<string, any>;

const memory = {
  connectors: new Map<IntegrationProvider, IntegrationConnector>(),
  members: new Map<string, IntegrationDirectoryMember>(),
  identities: new Map<string, IntegrationUserIdentity>(),
  runs: new Map<string, IntegrationSyncRun>(),
  deliveries: new Map<string, IntegrationDeliveryLog>()
};

export async function listIntegrationConnectors() {
  if (isMySqlDatabase()) {
    const rows = await mysqlQuery<Row[]>("select * from integration_connectors order by provider");
    return rows.map(connectorFromRow);
  }
  const supabase = createSupabaseAdminClient();
  if (supabase && hasSupabaseAdminConfig()) {
    const { data, error } = await supabase.from("integration_connectors").select("*").order("provider");
    if (error) throw new Error(error.message);
    return (data ?? []).map(connectorFromRow);
  }
  seedMemoryConnectors();
  return [...memory.connectors.values()];
}

export async function updateConnectorState(
  provider: IntegrationProvider,
  input: {
    enabled?: boolean;
    health_status?: IntegrationHealthStatus;
    public_config?: Record<string, unknown>;
    last_checked_at?: string | null;
    last_success_at?: string | null;
    last_error?: string | null;
    latency_ms?: number | null;
  }
) {
  const now = new Date().toISOString();
  const current = (await listIntegrationConnectors()).find((item) => item.provider === provider) ?? defaultConnector(provider);
  const next: IntegrationConnector = { ...current, ...input, id: provider, provider, updated_at: now };
  if (isMySqlDatabase()) {
    await mysqlExecute(
      `insert into integration_connectors
        (id, provider, name, enabled, health_status, public_config, last_checked_at, last_success_at, last_error, latency_ms, created_at, updated_at)
       values (:id, :provider, :name, :enabled, :health_status, :public_config, :last_checked_at, :last_success_at, :last_error, :latency_ms, :created_at, :updated_at)
       on duplicate key update enabled=values(enabled), health_status=values(health_status), public_config=values(public_config),
        last_checked_at=values(last_checked_at), last_success_at=values(last_success_at), last_error=values(last_error),
        latency_ms=values(latency_ms), updated_at=values(updated_at)`,
      { ...next, public_config: JSON.stringify(next.public_config) }
    );
    return next;
  }
  const supabase = createSupabaseAdminClient();
  if (supabase && hasSupabaseAdminConfig()) {
    const { data, error } = await supabase.from("integration_connectors").upsert(next).select("*").single();
    if (error) throw new Error(error.message);
    return connectorFromRow(data);
  }
  memory.connectors.set(provider, next);
  return next;
}

export async function startSyncRun(connectorId: IntegrationProvider, operation: string, startedBy: string | null) {
  const record: IntegrationSyncRun = {
    id: `sync-${randomUUID()}`,
    connector_id: connectorId,
    operation,
    status: "running",
    started_by: startedBy,
    total_count: 0,
    success_count: 0,
    matched_count: 0,
    updated_count: 0,
    failed_count: 0,
    error_message: null,
    metadata: {},
    started_at: new Date().toISOString(),
    finished_at: null
  };
  if (isMySqlDatabase()) {
    await mysqlExecute(
      `insert into integration_sync_runs
       (id, connector_id, operation, status, started_by, total_count, success_count, matched_count, updated_count, failed_count, error_message, metadata, started_at, finished_at)
       values (:id, :connector_id, :operation, :status, :started_by, :total_count, :success_count, :matched_count, :updated_count, :failed_count, :error_message, :metadata, :started_at, :finished_at)`,
      { ...record, metadata: JSON.stringify(record.metadata) }
    );
  } else {
    const supabase = createSupabaseAdminClient();
    if (supabase && hasSupabaseAdminConfig()) {
      const { error } = await supabase.from("integration_sync_runs").insert(record);
      if (error) throw new Error(error.message);
    } else memory.runs.set(record.id, record);
  }
  return record;
}

export async function finishSyncRun(
  id: string,
  input: Partial<Pick<IntegrationSyncRun, "total_count" | "success_count" | "matched_count" | "updated_count" | "failed_count" | "error_message" | "metadata">> & { status: IntegrationRunStatus }
) {
  const finishedAt = new Date().toISOString();
  if (isMySqlDatabase()) {
    await mysqlExecute(
      `update integration_sync_runs set status=:status, total_count=:total_count, success_count=:success_count,
       matched_count=:matched_count, updated_count=:updated_count, failed_count=:failed_count, error_message=:error_message,
       metadata=:metadata, finished_at=:finished_at where id=:id`,
      {
        id,
        status: input.status,
        total_count: input.total_count ?? 0,
        success_count: input.success_count ?? 0,
        matched_count: input.matched_count ?? 0,
        updated_count: input.updated_count ?? 0,
        failed_count: input.failed_count ?? 0,
        error_message: input.error_message ?? null,
        metadata: JSON.stringify(input.metadata ?? {}),
        finished_at: finishedAt
      }
    );
  } else {
    const supabase = createSupabaseAdminClient();
    if (supabase && hasSupabaseAdminConfig()) {
      const { error } = await supabase.from("integration_sync_runs").update({ ...input, finished_at: finishedAt }).eq("id", id);
      if (error) throw new Error(error.message);
    } else {
      const current = memory.runs.get(id);
      if (current) memory.runs.set(id, { ...current, ...input, finished_at: finishedAt });
    }
  }
  return (await listSyncRuns(100)).find((item) => item.id === id) ?? null;
}

export async function upsertDirectoryMember(input: Omit<IntegrationDirectoryMember, "id" | "created_at" | "updated_at">) {
  const now = new Date().toISOString();
  const record: IntegrationDirectoryMember = {
    id: `directory-${input.connector_id}-${stableExternalId(input.external_user_id)}`,
    created_at: now,
    updated_at: now,
    ...input
  };
  if (isMySqlDatabase()) {
    await mysqlExecute(
      `insert into integration_directory_members
       (id, connector_id, external_user_id, name, email, mobile_masked, department_ids, department_names, position, status, matched_user_id, metadata, synced_at, created_at, updated_at)
       values (:id, :connector_id, :external_user_id, :name, :email, :mobile_masked, :department_ids, :department_names, :position, :status, :matched_user_id, :metadata, :synced_at, :created_at, :updated_at)
       on duplicate key update name=values(name), email=values(email), mobile_masked=values(mobile_masked),
       department_ids=values(department_ids), department_names=values(department_names), position=values(position), status=values(status),
       matched_user_id=values(matched_user_id), metadata=values(metadata), synced_at=values(synced_at), updated_at=values(updated_at)`,
      {
        ...record,
        department_ids: JSON.stringify(record.department_ids),
        department_names: JSON.stringify(record.department_names),
        metadata: JSON.stringify(record.metadata)
      }
    );
  } else {
    const supabase = createSupabaseAdminClient();
    if (supabase && hasSupabaseAdminConfig()) {
      const { error } = await supabase.from("integration_directory_members").upsert(record, { onConflict: "connector_id,external_user_id" });
      if (error) throw new Error(error.message);
    } else memory.members.set(`${record.connector_id}:${record.external_user_id}`, record);
  }
  return record;
}

export async function upsertUserIdentity(input: Omit<IntegrationUserIdentity, "id" | "created_at" | "updated_at">) {
  const now = new Date().toISOString();
  const record: IntegrationUserIdentity = {
    id: `identity-${input.connector_id}-${stableExternalId(input.user_id)}`,
    created_at: now,
    updated_at: now,
    ...input
  };
  if (isMySqlDatabase()) {
    await mysqlExecute(
      `insert into integration_user_identities
       (id, connector_id, user_id, external_user_id, external_login, external_email, binding_source, status, verified_at, last_synced_at, metadata, created_at, updated_at)
       values (:id, :connector_id, :user_id, :external_user_id, :external_login, :external_email, :binding_source, :status, :verified_at, :last_synced_at, :metadata, :created_at, :updated_at)
       on duplicate key update external_user_id=values(external_user_id), external_login=values(external_login), external_email=values(external_email),
       binding_source=values(binding_source), status=values(status), verified_at=values(verified_at), last_synced_at=values(last_synced_at),
       metadata=values(metadata), updated_at=values(updated_at)`,
      { ...record, metadata: JSON.stringify(record.metadata) }
    );
  } else {
    const supabase = createSupabaseAdminClient();
    if (supabase && hasSupabaseAdminConfig()) {
      const { error } = await supabase.from("integration_user_identities").upsert(record, { onConflict: "connector_id,user_id" });
      if (error) throw new Error(error.message);
    } else memory.identities.set(`${record.connector_id}:${record.user_id}`, record);
  }
  return record;
}

export async function markMissingDirectoryMembers(connectorId: IntegrationProvider, activeExternalIds: Set<string>) {
  const current = await listDirectoryMembers({ connectorId, limit: 5000 });
  const missing = current.filter((item) => item.status !== "missing" && !activeExternalIds.has(item.external_user_id));
  for (const item of missing) {
    await upsertDirectoryMember({ ...item, status: "missing" });
  }
  return missing.length;
}

export async function listDirectoryMembers(options: { connectorId?: IntegrationProvider; limit?: number } = {}) {
  const limit = Math.min(Math.max(options.limit ?? 500, 1), 5000);
  if (isMySqlDatabase()) {
    const rows = await mysqlQuery<Row[]>(
      `select * from integration_directory_members ${options.connectorId ? "where connector_id=:connectorId" : ""} order by updated_at desc limit ${limit}`,
      options.connectorId ? { connectorId: options.connectorId } : undefined
    );
    return rows.map(directoryMemberFromRow);
  }
  const supabase = createSupabaseAdminClient();
  if (supabase && hasSupabaseAdminConfig()) {
    let query = supabase.from("integration_directory_members").select("*").order("updated_at", { ascending: false }).limit(limit);
    if (options.connectorId) query = query.eq("connector_id", options.connectorId);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return (data ?? []).map(directoryMemberFromRow);
  }
  return [...memory.members.values()].filter((item) => !options.connectorId || item.connector_id === options.connectorId).slice(0, limit);
}

export async function listUserIdentities(limit = 1000) {
  const safeLimit = Math.min(Math.max(limit, 1), 5000);
  if (isMySqlDatabase()) {
    return (await mysqlQuery<Row[]>(`select * from integration_user_identities order by updated_at desc limit ${safeLimit}`)).map(identityFromRow);
  }
  const supabase = createSupabaseAdminClient();
  if (supabase && hasSupabaseAdminConfig()) {
    const { data, error } = await supabase.from("integration_user_identities").select("*").order("updated_at", { ascending: false }).limit(safeLimit);
    if (error) throw new Error(error.message);
    return (data ?? []).map(identityFromRow);
  }
  return [...memory.identities.values()].slice(0, safeLimit);
}

export async function listSyncRuns(limit = 50) {
  const safeLimit = Math.min(Math.max(limit, 1), 200);
  if (isMySqlDatabase()) {
    return (await mysqlQuery<Row[]>(`select * from integration_sync_runs order by started_at desc limit ${safeLimit}`)).map(syncRunFromRow);
  }
  const supabase = createSupabaseAdminClient();
  if (supabase && hasSupabaseAdminConfig()) {
    const { data, error } = await supabase.from("integration_sync_runs").select("*").order("started_at", { ascending: false }).limit(safeLimit);
    if (error) throw new Error(error.message);
    return (data ?? []).map(syncRunFromRow);
  }
  return [...memory.runs.values()].sort((a, b) => b.started_at.localeCompare(a.started_at)).slice(0, safeLimit);
}

export async function createDeliveryLog(input: Omit<IntegrationDeliveryLog, "id" | "created_at" | "updated_at">) {
  const now = new Date().toISOString();
  const record: IntegrationDeliveryLog = { id: `delivery-${randomUUID()}`, created_at: now, updated_at: now, ...input };
  if (isMySqlDatabase()) {
    await mysqlExecute(
      `insert into integration_delivery_logs
       (id, connector_id, channel, notification_id, dedupe_key, recipient_user_id, recipient_masked, subject, status, latency_ms, error_message, metadata, created_at, updated_at)
       values (:id, :connector_id, :channel, :notification_id, :dedupe_key, :recipient_user_id, :recipient_masked, :subject, :status, :latency_ms, :error_message, :metadata, :created_at, :updated_at)
       on duplicate key update id=id`,
      { ...record, metadata: JSON.stringify(record.metadata) }
    );
    if (record.notification_id) {
      const existing = await findDeliveryByNotification(record.connector_id, record.channel, record.notification_id);
      return existing ?? record;
    }
  } else {
    const supabase = createSupabaseAdminClient();
    if (supabase && hasSupabaseAdminConfig()) {
      const { data, error } = await supabase.from("integration_delivery_logs").upsert(record, { onConflict: "connector_id,channel,notification_id", ignoreDuplicates: true }).select("*").maybeSingle();
      if (error) throw new Error(error.message);
      if (data) return deliveryFromRow(data);
      if (record.notification_id) return (await findDeliveryByNotification(record.connector_id, record.channel, record.notification_id)) ?? record;
    } else memory.deliveries.set(record.id, record);
  }
  return record;
}

export async function updateDeliveryLog(id: string, status: IntegrationDeliveryStatus, input: { latency_ms?: number | null; error_message?: string | null; metadata?: Record<string, unknown> } = {}) {
  const updatedAt = new Date().toISOString();
  if (isMySqlDatabase()) {
    await mysqlExecute(
      "update integration_delivery_logs set status=:status, latency_ms=:latency_ms, error_message=:error_message, metadata=:metadata, updated_at=:updated_at where id=:id",
      { id, status, latency_ms: input.latency_ms ?? null, error_message: input.error_message ?? null, metadata: JSON.stringify(input.metadata ?? {}), updated_at: updatedAt }
    );
  } else {
    const supabase = createSupabaseAdminClient();
    if (supabase && hasSupabaseAdminConfig()) {
      const { error } = await supabase.from("integration_delivery_logs").update({ status, ...input, updated_at: updatedAt }).eq("id", id);
      if (error) throw new Error(error.message);
    } else {
      const current = memory.deliveries.get(id);
      if (current) memory.deliveries.set(id, { ...current, status, ...input, updated_at: updatedAt });
    }
  }
}

export async function findDeliveryByNotification(connectorId: IntegrationProvider, channel: string, notificationId: string) {
  if (isMySqlDatabase()) {
    const rows = await mysqlQuery<Row[]>(
      "select * from integration_delivery_logs where connector_id=:connectorId and channel=:channel and notification_id=:notificationId limit 1",
      { connectorId, channel, notificationId }
    );
    return rows[0] ? deliveryFromRow(rows[0]) : null;
  }
  const supabase = createSupabaseAdminClient();
  if (supabase && hasSupabaseAdminConfig()) {
    const { data, error } = await supabase.from("integration_delivery_logs").select("*").eq("connector_id", connectorId).eq("channel", channel).eq("notification_id", notificationId).maybeSingle();
    if (error) throw new Error(error.message);
    return data ? deliveryFromRow(data) : null;
  }
  return [...memory.deliveries.values()].find((item) => item.connector_id === connectorId && item.channel === channel && item.notification_id === notificationId) ?? null;
}

export async function listDeliveryLogs(limit = 100) {
  const safeLimit = Math.min(Math.max(limit, 1), 500);
  if (isMySqlDatabase()) {
    return (await mysqlQuery<Row[]>(`select * from integration_delivery_logs order by created_at desc limit ${safeLimit}`)).map(deliveryFromRow);
  }
  const supabase = createSupabaseAdminClient();
  if (supabase && hasSupabaseAdminConfig()) {
    const { data, error } = await supabase.from("integration_delivery_logs").select("*").order("created_at", { ascending: false }).limit(safeLimit);
    if (error) throw new Error(error.message);
    return (data ?? []).map(deliveryFromRow);
  }
  return [...memory.deliveries.values()].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, safeLimit);
}

function defaultConnector(provider: IntegrationProvider): IntegrationConnector {
  const now = new Date().toISOString();
  return { id: provider, provider, name: provider === "wecom" ? "企业微信" : "Winmail 邮件", enabled: false, health_status: "unconfigured", public_config: {}, last_checked_at: null, last_success_at: null, last_error: null, latency_ms: null, created_at: now, updated_at: now };
}

function seedMemoryConnectors() {
  for (const provider of ["wecom", "winmail"] as const) if (!memory.connectors.has(provider)) memory.connectors.set(provider, defaultConnector(provider));
}

function connectorFromRow(row: Row): IntegrationConnector {
  return { ...row, enabled: Boolean(row.enabled), public_config: parseJson(row.public_config, {}) } as IntegrationConnector;
}
function directoryMemberFromRow(row: Row): IntegrationDirectoryMember {
  return { ...row, department_ids: parseJson(row.department_ids, []), department_names: parseJson(row.department_names, []), metadata: parseJson(row.metadata, {}) } as unknown as IntegrationDirectoryMember;
}
function identityFromRow(row: Row): IntegrationUserIdentity {
  return { ...row, metadata: parseJson(row.metadata, {}) } as IntegrationUserIdentity;
}
function syncRunFromRow(row: Row): IntegrationSyncRun {
  return { ...row, metadata: parseJson(row.metadata, {}) } as IntegrationSyncRun;
}
function deliveryFromRow(row: Row): IntegrationDeliveryLog {
  return { ...row, metadata: parseJson(row.metadata, {}) } as IntegrationDeliveryLog;
}
function stableExternalId(value: string) {
  return Buffer.from(value).toString("base64url").slice(0, 72);
}
