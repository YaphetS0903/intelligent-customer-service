alter table public.training_jobs
  add column if not exists description text not null default '',
  add column if not exists instructor text not null default '',
  add column if not exists cover_url text,
  add column if not exists visible_departments text[] not null default '{}';

create table if not exists public.training_progress (
  id text primary key,
  training_job_id text not null references public.training_jobs(id) on delete cascade,
  user_id text not null,
  completed_pages integer[] not null default '{}',
  current_page integer not null default 0,
  progress_percent integer not null default 0,
  page_learning_seconds jsonb not null default '{}'::jsonb,
  total_learning_seconds integer not null default 0,
  playback_position_seconds numeric(12,3) not null default 0,
  last_active_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (training_job_id, user_id)
);

alter table public.training_progress
  add column if not exists page_learning_seconds jsonb not null default '{}'::jsonb,
  add column if not exists total_learning_seconds integer not null default 0,
  add column if not exists playback_position_seconds numeric(12,3) not null default 0,
  add column if not exists last_active_at timestamptz;

create table if not exists public.training_audit_events (
  id text primary key,
  training_job_id text not null references public.training_jobs(id) on delete cascade,
  actor_id text not null,
  action text not null check (action in ('created', 'updated', 'published', 'unpublished', 'archived', 'audio_regenerated')),
  detail text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists training_progress_job_idx on public.training_progress(training_job_id);
create index if not exists training_progress_user_idx on public.training_progress(user_id);
create index if not exists training_audit_events_job_idx on public.training_audit_events(training_job_id, created_at desc);
create index if not exists training_audit_events_actor_idx on public.training_audit_events(actor_id, created_at desc);
