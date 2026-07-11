import mysql from "mysql2/promise";
import { env, hasMySqlConfig } from "@/lib/config";

let pool: mysql.Pool | null = null;
let schemaReady: Promise<void> | null = null;
const isoDatePattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const mysqlQueryAttempts = readPositiveInt(process.env.MYSQL_QUERY_ATTEMPTS, 2);
const mysqlQueryTimeoutMs = readPositiveInt(process.env.MYSQL_QUERY_TIMEOUT_MS, 6000);
const mysqlConnectTimeoutMs = readPositiveInt(
  process.env.MYSQL_CONNECT_TIMEOUT_MS,
  Math.min(mysqlQueryTimeoutMs, 5000)
);
const mysqlConnectionLimit = readPositiveInt(process.env.MYSQL_CONNECTION_LIMIT, 6);
const mysqlPoolRetireDelayMs = Math.max(mysqlQueryTimeoutMs * 2, 15_000);
const transientMySqlErrorCodes = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "EPIPE",
  "ETIMEDOUT",
  "PROTOCOL_CONNECTION_LOST",
  "PROTOCOL_SEQUENCE_TIMEOUT",
  "PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR"
]);

export function getMySqlPool() {
  if (!hasMySqlConfig()) {
    return null;
  }

  pool ??= mysql.createPool({
    host: env.mysqlHost,
    port: env.mysqlPort,
    database: env.mysqlDatabase,
    user: env.mysqlUser,
    password: env.mysqlPassword,
    waitForConnections: true,
    connectionLimit: mysqlConnectionLimit,
    connectTimeout: mysqlConnectTimeoutMs,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0,
    namedPlaceholders: true,
    timezone: "Z"
  });

  return pool;
}

export async function ensureMySqlSchema() {
  if (process.env.MYSQL_AUTO_MIGRATE === "false") {
    return;
  }

  const db = getMySqlPool();
  if (!db) {
    return;
  }

  schemaReady ??= createSchema(db);
  try {
    await schemaReady;
  } catch (error) {
    schemaReady = null;

    if (isTransientMySqlError(error)) {
      await resetMySqlPool(db);
    }

    throw error;
  }
}

export async function mysqlQuery<T = any>(sql: string, params?: Record<string, unknown> | unknown[]) {
  return runMySqlOperation(async (db) => {
    const [rows] = await db.query(queryOptions(sql), normalizeParams(params) as any);
    return rows as T;
  });
}

export async function mysqlExecute(sql: string, params?: Record<string, unknown> | unknown[]) {
  return runMySqlOperation(async (db) => {
    const [result] = await db.execute(queryOptions(sql), normalizeParams(params) as any);
    return result;
  });
}

export async function mysqlBatchQuery(
  queries: Array<{ sql: string; params?: Record<string, unknown> | unknown[] }>
) {
  await ensureMySqlSchema();
  let lastError: unknown;

  for (let attempt = 1; attempt <= Math.max(mysqlQueryAttempts, 3); attempt += 1) {
    let connection: mysql.Connection | null = null;
    try {
      connection = await mysql.createConnection({
        host: env.mysqlHost,
        port: env.mysqlPort,
        database: env.mysqlDatabase,
        user: env.mysqlUser,
        password: env.mysqlPassword,
        connectTimeout: mysqlConnectTimeoutMs,
        enableKeepAlive: true,
        keepAliveInitialDelay: 0,
        namedPlaceholders: true,
        multipleStatements: true,
        timezone: "Z"
      });
      if (queries.every((query) => !query.params)) {
        const [rows] = await connection.query({
          sql: queries.map((query) => query.sql).join(";\n"),
          timeout: Math.max(mysqlQueryTimeoutMs, 30_000)
        });
        return rows as unknown[];
      }
      const results: unknown[] = [];
      for (const query of queries) {
        const [rows] = await connection.query(
          queryOptions(query.sql),
          normalizeParams(query.params) as any
        );
        results.push(rows);
      }
      return results;
    } catch (error) {
      lastError = error;
      if (!isTransientMySqlError(error) || attempt >= Math.max(mysqlQueryAttempts, 3)) {
        throw error;
      }
      await sleep(Math.min(300 * attempt, 1000));
    } finally {
      if (connection) {
        await connection.end().catch(() => undefined);
      }
    }
  }

  throw lastError;
}

