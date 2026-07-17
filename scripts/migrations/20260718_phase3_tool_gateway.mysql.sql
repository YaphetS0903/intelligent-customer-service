create table if not exists integration_tools (
  id varchar(128) primary key,
  connector_id varchar(64) not null,
  name varchar(255) not null,
  description text not null,
  status varchar(32) not null default 'draft',
  risk_level varchar(32) not null default 'read',
  allowed_roles json not null,
  data_scope varchar(32) not null default 'self',
  input_schema json not null,
  timeout_ms int not null default 8000,
  metadata json not null,
  created_at datetime not null default current_timestamp,
  updated_at datetime not null default current_timestamp,
  index integration_tools_connector_idx (connector_id, status),
  index integration_tools_status_idx (status, updated_at)
);

create table if not exists integration_tool_executions (
  id varchar(128) primary key,
  tool_id varchar(128) not null,
  connector_id varchar(64) not null,
  user_id varchar(128) not null,
  conversation_id varchar(128) null,
  assistant_message_id varchar(128) null,
  source varchar(32) not null,
  status varchar(32) not null default 'running',
  input_summary json not null,
  result_summary json not null,
  error_code varchar(64) null,
  error_message text null,
  latency_ms int null,
  started_at datetime not null,
  finished_at datetime null,
  index integration_tool_execution_tool_idx (tool_id, started_at),
  index integration_tool_execution_user_idx (user_id, started_at),
  index integration_tool_execution_status_idx (status, started_at)
);

create table if not exists integration_user_credentials (
  id varchar(128) primary key,
  connector_id varchar(64) not null,
  user_id varchar(128) not null,
  encrypted_secret text not null,
  key_version int not null default 1,
  last_verified_at datetime null,
  created_at datetime not null default current_timestamp,
  updated_at datetime not null default current_timestamp,
  unique index integration_credential_user_unique_idx (connector_id, user_id)
);

alter table messages add column metadata json null;
