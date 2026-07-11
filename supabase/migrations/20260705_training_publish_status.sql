alter table public.training_jobs
  add column if not exists publish_status text not null default 'published',
  add column if not exists published_by text,
  add column if not exists published_at timestamptz;

alter table public.training_jobs
  drop constraint if exists training_jobs_publish_status_check;

alter table public.training_jobs
  add constraint training_jobs_publish_status_check
    check (publish_status in ('draft', 'published', 'archived'));

create index if not exists training_jobs_publish_status_idx on public.training_jobs(publish_status);