async function runMySqlOperation<T>(operation: (db: mysql.Pool) => Promise<T>) {
  let lastError: unknown;

  for (let attempt = 1; attempt <= mysqlQueryAttempts; attempt += 1) {
    try {
      await ensureMySqlSchema();
      const db = getMySqlPool();

      if (!db) {
        throw new Error("MySQL 未配置");
      }

      return await operation(db);
    } catch (error) {
      lastError = error;

      if (!isTransientMySqlError(error) || attempt >= mysqlQueryAttempts) {
        throw error;
      }

      await resetMySqlPool();
      await sleep(Math.min(250 * attempt, 1000));
    }
  }

  throw lastError;
}

function queryOptions(sql: string) {
  return {
    sql,
    timeout: mysqlQueryTimeoutMs
  };
}

async function resetMySqlPool(expectedPool?: mysql.Pool) {
  const currentPool = pool;
  schemaReady = null;

  if (!currentPool) {
    return;
  }

  if (expectedPool && expectedPool !== currentPool) {
    return;
  }

  pool = null;

  const retireTimer = setTimeout(() => {
    void currentPool.end().catch((error) => {
      console.error("[mysql:reset]", error);
    });
  }, mysqlPoolRetireDelayMs);
  retireTimer.unref();
}

function isTransientMySqlError(error: unknown) {
  if (!error || typeof error !== "object") {
    return false;
  }

  const code = "code" in error ? String(error.code) : "";
  const fatal = "fatal" in error ? Boolean(error.fatal) : false;
  const message = "message" in error ? String(error.message) : "";

  return (
    fatal ||
    transientMySqlErrorCodes.has(code) ||
    message.includes("Pool is closed") ||
    message.includes("Query inactivity timeout") ||
    message.includes("Can't add new command when connection is in closed state")
  );
}

