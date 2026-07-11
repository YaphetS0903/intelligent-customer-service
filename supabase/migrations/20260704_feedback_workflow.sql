alter table if exists public.feedback
  add column if not exists status text not null default 'pending'
    check (status in ('pending', 'processing', 'resolved', 'ignored')),
  add column if not exists resolution_note text,
  add column if not exists needs_knowledge_update boolean not null default false;

create table if not exists public.knowledge_tasks (
  id text primary key,
  source text not null check (source in ('feedback', 'no_citation', 'manual')),
  source_id text,
  conversation_id text not null references public.conversations(id) on delete cascade,
  question text not null,
  answer text not null,
  status text not null check (status in ('pending', 'processing', 'resolved', 'ignored')) default 'pending',
  note text,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists knowledge_tasks_conversation_id_idx on public.knowledge_tasks(conversation_id);
create index if not exists knowledge_tasks_status_idx on public.knowledge_tasks(status);
