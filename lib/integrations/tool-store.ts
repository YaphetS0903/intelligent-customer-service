import { randomUUID } from "node:crypto";
import { hasSupabaseAdminConfig, isMySqlDatabase } from "@/lib/config";
import { mysqlExecute, mysqlQuery, parseJson, toIsoString } from "@/lib/mysql";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import type {
  IntegrationTool,
  IntegrationToolExecution,
  IntegrationToolExecutionStatus,
  IntegrationUserCredential
} from "@/lib/integrations/types";

type Row = Record<string, any>;

const memory = {
  tools: new Map<string, IntegrationTool>(),
  executions: new Map<string, IntegrationToolExecution>(),
  credentials: new Map<string, IntegrationUserCredential>()
};

export async function upsertIntegrationTool(input: Omit<IntegrationTool, "created_at" | "updated_at">) {
  const now = new Date().toISOString();
  const record: IntegrationTool = { ...input, created_at: now, updated_at: now };
  if (isMySqlDatabase()) {
    await mysqlExecute(
      `insert into integration_tools
       (id, connector_id, name, description, status, risk_level, allowed_roles, data_scope, input_schema, timeout_ms, metadata, created_at, updated_at)
       values (:id, :connector_id, :name, :description, :status, :risk_level, :allowed_roles, :data_scope, :input_schema, :timeout_ms, :metadata, :created_at, :updated_at)
       on duplicate key update connector_id=values(connector_id), name=values(name), description=values(description),
       risk_level=values(risk_level), data_scope=values(data_scope), input_schema=values(input_schema),
       metadata=values(metadata), updated_at=values(updated_at)`,
      {
        ...record,
        allowed_roles: JSON.stringify(record.allowed_roles),
        input_schema: JSON.stringify(record.input_schema),
        metadata: JSON.stringify(record.metadata)
      }
    );
    return (await getIntegrationTool(record.id)) ?? record;
  }
  const supabase = createSupabaseAdminClient();
  if (supabase && hasSupabaseAdminConfig()) {
    const { data: existing, error: readError } = await supabase.from("integration_tools").select("*").eq("id", record.id).maybeSingle();
    if (readError) throw new Error(readError.message);
    const next = existing ? { ...record, status: existing.status, allowed_roles: existing.allowed_roles, timeout_ms: existing.timeout_ms, created_at: existing.created_at } : record;
    const { data, error } = await supabase.from("integration_tools").upsert(next).select("*").single();
    if (error) throw new Error(error.message);
    return toolFromRow(data);
  }
  const existing = memory.tools.get(record.id);
  const next = existing ? { ...record, status: existing.status, allowed_roles: existing.allowed_roles, timeout_ms: existing.timeout_ms, created_at: existing.created_at } : record;
  memory.tools.set(record.id, next);
  return next;
}

export async function listIntegrationTools() {
  if (isMySqlDatabase()) return (await mysqlQuery<Row[]>("select * from integration_tools order by connector_id, id")).map(toolFromRow);
  const supabase = createSupabaseAdminClient();
  if (supabase && hasSupabaseAdminConfig()) {
    const { data, error } = await supabase.from("integration_tools").select("*").order("connector_id").order("id");
    if (error) throw new Error(error.message);
    return (data ?? []).map(toolFromRow);
  }
  return [...memory.tools.values()];
}

export async function getIntegrationTool(id: string) {
  if (isMySqlDatabase()) {
    const rows = await mysqlQuery<Row[]>("select * from integration_tools where id=:id limit 1", { id });
    return rows[0] ? toolFromRow(rows[0]) : null;
  }
  const supabase = createSupabaseAdminClient();
  if (supabase && hasSupabaseAdminConfig()) {
    const { data, error } = await supabase.from("integration_tools").select("*").eq("id", id).maybeSingle();
    if (error) throw new Error(error.message);
    return data ? toolFromRow(data) : null;
  }
  return memory.tools.get(id) ?? null;
}

export async function updateIntegrationTool(id: string, input: Pick<IntegrationTool, "status" | "allowed_roles" | "timeout_ms">) {
  const updatedAt = new Date().toISOString();
  if (isMySqlDatabase()) {
    await mysqlExecute(
      "update integration_tools set status=:status, allowed_roles=:allowed_roles, timeout_ms=:timeout_ms, updated_at=:updated_at where id=:id",
      { id, ...input, allowed_roles: JSON.stringify(input.allowed_roles), updated_at: updatedAt }
    );
    return getIntegrationTool(id);
  }
  const supabase = createSupabaseAdminClient();
  if (supabase && hasSupabaseAdminConfig()) {
    const { data, error } = await supabase.from("integration_tools").update({ ...input, updated_at: updatedAt }).eq("id", id).select("*").maybeSingle();
    if (error) throw new Error(error.message);
    return data ? toolFromRow(data) : null;
  }
  const current = memory.tools.get(id);
  if (!current) return null;
  const next = { ...current, ...input, updated_at: updatedAt };
  memory.tools.set(id, next);
  return next;
}

