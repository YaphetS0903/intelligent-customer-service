create table if not exists public.training_video_jobs (
  id text primary key,
  training_job_id text not null references public.training_jobs(id) on delete cascade,
  provider text not null,
  provider_job_id text,
  status text not null check (status in ('queued', 'generating', 'ready', 'failed')) default 'queued',
  video_url text,
  cover_url text,
  error_message text,
  avatar_id text,
  voice_id text,
  script_summary text,
  metadata jsonb not null default '{}'::jsonb,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists training_video_jobs_training_job_idx on public.training_video_jobs(training_job_id);
create index if not exists training_video_jobs_status_idx on public.training_video_jobs(status);
create index if not exists training_video_jobs_updated_at_idx on public.training_video_jobs(updated_at);
