create extension if not exists "pg_trgm";

create table if not exists public.document_chunks (
  id text primary key,
  document_id text not null references public.documents(id) on delete cascade,
  knowledge_base_id text not null references public.knowledge_bases(id) on delete cascade,
  chunk_index integer not null,
  content text not null,
  token_estimate integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists document_chunks_document_id_idx on public.document_chunks(document_id);
create index if not exists document_chunks_knowledge_base_id_idx on public.document_chunks(knowledge_base_id);
create index if not exists document_chunks_content_trgm_idx on public.document_chunks using gin (content gin_trgm_ops);