function readPositiveInt(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeParams(params?: Record<string, unknown> | unknown[]) {
  if (!params) {
    return params;
  }

  if (Array.isArray(params)) {
    return params.map(normalizeParamValue);
  }

  return Object.fromEntries(
    Object.entries(params).map(([key, value]) => [key, normalizeParamValue(value)])
  );
}

function normalizeParamValue(value: unknown): unknown {
  if (value instanceof Date) {
    return formatMySqlDateTime(value);
  }

  if (typeof value === "string" && isoDatePattern.test(value)) {
    return formatMySqlDateTime(new Date(value));
  }

  return value;
}

function formatMySqlDateTime(date: Date) {
  return date.toISOString().slice(0, 19).replace("T", " ");
}

async function createSchema(db: mysql.Pool) {
  const statements = [
    `create table if not exists users (
      id varchar(128) primary key,
      email varchar(255) not null,
      name varchar(255) not null,
      role varchar(32) not null default 'employee',
      department varchar(255) not null default '',
      position varchar(255) not null default '',
      security_clearance varchar(32) not null default 'internal',
      password_hash text null,
      status varchar(32) not null default 'active',
      auth_provider varchar(64) null,
      external_subject varchar(255) null,
      last_login_at datetime null,
      created_at datetime not null default current_timestamp
    )`,
    `create table if not exists knowledge_bases (
      id varchar(128) primary key,
      name varchar(255) not null,
      description text null,
      openai_vector_store_id varchar(255) null,
      visibility varchar(32) not null default 'all',
      departments json not null,
      positions json null,
      created_by varchar(128) null,
      created_at datetime not null default current_timestamp
    )`,
    `create table if not exists documents (
      id varchar(128) primary key,
      knowledge_base_id varchar(128) not null,
      title varchar(255) not null,
      file_name varchar(255) not null,
      file_type varchar(255) not null,
      storage_path text null,
      openai_file_id varchar(255) null,
      status varchar(32) not null default 'uploading',
      department varchar(255) null,
      tags json not null,
      security_level varchar(32) not null default 'internal',
      publish_status varchar(32) not null default 'published',
      acl_departments json null,
      acl_positions json null,
      acl_roles json null,
      acl_users json null,
      approved_by varchar(128) null,
      approved_at datetime null,
      published_by varchar(128) null,
      published_at datetime null,
      published_version_id varchar(128) null,
      published_version int null,
      created_by varchar(128) null,
      created_at datetime not null default current_timestamp,
      updated_at datetime not null default current_timestamp,
      index documents_knowledge_base_id_idx (knowledge_base_id)
    )`,
    `create table if not exists document_reviewer_assignments (
      id varchar(128) primary key,
      user_id varchar(128) not null,
      reviewer_type varchar(64) not null,
      knowledge_base_ids json not null,
      departments json not null,
      security_levels json not null,
      can_review tinyint(1) not null default 1,
      can_publish tinyint(1) not null default 0,
      active tinyint(1) not null default 1,
      created_by varchar(128) null,
      created_at datetime not null default current_timestamp,
      updated_at datetime not null default current_timestamp,
      index document_reviewer_assignments_user_idx (user_id),
      index document_reviewer_assignments_type_idx (reviewer_type),
      index document_reviewer_assignments_active_idx (active)
    )`,
    `create table if not exists document_approval_requests (
      id varchar(128) primary key,
      document_id varchar(128) not null,
      document_version_id varchar(128) null,
      status varchar(32) not null default 'pending',
      active_key varchar(16) null,
      submitted_by varchar(128) not null,
      submitted_at datetime not null,
      reviewed_by varchar(128) null,
      reviewed_at datetime null,
      review_comment text null,
      published_by varchar(128) null,
      published_at datetime null,
      withdrawn_by varchar(128) null,
      withdrawn_at datetime null,
      created_at datetime not null default current_timestamp,
      updated_at datetime not null default current_timestamp,
      index document_approval_requests_document_idx (document_id),
      index document_approval_requests_status_idx (status),
      index document_approval_requests_submitter_idx (submitted_by),
      index document_approval_requests_updated_idx (updated_at)
      ,unique index document_approval_requests_active_unique_idx (document_id, active_key)
    )`,
    `create table if not exists document_approval_events (
      id varchar(128) primary key,
      request_id varchar(128) null,
      document_id varchar(128) not null,
      action varchar(64) not null,
      actor_id varchar(128) not null,
      actor_name varchar(255) not null,
      actor_role varchar(32) not null,
      comment text null,
      from_status varchar(32) null,
      to_status varchar(32) null,
      metadata json not null,
      created_at datetime not null default current_timestamp,
      index document_approval_events_request_idx (request_id),
      index document_approval_events_document_idx (document_id),
      index document_approval_events_actor_idx (actor_id),
      index document_approval_events_created_idx (created_at)
    )`,
    `create table if not exists document_permission_templates (
      id varchar(128) primary key,
      name varchar(255) not null,
      description text null,
      security_level varchar(32) not null default 'internal',
      acl_departments json not null,
      acl_positions json not null,
      acl_roles json not null,
      acl_users json not null,
      created_by varchar(128) null,
      created_at datetime not null default current_timestamp,
      updated_at datetime not null default current_timestamp,
      unique index document_permission_templates_name_idx (name)
    )`,
    `create table if not exists document_chunks (
      id varchar(128) primary key,
      document_id varchar(128) not null,
      knowledge_base_id varchar(128) not null,
      chunk_index int not null,
      content mediumtext not null,
      token_estimate int not null default 0,
      metadata json not null,
      created_at datetime not null default current_timestamp,
      index document_chunks_document_id_idx (document_id),
      index document_chunks_knowledge_base_id_idx (knowledge_base_id),
      fulltext index document_chunks_content_ft_idx (content)
    )`,
    `create table if not exists document_versions (
      id varchar(128) primary key,
      document_id varchar(128) null,
      knowledge_base_id varchar(128) not null,
      version int not null,
      title varchar(255) not null,
      file_name varchar(255) not null,
      file_type varchar(255) not null,
      status varchar(32) not null default 'uploading',
      change_note text null,
      created_by varchar(128) null,
      created_at datetime not null default current_timestamp,
      index document_versions_document_id_idx (document_id),
      index document_versions_knowledge_base_id_idx (knowledge_base_id),
      unique index document_versions_document_version_unique_idx (document_id, version)
    )`,
    `create table if not exists document_version_chunks (
      id varchar(128) primary key,
      document_version_id varchar(128) not null,
      document_id varchar(128) null,
      knowledge_base_id varchar(128) not null,
      chunk_index int not null,
      content mediumtext not null,
      token_estimate int not null default 0,
      metadata json not null,
      created_at datetime not null default current_timestamp,
      index document_version_chunks_version_idx (document_version_id),
      index document_version_chunks_document_id_idx (document_id),
      index document_version_chunks_knowledge_base_id_idx (knowledge_base_id)
    )`,
    `create table if not exists conversations (
      id varchar(128) primary key,
      user_id varchar(128) not null,
      title varchar(255) not null,
      archived_at datetime null,
      pinned_at datetime null,
      created_at datetime not null default current_timestamp,
      updated_at datetime not null default current_timestamp,
      index conversations_user_id_idx (user_id),
      index conversations_archived_at_idx (archived_at),
      index conversations_pinned_at_idx (pinned_at)
    )`,
    `create table if not exists messages (
      id varchar(128) primary key,
      conversation_id varchar(128) not null,
      role varchar(32) not null,
      content mediumtext not null,
      citations json not null,
      model varchar(255) null,
      created_at datetime not null default current_timestamp,
      index messages_conversation_id_idx (conversation_id),
      index messages_created_at_idx (created_at),
      index messages_conversation_created_idx (conversation_id, created_at)
    )`,
    `create table if not exists model_usage_events (
      id varchar(128) primary key,
      source varchar(64) not null,
      source_id varchar(128) null,
      conversation_id varchar(128) null,
      user_id varchar(128) null,
      provider varchar(64) null,
      model varchar(255) null,
      input_tokens int not null default 0,
      output_tokens int not null default 0,
      total_tokens int not null default 0,
      estimated tinyint(1) not null default 1,
      cost_usd decimal(12, 8) null,
      metadata json not null,
      created_at datetime not null default current_timestamp,
      index model_usage_events_source_idx (source),
      index model_usage_events_source_id_idx (source_id),
      index model_usage_events_conversation_idx (conversation_id),
      index model_usage_events_user_idx (user_id),
      index model_usage_events_created_at_idx (created_at)
    )`,
    `create table if not exists feedback (
      id varchar(128) primary key,
      message_id varchar(128) not null,
      user_id varchar(128) not null,
      rating varchar(32) not null,
      comment text null,
      status varchar(32) not null default 'pending',
      resolution_note text null,
      needs_knowledge_update boolean not null default false,
      created_at datetime not null default current_timestamp,
      index feedback_message_id_idx (message_id)
    )`,
    `create table if not exists knowledge_tasks (
      id varchar(128) primary key,
      source varchar(32) not null,
      source_id varchar(128) null,
      conversation_id varchar(128) not null,
      question mediumtext not null,
      answer mediumtext not null,
      status varchar(32) not null default 'pending',
      note text null,
      created_by varchar(128) null,
      created_at datetime not null default current_timestamp,
      updated_at datetime not null default current_timestamp,
      index knowledge_tasks_conversation_id_idx (conversation_id),
      index knowledge_tasks_status_idx (status)
    )`,
    `create table if not exists service_tickets (
      id varchar(128) primary key,
      conversation_id varchar(128) not null,
      message_id varchar(128) null,
      user_id varchar(128) not null,
      title varchar(255) not null,
      description mediumtext not null,
      status varchar(32) not null default 'pending',
      priority varchar(32) not null default 'normal',
      assignee_id varchar(128) null,
      resolution_note text null,
      due_at datetime null,
      resolved_at datetime null,
      created_at datetime not null default current_timestamp,
      updated_at datetime not null default current_timestamp,
      index service_tickets_conversation_id_idx (conversation_id),
      index service_tickets_user_id_idx (user_id),
      index service_tickets_status_idx (status),
      index service_tickets_due_at_idx (due_at),
      index service_tickets_updated_at_idx (updated_at)
    )`,
    `create table if not exists service_ticket_comments (
      id varchar(128) primary key,
      ticket_id varchar(128) not null,
      author_id varchar(128) not null,
      author_role varchar(32) not null,
      body mediumtext not null,
      is_internal tinyint(1) not null default 0,
      created_at datetime not null default current_timestamp,
      index service_ticket_comments_ticket_id_idx (ticket_id),
      index service_ticket_comments_created_at_idx (created_at)
    )`,
    `create table if not exists security_events (
      id varchar(128) primary key,
      category varchar(64) not null,
      severity varchar(32) not null default 'medium',
      user_id varchar(128) null,
      conversation_id varchar(128) null,
      message_id varchar(128) null,
      title varchar(255) not null,
      detail text not null,
      raw_excerpt text null,
      masked_excerpt text null,
      metadata json not null,
      status varchar(32) not null default 'pending',
      created_at datetime not null default current_timestamp,
      resolved_at datetime null,
      index security_events_category_idx (category),
      index security_events_severity_idx (severity),
      index security_events_status_idx (status),
      index security_events_created_at_idx (created_at),
      index security_events_user_idx (user_id)
    )`,
    `create table if not exists notifications (
      id varchar(128) primary key,
      user_id varchar(128) not null,
      category varchar(32) not null,
      severity varchar(32) not null default 'info',
      title varchar(255) not null,
      body text not null,
      href text null,
      source_type varchar(64) not null,
      source_id varchar(128) null,
      dedupe_key varchar(255) null,
      metadata json not null,
      read_at datetime null,
      created_at datetime not null default current_timestamp,
      index notifications_user_created_idx (user_id, created_at),
      index notifications_user_read_idx (user_id, read_at),
      index notifications_category_idx (category),
      unique index notifications_user_dedupe_unique_idx (user_id, dedupe_key)
    )`,
    `create table if not exists runtime_monitor_samples (
      id varchar(128) primary key,
      target_type varchar(32) not null,
      target varchar(255) not null,
      status varchar(32) not null,
      latency_ms int not null default 0,
      status_code int null,
      detail text null,
      metric_value decimal(16,4) null,
      metric_unit varchar(64) null,
      checked_at datetime not null,
      index runtime_monitor_samples_target_idx (target_type, target, checked_at),
      index runtime_monitor_samples_checked_idx (checked_at)
    )`,
    `create table if not exists runtime_alerts (
      id varchar(128) primary key,
      fingerprint varchar(255) not null,
      category varchar(64) not null,
      severity varchar(32) not null,
      title varchar(255) not null,
      detail text not null,
      status varchar(32) not null default 'open',
      occurrence_count int not null default 1,
      first_seen_at datetime not null,
      last_seen_at datetime not null,
      resolved_at datetime null,
      metadata json not null,
      unique index runtime_alerts_fingerprint_idx (fingerprint),
      index runtime_alerts_status_idx (status, last_seen_at),
      index runtime_alerts_category_idx (category, last_seen_at)
    )`,
    `create table if not exists training_jobs (
      id varchar(128) primary key,
      title varchar(255) not null,
      description text not null,
      instructor varchar(255) not null,
      cover_url text null,
      visible_departments json not null,
      ppt_file_name varchar(255) not null,
      ppt_storage_path text null,
      script_json json not null,
      audio_paths json not null,
      status varchar(32) not null default 'draft',
      publish_status varchar(32) not null default 'published',
      published_by varchar(128) null,
      published_at datetime null,
      created_by varchar(128) null,
      created_at datetime not null default current_timestamp,
      index training_jobs_created_at_idx (created_at),
      index training_jobs_publish_status_idx (publish_status)
    )`,
    `create table if not exists training_video_jobs (
      id varchar(128) primary key,
      training_job_id varchar(128) not null,
      provider varchar(64) not null,
      provider_job_id varchar(255) null,
      status varchar(32) not null default 'queued',
      video_url text null,
      cover_url text null,
      error_message text null,
      avatar_id varchar(255) null,
      voice_id varchar(255) null,
      script_summary mediumtext null,
      metadata json not null,
      created_by varchar(128) null,
      created_at datetime not null default current_timestamp,
      updated_at datetime not null default current_timestamp,
      index training_video_jobs_training_job_idx (training_job_id),
      index training_video_jobs_status_idx (status),
      index training_video_jobs_updated_at_idx (updated_at)
    )`,
    `create table if not exists training_progress (
      id varchar(128) primary key,
      training_job_id varchar(128) not null,
      user_id varchar(128) not null,
      completed_pages json not null,
      current_page int not null default 0,
      progress_percent int not null default 0,
      page_learning_seconds json not null,
      total_learning_seconds int not null default 0,
      playback_position_seconds decimal(12,3) not null default 0,
      last_active_at datetime null,
      completed_at datetime null,
      created_at datetime not null default current_timestamp,
      updated_at datetime not null default current_timestamp,
      unique index training_progress_user_job_unique_idx (training_job_id, user_id),
      index training_progress_job_idx (training_job_id),
      index training_progress_user_idx (user_id)
    )`,
    `create table if not exists training_audit_events (
      id varchar(128) primary key,
      training_job_id varchar(128) not null,
      actor_id varchar(128) not null,
      action varchar(64) not null,
      detail text not null,
      metadata json not null,
      created_at datetime not null default current_timestamp,
      index training_audit_events_job_idx (training_job_id, created_at),
      index training_audit_events_actor_idx (actor_id, created_at)
    )`,
    `create table if not exists training_quiz_attempts (
      id varchar(128) primary key,
      training_job_id varchar(128) not null,
      user_id varchar(128) not null,
      answers json not null,
      score int not null default 0,
      passed boolean not null default false,
      created_at datetime not null default current_timestamp,
      index training_quiz_attempts_job_idx (training_job_id),
      index training_quiz_attempts_user_idx (user_id)
    )`,
    `create table if not exists qa_test_cases (
      id varchar(128) primary key,
      question mediumtext not null,
      expected_answer mediumtext null,
      knowledge_base_ids json not null,
      answer mediumtext null,
      citations json not null,
      model varchar(255) null,
      status varchar(32) not null default 'untested',
      reviewer_note text null,
      latency_ms int null,
      created_by varchar(128) null,
      created_at datetime not null default current_timestamp,
      updated_at datetime not null default current_timestamp,
      index qa_test_cases_status_idx (status),
      index qa_test_cases_updated_at_idx (updated_at)
    )`
  ];

  for (const statement of statements) {
    await db.query(statement);
  }

  await applySchemaMigrations(db);
}

async function applySchemaMigrations(db: mysql.Pool) {
  const migrations = [
    "alter table users add column password_hash text null",
    "alter table users add column status varchar(32) not null default 'active'",
    "alter table users add column position varchar(255) not null default ''",
    "alter table users add column security_clearance varchar(32) not null default 'internal'",
    "alter table users add column auth_provider varchar(64) null",
    "alter table users add column external_subject varchar(255) null",
    "alter table users add column last_login_at datetime null",
    "alter table users add unique index users_email_unique_idx (email)",
    "alter table users add index users_external_subject_idx (auth_provider, external_subject)",
    "alter table knowledge_bases add column positions json null",
    "alter table conversations add column archived_at datetime null",
    "alter table conversations add index conversations_archived_at_idx (archived_at)",
    "alter table conversations add column pinned_at datetime null",
    "alter table conversations add index conversations_pinned_at_idx (pinned_at)",
    "alter table messages add index messages_created_at_idx (created_at)",
    "alter table messages add index messages_conversation_created_idx (conversation_id, created_at)",
    "alter table documents add column security_level varchar(32) not null default 'internal'",
    "alter table documents add column publish_status varchar(32) not null default 'published'",
    "alter table documents add column acl_departments json null",
    "alter table documents add column acl_positions json null",
    "alter table documents add column acl_roles json null",
    "alter table documents add column acl_users json null",
    "alter table documents add column approved_by varchar(128) null",
    "alter table documents add column approved_at datetime null",
    "alter table documents add column published_by varchar(128) null",
    "alter table documents add column published_at datetime null",
    "alter table documents add column published_version_id varchar(128) null",
    "alter table documents add column published_version int null",
    "alter table documents add column updated_at datetime not null default current_timestamp",
    "alter table documents add index documents_publish_status_idx (publish_status)",
    "alter table documents add index documents_security_level_idx (security_level)",
    `create table if not exists document_reviewer_assignments (
      id varchar(128) primary key,
      user_id varchar(128) not null,
      reviewer_type varchar(64) not null,
      knowledge_base_ids json not null,
      departments json not null,
      security_levels json not null,
      can_review tinyint(1) not null default 1,
      can_publish tinyint(1) not null default 0,
      active tinyint(1) not null default 1,
      created_by varchar(128) null,
      created_at datetime not null default current_timestamp,
      updated_at datetime not null default current_timestamp,
      index document_reviewer_assignments_user_idx (user_id),
      index document_reviewer_assignments_type_idx (reviewer_type),
      index document_reviewer_assignments_active_idx (active)
    )`,
    `create table if not exists document_approval_requests (
      id varchar(128) primary key,
      document_id varchar(128) not null,
      document_version_id varchar(128) null,
      status varchar(32) not null default 'pending',
      active_key varchar(16) null,
      submitted_by varchar(128) not null,
      submitted_at datetime not null,
      reviewed_by varchar(128) null,
      reviewed_at datetime null,
      review_comment text null,
      published_by varchar(128) null,
      published_at datetime null,
      withdrawn_by varchar(128) null,
      withdrawn_at datetime null,
      created_at datetime not null default current_timestamp,
      updated_at datetime not null default current_timestamp,
      index document_approval_requests_document_idx (document_id),
      index document_approval_requests_status_idx (status),
      index document_approval_requests_submitter_idx (submitted_by),
      index document_approval_requests_updated_idx (updated_at)
      ,unique index document_approval_requests_active_unique_idx (document_id, active_key)
    )`,
    "alter table document_approval_requests add column active_key varchar(16) null",
    "update document_approval_requests set active_key = 'active' where status in ('pending', 'approved') and active_key is null",
    "alter table document_approval_requests add unique index document_approval_requests_active_unique_idx (document_id, active_key)",
    `create table if not exists document_approval_events (
      id varchar(128) primary key,
      request_id varchar(128) null,
      document_id varchar(128) not null,
      action varchar(64) not null,
      actor_id varchar(128) not null,
      actor_name varchar(255) not null,
      actor_role varchar(32) not null,
      comment text null,
      from_status varchar(32) null,
      to_status varchar(32) null,
      metadata json not null,
      created_at datetime not null default current_timestamp,
      index document_approval_events_request_idx (request_id),
      index document_approval_events_document_idx (document_id),
      index document_approval_events_actor_idx (actor_id),
      index document_approval_events_created_idx (created_at)
    )`,
    `create table if not exists document_permission_templates (
      id varchar(128) primary key,
      name varchar(255) not null,
      description text null,
      security_level varchar(32) not null default 'internal',
      acl_departments json not null,
      acl_positions json not null,
      acl_roles json not null,
      acl_users json not null,
      created_by varchar(128) null,
      created_at datetime not null default current_timestamp,
      updated_at datetime not null default current_timestamp,
      unique index document_permission_templates_name_idx (name)
    )`,
    `create table if not exists document_version_chunks (
      id varchar(128) primary key,
      document_version_id varchar(128) not null,
      document_id varchar(128) null,
      knowledge_base_id varchar(128) not null,
      chunk_index int not null,
      content mediumtext not null,
      token_estimate int not null default 0,
      metadata json not null,
      created_at datetime not null default current_timestamp,
      index document_version_chunks_version_idx (document_version_id),
      index document_version_chunks_document_id_idx (document_id),
      index document_version_chunks_knowledge_base_id_idx (knowledge_base_id)
    )`,
    "alter table training_jobs add column publish_status varchar(32) not null default 'published'",
    "alter table training_jobs add column published_by varchar(128) null",
    "alter table training_jobs add column published_at datetime null",
    "alter table training_jobs add column description text null",
    "update training_jobs set description = '' where description is null",
    "alter table training_jobs modify column description text not null",
    "alter table training_jobs add column instructor varchar(255) not null default ''",
    "alter table training_jobs add column cover_url text null",
    "alter table training_jobs add column visible_departments json null",
    "update training_jobs set visible_departments = json_array() where visible_departments is null",
    "alter table training_jobs modify column visible_departments json not null",
    "alter table training_progress add column page_learning_seconds json null",
    "update training_progress set page_learning_seconds = json_object() where page_learning_seconds is null",
    "alter table training_progress modify column page_learning_seconds json not null",
    "alter table training_progress add column total_learning_seconds int not null default 0",
    "alter table training_progress add column playback_position_seconds decimal(12,3) not null default 0",
    "alter table training_progress add column last_active_at datetime null",
    "alter table training_jobs add index training_jobs_publish_status_idx (publish_status)",
    "alter table service_tickets add column due_at datetime null",
    "alter table service_tickets add column resolved_at datetime null",
    "alter table service_tickets add index service_tickets_due_at_idx (due_at)",
    `create table if not exists service_ticket_comments (
      id varchar(128) primary key,
      ticket_id varchar(128) not null,
      author_id varchar(128) not null,
      author_role varchar(32) not null,
      body mediumtext not null,
      is_internal tinyint(1) not null default 0,
      created_at datetime not null default current_timestamp,
      index service_ticket_comments_ticket_id_idx (ticket_id),
      index service_ticket_comments_created_at_idx (created_at)
    )`,
    `create table if not exists notifications (
      id varchar(128) primary key,
      user_id varchar(128) not null,
      category varchar(32) not null,
      severity varchar(32) not null default 'info',
      title varchar(255) not null,
      body text not null,
      href text null,
      source_type varchar(64) not null,
      source_id varchar(128) null,
      dedupe_key varchar(255) null,
      metadata json not null,
      read_at datetime null,
      created_at datetime not null default current_timestamp,
      index notifications_user_created_idx (user_id, created_at),
      index notifications_user_read_idx (user_id, read_at),
      index notifications_category_idx (category),
      unique index notifications_user_dedupe_unique_idx (user_id, dedupe_key)
    )`,
    `create table if not exists training_video_jobs (
      id varchar(128) primary key,
      training_job_id varchar(128) not null,
      provider varchar(64) not null,
      provider_job_id varchar(255) null,
      status varchar(32) not null default 'queued',
      video_url text null,
      cover_url text null,
      error_message text null,
      avatar_id varchar(255) null,
      voice_id varchar(255) null,
      script_summary mediumtext null,
      metadata json not null,
      created_by varchar(128) null,
      created_at datetime not null default current_timestamp,
      updated_at datetime not null default current_timestamp,
      index training_video_jobs_training_job_idx (training_job_id),
      index training_video_jobs_status_idx (status),
      index training_video_jobs_updated_at_idx (updated_at)
    )`,
    `create table if not exists model_usage_events (
      id varchar(128) primary key,
      source varchar(64) not null,
      source_id varchar(128) null,
      conversation_id varchar(128) null,
      user_id varchar(128) null,
      provider varchar(64) null,
      model varchar(255) null,
      input_tokens int not null default 0,
      output_tokens int not null default 0,
      total_tokens int not null default 0,
      estimated tinyint(1) not null default 1,
      cost_usd decimal(12, 8) null,
      metadata json not null,
      created_at datetime not null default current_timestamp,
      index model_usage_events_source_idx (source),
      index model_usage_events_source_id_idx (source_id),
      index model_usage_events_conversation_idx (conversation_id),
      index model_usage_events_user_idx (user_id),
      index model_usage_events_created_at_idx (created_at)
    )`
  ];

  for (const migration of migrations) {
    try {
      await db.query(migration);
    } catch (error) {
      if (isIgnorableMigrationError(error)) {
        continue;
      }

      throw error;
    }
  }
}

function isIgnorableMigrationError(error: unknown) {
  if (!error || typeof error !== "object") {
    return false;
  }

  const code = "code" in error ? String(error.code) : "";
  return code === "ER_DUP_FIELDNAME" || code === "ER_DUP_KEYNAME" || code === "ER_DUP_ENTRY";
}

export function parseJson<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) {
    return fallback;
  }

  if (typeof value !== "string") {
    return value as T;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function toIsoString(value: unknown) {
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === "string") {
    return new Date(value).toISOString();
  }

  return new Date().toISOString();
}