export async function startToolExecution(input: Omit<IntegrationToolExecution, "id" | "status" | "result_summary" | "error_code" | "error_message" | "latency_ms" | "started_at" | "finished_at">) {
  const record: IntegrationToolExecution = {
    id: `toolrun-${randomUUID()}`,
    status: "running",
    result_summary: {},
    error_code: null,
    error_message: null,
    latency_ms: null,
    started_at: new Date().toISOString(),
    finished_at: null,
    ...input
  };
  if (isMySqlDatabase()) {
    await mysqlExecute(
      `insert into integration_tool_executions
       (id, tool_id, connector_id, user_id, conversation_id, assistant_message_id, source, status, input_summary, result_summary, error_code, error_message, latency_ms, started_at, finished_at)
       values (:id, :tool_id, :connector_id, :user_id, :conversation_id, :assistant_message_id, :source, :status, :input_summary, :result_summary, :error_code, :error_message, :latency_ms, :started_at, :finished_at)`,
      { ...record, input_summary: JSON.stringify(record.input_summary), result_summary: JSON.stringify(record.result_summary) }
    );
  } else {
    const supabase = createSupabaseAdminClient();
    if (supabase && hasSupabaseAdminConfig()) {
      const { error } = await supabase.from("integration_tool_executions").insert(record);
      if (error) throw new Error(error.message);
    } else memory.executions.set(record.id, record);
  }
  return record;
}

export async function finishToolExecution(id: string, input: {
  status: IntegrationToolExecutionStatus;
  result_summary?: Record<string, unknown>;
  error_code?: string | null;
  error_message?: string | null;
  latency_ms: number;
  assistant_message_id?: string | null;
}) {
  const finishedAt = new Date().toISOString();
  const values = { result_summary: input.result_summary ?? {}, error_code: input.error_code ?? null, error_message: input.error_message ?? null, assistant_message_id: input.assistant_message_id ?? null };
  if (isMySqlDatabase()) {
    await mysqlExecute(
      `update integration_tool_executions set status=:status, result_summary=:result_summary, error_code=:error_code,
       error_message=:error_message, latency_ms=:latency_ms, assistant_message_id=coalesce(:assistant_message_id, assistant_message_id), finished_at=:finished_at where id=:id`,
      { id, ...input, ...values, result_summary: JSON.stringify(values.result_summary), finished_at: finishedAt }
    );
  } else {
    const supabase = createSupabaseAdminClient();
    if (supabase && hasSupabaseAdminConfig()) {
      const { error } = await supabase.from("integration_tool_executions").update({ ...input, ...values, finished_at: finishedAt }).eq("id", id);
      if (error) throw new Error(error.message);
    } else {
      const current = memory.executions.get(id);
      if (current) memory.executions.set(id, { ...current, ...input, ...values, finished_at: finishedAt });
    }
  }
}

export async function linkToolExecutionMessage(id: string, assistantMessageId: string) {
  if (isMySqlDatabase()) return mysqlExecute("update integration_tool_executions set assistant_message_id=:assistantMessageId where id=:id", { id, assistantMessageId });
  const supabase = createSupabaseAdminClient();
  if (supabase && hasSupabaseAdminConfig()) {
    const { error } = await supabase.from("integration_tool_executions").update({ assistant_message_id: assistantMessageId }).eq("id", id);
    if (error) throw new Error(error.message);
    return;
  }
  const current = memory.executions.get(id);
  if (current) memory.executions.set(id, { ...current, assistant_message_id: assistantMessageId });
}

export async function listToolExecutions(limit = 100) {
  const safeLimit = Math.min(Math.max(limit, 1), 500);
  if (isMySqlDatabase()) return (await mysqlQuery<Row[]>(`select * from integration_tool_executions order by started_at desc limit ${safeLimit}`)).map(executionFromRow);
  const supabase = createSupabaseAdminClient();
  if (supabase && hasSupabaseAdminConfig()) {
    const { data, error } = await supabase.from("integration_tool_executions").select("*").order("started_at", { ascending: false }).limit(safeLimit);
    if (error) throw new Error(error.message);
    return (data ?? []).map(executionFromRow);
  }
  return [...memory.executions.values()].sort((a, b) => b.started_at.localeCompare(a.started_at)).slice(0, safeLimit);
}

