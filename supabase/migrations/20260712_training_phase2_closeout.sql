alter table public.training_jobs
  add column if not exists mandatory boolean not null default false,
  add column if not exists due_at timestamptz,
  add column if not exists quiz_enabled boolean not null default false,
  add column if not exists quiz_pass_score integer not null default 80,
  add column if not exists quiz_max_attempts integer not null default 3,
  add column if not exists quiz_time_limit_minutes integer not null default 30,
  add column if not exists certificate_enabled boolean not null default true;

alter table public.training_audit_events drop constraint if exists training_audit_events_action_check;
alter table public.training_audit_events add constraint training_audit_events_action_check
  check (action in ('created', 'updated', 'published', 'unpublished', 'archived', 'audio_regenerated', 'quiz_updated', 'reminders_sent', 'certificate_revoked'));

create table if not exists public.training_quiz_attempts (
  id text primary key,
  training_job_id text not null references public.training_jobs(id) on delete cascade,
  user_id text not null,
  session_id text,
  answers jsonb not null default '{}'::jsonb,
  result_detail jsonb not null default '[]'::jsonb,
  score integer not null default 0,
  passed boolean not null default false,
  attempt_number integer not null default 1,
  duration_seconds integer not null default 0,
  started_at timestamptz not null default now(),
  submitted_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.training_quiz_attempts
  add column if not exists session_id text,
  add column if not exists result_detail jsonb not null default '[]'::jsonb,
  add column if not exists attempt_number integer not null default 1,
  add column if not exists duration_seconds integer not null default 0,
  add column if not exists started_at timestamptz not null default now(),
  add column if not exists submitted_at timestamptz not null default now();

create table if not exists public.training_quiz_questions (
  id text primary key,
  training_job_id text not null references public.training_jobs(id) on delete cascade,
  type text not null check (type in ('single', 'multiple', 'true_false')),
  prompt text not null,
  options jsonb not null default '[]'::jsonb,
  correct_answers jsonb not null default '[]'::jsonb,
  explanation text not null default '',
  score_weight integer not null default 1,
  order_index integer not null default 0,
  status text not null check (status in ('draft', 'published')) default 'draft',
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.training_exam_sessions (
  id text primary key,
  training_job_id text not null references public.training_jobs(id) on delete cascade,
  user_id text not null,
  question_snapshot jsonb not null default '[]'::jsonb,
  status text not null check (status in ('in_progress', 'submitted', 'expired')) default 'in_progress',
  started_at timestamptz not null,
  expires_at timestamptz not null,
  submitted_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.training_certificates (
  id text primary key,
  certificate_no text not null unique,
  training_job_id text not null references public.training_jobs(id) on delete cascade,
  user_id text not null,
  quiz_attempt_id text not null,
  issued_at timestamptz not null,
  revoked_at timestamptz,
  revoked_by text,
  revoke_reason text,
  created_at timestamptz not null default now(),
  unique (training_job_id, user_id)
);

create index if not exists training_quiz_questions_job_idx on public.training_quiz_questions(training_job_id, status, order_index);
create index if not exists training_exam_sessions_user_job_idx on public.training_exam_sessions(training_job_id, user_id, status);
create index if not exists training_exam_sessions_expires_idx on public.training_exam_sessions(status, expires_at);
create index if not exists training_certificates_user_idx on public.training_certificates(user_id, issued_at desc);
