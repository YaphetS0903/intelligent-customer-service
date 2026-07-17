export type IntegrationProvider = "wecom" | "winmail";
export type IntegrationHealthStatus = "unconfigured" | "disabled" | "healthy" | "degraded" | "error";
export type IntegrationRunStatus = "running" | "success" | "partial" | "failed";
export type IntegrationDeliveryStatus = "sending" | "sent" | "failed" | "skipped";
export type IntegrationToolStatus = "draft" | "published" | "disabled";
export type IntegrationToolRiskLevel = "read" | "low_write" | "high_write";
export type IntegrationToolExecutionStatus = "running" | "success" | "failed" | "denied";

export type IntegrationConnector = {
  id: IntegrationProvider;
  provider: IntegrationProvider;
  name: string;
  enabled: boolean;
  health_status: IntegrationHealthStatus;
  public_config: Record<string, unknown>;
  last_checked_at: string | null;
  last_success_at: string | null;
  last_error: string | null;
  latency_ms: number | null;
  created_at: string;
  updated_at: string;
};

export type IntegrationDirectoryMember = {
  id: string;
  connector_id: IntegrationProvider;
  external_user_id: string;
  name: string;
  email: string;
  mobile_masked: string;
  department_ids: number[];
  department_names: string[];
  position: string;
  status: "active" | "disabled" | "missing";
  matched_user_id: string | null;
  metadata: Record<string, unknown>;
  synced_at: string;
  created_at: string;
  updated_at: string;
};

export type IntegrationUserIdentity = {
  id: string;
  connector_id: IntegrationProvider;
  user_id: string;
  external_user_id: string;
  external_login: string;
  external_email: string;
  binding_source: "email" | "manual" | "sync" | "jit";
  status: "verified" | "conflict" | "inactive";
  verified_at: string | null;
  last_synced_at: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type IntegrationSyncRun = {
  id: string;
  connector_id: IntegrationProvider;
  operation: string;
  status: IntegrationRunStatus;
  started_by: string | null;
  total_count: number;
  success_count: number;
  matched_count: number;
  updated_count: number;
  failed_count: number;
  error_message: string | null;
  metadata: Record<string, unknown>;
  started_at: string;
  finished_at: string | null;
};

export type IntegrationDeliveryLog = {
  id: string;
  connector_id: IntegrationProvider;
  channel: string;
  notification_id: string | null;
  dedupe_key: string | null;
  recipient_user_id: string | null;
  recipient_masked: string;
  subject: string;
  status: IntegrationDeliveryStatus;
  latency_ms: number | null;
  error_message: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type IntegrationTool = {
  id: string;
  connector_id: IntegrationProvider;
  name: string;
  description: string;
  status: IntegrationToolStatus;
  risk_level: IntegrationToolRiskLevel;
  allowed_roles: string[];
  data_scope: "self" | "department" | "configured";
  input_schema: Record<string, unknown>;
  timeout_ms: number;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type IntegrationToolExecution = {
  id: string;
  tool_id: string;
  connector_id: IntegrationProvider;
  user_id: string;
  conversation_id: string | null;
  assistant_message_id: string | null;
  source: "chat" | "api" | "admin_test";
  status: IntegrationToolExecutionStatus;
  input_summary: Record<string, unknown>;
  result_summary: Record<string, unknown>;
  error_code: string | null;
  error_message: string | null;
  latency_ms: number | null;
  started_at: string;
  finished_at: string | null;
};

export type IntegrationUserCredential = {
  id: string;
  connector_id: IntegrationProvider;
  user_id: string;
  encrypted_secret: string;
  key_version: number;
  last_verified_at: string | null;
  created_at: string;
  updated_at: string;
};

export type WinmailMessageSummary = {
  id: string;
  folder: string;
  sender_name: string;
  sender_email: string;
  subject: string;
  sent_at: string;
  unread: boolean;
  has_attachment: boolean;
  size: string;
};

export type WecomDirectorySyncResult = {
  departments: number;
  members: number;
  matched: number;
  profiles_updated: number;
  disabled: number;
  accounts_disabled: number;
  accounts_restored: number;
  conflicts: number;
  run: IntegrationSyncRun;
};
