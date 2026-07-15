create table if not exists integration_connectors (
  id varchar(64) primary key,
  provider varchar(64) not null,
  name varchar(255) not null,
  enabled tinyint(1) not null default 0,
  health_status varchar(32) not null default 'unconfigured',
  public_config json not null,
  last_checked_at datetime null,
  last_success_at datetime null,
  last_error text null,
  latency_ms int null,
  created_at datetime not null default current_timestamp,
  updated_at datetime not null default current_timestamp,
  unique index integration_connectors_provider_unique_idx (provider),
  index integration_connectors_health_idx (health_status, updated_at)
);

create table if not exists integration_directory_members (
  id varchar(128) primary key,
  connector_id varchar(64) not null,
  external_user_id varchar(255) not null,
  name varchar(255) not null,
  email varchar(255) not null default '',
  mobile_masked varchar(64) not null default '',
  department_ids json not null,
  department_names json not null,
  position varchar(255) not null default '',
  status varchar(32) not null default 'active',
  matched_user_id varchar(128) null,
  metadata json not null,
  synced_at datetime not null,
  created_at datetime not null default current_timestamp,
  updated_at datetime not null default current_timestamp,
  unique index integration_directory_external_unique_idx (connector_id, external_user_id),
  index integration_directory_email_idx (email),
  index integration_directory_matched_idx (matched_user_id),
  index integration_directory_status_idx (connector_id, status)
);

create table if not exists integration_user_identities (
  id varchar(128) primary key,
  connector_id varchar(64) not null,
  user_id varchar(128) not null,
  external_user_id varchar(255) not null,
  external_login varchar(255) not null default '',
  external_email varchar(255) not null default '',
  binding_source varchar(32) not null default 'sync',
  status varchar(32) not null default 'verified',
  verified_at datetime null,
  last_synced_at datetime null,
  metadata json not null,
  created_at datetime not null default current_timestamp,
  updated_at datetime not null default current_timestamp,
  unique index integration_identity_user_unique_idx (connector_id, user_id),
  unique index integration_identity_external_unique_idx (connector_id, external_user_id),
  index integration_identity_status_idx (connector_id, status)
);

create table if not exists integration_sync_runs (
  id varchar(128) primary key,
  connector_id varchar(64) not null,
  operation varchar(128) not null,
  status varchar(32) not null default 'running',
  started_by varchar(128) null,
  total_count int not null default 0,
  success_count int not null default 0,
  matched_count int not null default 0,
  updated_count int not null default 0,
  failed_count int not null default 0,
  error_message text null,
  metadata json not null,
  started_at datetime not null,
  finished_at datetime null,
  index integration_sync_runs_connector_idx (connector_id, started_at),
  index integration_sync_runs_status_idx (status, started_at)
);

create table if not exists integration_delivery_logs (
  id varchar(128) primary key,
  connector_id varchar(64) not null,
  channel varchar(64) not null,
  notification_id varchar(128) null,
  dedupe_key varchar(255) null,
  recipient_user_id varchar(128) null,
  recipient_masked varchar(255) not null default '',
  subject varchar(255) not null default '',
  status varchar(32) not null default 'sending',
  latency_ms int null,
  error_message text null,
  metadata json not null,
  created_at datetime not null default current_timestamp,
  updated_at datetime not null default current_timestamp,
  unique index integration_delivery_notification_unique_idx (connector_id, channel, notification_id),
  index integration_delivery_status_idx (connector_id, status, created_at),
  index integration_delivery_recipient_idx (recipient_user_id, created_at)
);

insert into integration_connectors
  (id, provider, name, enabled, health_status, public_config, created_at, updated_at)
values
  ('wecom', 'wecom', '企业微信', 0, 'unconfigured', json_object(), utc_timestamp(), utc_timestamp()),
  ('winmail', 'winmail', 'Winmail 邮件', 0, 'unconfigured', json_object(), utc_timestamp(), utc_timestamp())
on duplicate key update name = values(name);

