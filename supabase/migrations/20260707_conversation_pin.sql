alter table public.conversations
  add column if not exists pinned_at timestamptz;

create index if not exists conversations_pinned_at_idx
  on public.conversations(pinned_at);