export async function upsertUserCredential(input: Omit<IntegrationUserCredential, "id" | "created_at" | "updated_at">) {
  const now = new Date().toISOString();
  const record: IntegrationUserCredential = { id: `credential-${input.connector_id}-${input.user_id}`, created_at: now, updated_at: now, ...input };
  if (isMySqlDatabase()) {
    await mysqlExecute(
      `insert into integration_user_credentials (id, connector_id, user_id, encrypted_secret, key_version, last_verified_at, created_at, updated_at)
       values (:id, :connector_id, :user_id, :encrypted_secret, :key_version, :last_verified_at, :created_at, :updated_at)
       on duplicate key update encrypted_secret=values(encrypted_secret), key_version=values(key_version), last_verified_at=values(last_verified_at), updated_at=values(updated_at)`,
      record
    );
    return record;
  }
  const supabase = createSupabaseAdminClient();
  if (supabase && hasSupabaseAdminConfig()) {
    const { data, error } = await supabase.from("integration_user_credentials").upsert(record, { onConflict: "connector_id,user_id" }).select("*").single();
    if (error) throw new Error(error.message);
    return credentialFromRow(data);
  }
  const existing = memory.credentials.get(`${record.connector_id}:${record.user_id}`);
  const next = { ...record, created_at: existing?.created_at ?? record.created_at };
  memory.credentials.set(`${record.connector_id}:${record.user_id}`, next);
  return next;
}

export async function findUserCredential(connectorId: string, userId: string) {
  if (isMySqlDatabase()) {
    const rows = await mysqlQuery<Row[]>("select * from integration_user_credentials where connector_id=:connectorId and user_id=:userId limit 1", { connectorId, userId });
    return rows[0] ? credentialFromRow(rows[0]) : null;
  }
  const supabase = createSupabaseAdminClient();
  if (supabase && hasSupabaseAdminConfig()) {
    const { data, error } = await supabase.from("integration_user_credentials").select("*").eq("connector_id", connectorId).eq("user_id", userId).maybeSingle();
    if (error) throw new Error(error.message);
    return data ? credentialFromRow(data) : null;
  }
  return memory.credentials.get(`${connectorId}:${userId}`) ?? null;
}

export async function deleteUserCredential(connectorId: string, userId: string) {
  if (isMySqlDatabase()) return mysqlExecute("delete from integration_user_credentials where connector_id=:connectorId and user_id=:userId", { connectorId, userId });
  const supabase = createSupabaseAdminClient();
  if (supabase && hasSupabaseAdminConfig()) {
    const { error } = await supabase.from("integration_user_credentials").delete().eq("connector_id", connectorId).eq("user_id", userId);
    if (error) throw new Error(error.message);
    return;
  }
  memory.credentials.delete(`${connectorId}:${userId}`);
}

function toolFromRow(row: Row): IntegrationTool {
  return {
    id: String(row.id),
    connector_id: row.connector_id,
    name: String(row.name),
    description: String(row.description),
    status: row.status,
    risk_level: row.risk_level,
    allowed_roles: parseJson<string[]>(row.allowed_roles, []),
    data_scope: row.data_scope,
    input_schema: parseJson<Record<string, unknown>>(row.input_schema, {}),
    timeout_ms: Number(row.timeout_ms),
    metadata: parseJson<Record<string, unknown>>(row.metadata, {}),
    created_at: toIsoString(row.created_at),
    updated_at: toIsoString(row.updated_at)
  };
}

function executionFromRow(row: Row): IntegrationToolExecution {
  return { ...row, input_summary: parseJson(row.input_summary, {}), result_summary: parseJson(row.result_summary, {}), latency_ms: row.latency_ms === null ? null : Number(row.latency_ms), started_at: toIsoString(row.started_at), finished_at: row.finished_at ? toIsoString(row.finished_at) : null } as IntegrationToolExecution;
}

function credentialFromRow(row: Row): IntegrationUserCredential {
  return { ...row, key_version: Number(row.key_version), last_verified_at: row.last_verified_at ? toIsoString(row.last_verified_at) : null, created_at: toIsoString(row.created_at), updated_at: toIsoString(row.updated_at) } as IntegrationUserCredential;
}
