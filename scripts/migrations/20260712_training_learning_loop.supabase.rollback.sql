drop table if exists public.training_audit_events;

alter table public.training_progress
  drop column if exists last_active_at,
  drop column if exists playback_position_seconds,
  drop column if exists total_learning_seconds,
  drop column if exists page_learning_seconds;

alter table public.training_jobs
  drop column if exists visible_departments,
  drop column if exists cover_url,
  drop column if exists instructor,
  drop column if exists description;
