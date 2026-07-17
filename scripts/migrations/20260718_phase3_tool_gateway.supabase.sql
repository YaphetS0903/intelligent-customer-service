create table if not exists public.integration_tools (
  id text primary key,
  connector_id text not null,
  name text not null,
  description text not null,
  status text not null default 'draft',
  risk_level text not null default 'read',
  allowed_roles jsonb not null default '[]'::jsonb,
  data_scope text not null default 'self',
  input_schema jsonb not null default '{}'::jsonb,
  timeout_ms integer not null default 8000,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists integration_tools_connector_idx on public.integration_tools(connector_id, status);
create index if not exists integration_tools_status_idx on public.integration_tools(status, updated_at desc);

create table if not exists public.integration_tool_executions (
  id text primary key,
  tool_id text not null,
  connector_id text not null,
  user_id text not null,
  conversation_id text null,
  assistant_message_id text null,
  source text not null,
  status text not null default 'running',
  input_summary jsonb not null default '{}'::jsonb,
  result_summary jsonb not null default '{}'::jsonb,
  error_code text null,
  error_message text null,
  latency_ms integer null,
  started_at timestamptz not null,
  finished_at timestamptz null
);

create index if not exists integration_tool_execution_tool_idx on public.integration_tool_executions(tool_id, started_at desc);
create index if not exists integration_tool_execution_user_idx on public.integration_tool_executions(user_id, started_at desc);
create index if not exists integration_tool_execution_status_idx on public.integration_tool_executions(status, started_at desc);

create table if not exists public.integration_user_credentials (
  id text primary key,
  connector_id text not null,
  user_id text not null,
  encrypted_secret text not null,
  key_version integer not null default 1,
  last_verified_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(connector_id, user_id)
);

alter table public.messages add column if not exists metadata jsonb null;
