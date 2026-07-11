create table if not exists public.service_tickets (
  id text primary key,
  conversation_id text not null,
  message_id text,
  user_id text not null,
  title text not null,
  description text not null,
  status text not null check (status in ('pending', 'processing', 'resolved', 'ignored')) default 'pending',
  priority text not null check (priority in ('low', 'normal', 'high', 'urgent')) default 'normal',
  assignee_id text,
  resolution_note text,
  due_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.service_tickets
  add column if not exists due_at timestamptz,
  add column if not exists resolved_at timestamptz;

create table if not exists public.service_ticket_comments (
  id text primary key,
  ticket_id text not null references public.service_tickets(id) on delete cascade,
  author_id text not null,
  author_role text not null check (author_role in ('admin', 'employee')),
  body text not null,
  is_internal boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists service_tickets_conversation_id_idx on public.service_tickets(conversation_id);
create index if not exists service_tickets_user_id_idx on public.service_tickets(user_id);
create index if not exists service_tickets_status_idx on public.service_tickets(status);
create index if not exists service_tickets_due_at_idx on public.service_tickets(due_at);
create index if not exists service_tickets_updated_at_idx on public.service_tickets(updated_at);
create index if not exists service_ticket_comments_ticket_id_idx on public.service_ticket_comments(ticket_id);
create index if not exists service_ticket_comments_created_at_idx on public.service_ticket_comments(created_at);
