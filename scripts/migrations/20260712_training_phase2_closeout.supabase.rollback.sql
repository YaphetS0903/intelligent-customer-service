drop table if exists public.training_certificates;
drop table if exists public.training_exam_sessions;
drop table if exists public.training_quiz_questions;

alter table public.training_audit_events drop constraint if exists training_audit_events_action_check;
alter table public.training_audit_events add constraint training_audit_events_action_check
  check (action in ('created', 'updated', 'published', 'unpublished', 'archived', 'audio_regenerated'));

alter table public.training_quiz_attempts
  drop column if exists submitted_at,
  drop column if exists started_at,
  drop column if exists duration_seconds,
  drop column if exists attempt_number,
  drop column if exists result_detail,
  drop column if exists session_id;

alter table public.training_jobs
  drop column if exists certificate_enabled,
  drop column if exists quiz_time_limit_minutes,
  drop column if exists quiz_max_attempts,
  drop column if exists quiz_pass_score,
  drop column if exists quiz_enabled,
  drop column if exists due_at,
  drop column if exists mandatory;
