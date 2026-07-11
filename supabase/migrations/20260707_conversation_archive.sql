alter table public.conversations
  add column if not exists archived_at timestamptz;

create index if not exists conversations_archived_at_idx
  on public.conversations(archived_at);
