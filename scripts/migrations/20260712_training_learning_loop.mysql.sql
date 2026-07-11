alter table training_jobs add column description text null;
update training_jobs set description = '' where description is null;
alter table training_jobs modify column description text not null;
alter table training_jobs add column instructor varchar(255) not null default '';
alter table training_jobs add column cover_url text null;
alter table training_jobs add column visible_departments json null;
update training_jobs set visible_departments = json_array() where visible_departments is null;
alter table training_jobs modify column visible_departments json not null;

alter table training_progress add column page_learning_seconds json null;
update training_progress set page_learning_seconds = json_object() where page_learning_seconds is null;
alter table training_progress modify column page_learning_seconds json not null;
alter table training_progress add column total_learning_seconds int not null default 0;
alter table training_progress add column playback_position_seconds decimal(12,3) not null default 0;
alter table training_progress add column last_active_at datetime null;

create table if not exists training_audit_events (
  id varchar(128) primary key,
  training_job_id varchar(128) not null,
  actor_id varchar(128) not null,
  action varchar(64) not null,
  detail text not null,
  metadata json not null,
  created_at datetime not null default current_timestamp,
  index training_audit_events_job_idx (training_job_id, created_at),
  index training_audit_events_actor_idx (actor_id, created_at)
);
