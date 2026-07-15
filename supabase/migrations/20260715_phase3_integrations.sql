create table if not exists public.integration_connectors (
  id text primary key,
  provider text not null unique,
  name text not null,
  enabled boolean not null default false,
  health_status text not null default 'unconfigured',
  public_config jsonb not null default '{}'::jsonb,
  last_checked_at timestamptz,
  last_success_at timestamptz,
  last_error text,
  latency_ms integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists integration_connectors_health_idx on public.integration_connectors(health_status, updated_at desc);

create table if not exists public.integration_directory_members (
  id text primary key,
  connector_id text not null,
  external_user_id text not null,
  name text not null,
  email text not null default '',
  mobile_masked text not null default '',
  department_ids jsonb not null default '[]'::jsonb,
  department_names jsonb not null default '[]'::jsonb,
  position text not null default '',
  status text not null default 'active',
  matched_user_id text,
  metadata jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(connector_id, external_user_id)
);
create index if not exists integration_directory_email_idx on public.integration_directory_members(email);
create index if not exists integration_directory_matched_idx on public.integration_directory_members(matched_user_id);
create index if not exists integration_directory_status_idx on public.integration_directory_members(connector_id, status);

create table if not exists public.integration_user_identities (
  id text primary key,
  connector_id text not null,
  user_id text not null,
  external_user_id text not null,
  external_login text not null default '',
  external_email text not null default '',
  binding_source text not null default 'sync',
  status text not null default 'verified',
  verified_at timestamptz,
  last_synced_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(connector_id, user_id),
  unique(connector_id, external_user_id)
);
create index if not exists integration_identity_status_idx on public.integration_user_identities(connector_id, status);

create table if not exists public.integration_sync_runs (
  id text primary key,
  connector_id text not null,
  operation text not null,
  status text not null default 'running',
  started_by text,
  total_count integer not null default 0,
  success_count integer not null default 0,
  matched_count integer not null default 0,
  updated_count integer not null default 0,
  failed_count integer not null default 0,
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  started_at timestamptz not null,
  finished_at timestamptz
);
create index if not exists integration_sync_runs_connector_idx on public.integration_sync_runs(connector_id, started_at desc);
create index if not exists integration_sync_runs_status_idx on public.integration_sync_runs(status, started_at desc);

create table if not exists public.integration_delivery_logs (
  id text primary key,
  connector_id text not null,
  channel text not null,
  notification_id text,
  dedupe_key text,
  recipient_user_id text,
  recipient_masked text not null default '',
  subject text not null default '',
  status text not null default 'sending',
  latency_ms integer,
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(connector_id, channel, notification_id)
);
create index if not exists integration_delivery_status_idx on public.integration_delivery_logs(connector_id, status, created_at desc);
create index if not exists integration_delivery_recipient_idx on public.integration_delivery_logs(recipient_user_id, created_at desc);

insert into public.integration_connectors (id, provider, name)
values ('wecom', 'wecom', '企业微信'), ('winmail', 'winmail', 'Winmail 邮件')
on conflict (id) do update set name = excluded.name;

alter table public.integration_connectors enable row level security;
alter table public.integration_directory_members enable row level security;
alter table public.integration_user_identities enable row level security;
alter table public.integration_sync_runs enable row level security;
alter table public.integration_delivery_logs enable row level security;

