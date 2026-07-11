create table if not exists public.notifications (
  id text primary key,
  user_id text not null,
  category text not null check (category in ('approval', 'ticket', 'security', 'qa', 'system')),
  severity text not null check (severity in ('info', 'success', 'warning', 'critical')) default 'info',
  title text not null,
  body text not null,
  href text,
  source_type text not null,
  source_id text,
  dedupe_key text,
  metadata jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists notifications_user_created_idx on public.notifications(user_id, created_at desc);
create index if not exists notifications_user_read_idx on public.notifications(user_id, read_at);
create index if not exists notifications_category_idx on public.notifications(category);
create unique index if not exists notifications_user_dedupe_unique_idx on public.notifications(user_id, dedupe_key) where dedupe_key is not null;
