alter table public.conversations add column if not exists deleted_at timestamptz;
create index if not exists conversations_deleted_at_idx on public.conversations(deleted_at);

create unique index if not exists training_quiz_attempts_session_unique_idx
  on public.training_quiz_attempts(session_id)
  where session_id is not null;
