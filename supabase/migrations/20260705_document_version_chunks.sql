create table if not exists public.document_versions (
  id text primary key,
  document_id text references public.documents(id) on delete cascade,
  knowledge_base_id text not null references public.knowledge_bases(id) on delete cascade,
  version integer not null,
  title text not null,
  file_name text not null,
  file_type text not null,
  status text not null check (status in ('uploading', 'processing', 'ready', 'failed')) default 'uploading',
  change_note text,
  created_by text,
  created_at timestamptz not null default now()
);

create table if not exists public.document_version_chunks (
  id text primary key,
  document_version_id text not null references public.document_versions(id) on delete cascade,
  document_id text references public.documents(id) on delete cascade,
  knowledge_base_id text not null references public.knowledge_bases(id) on delete cascade,
  chunk_index integer not null,
  content text not null,
  token_estimate integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists document_versions_document_id_idx on public.document_versions(document_id);
create index if not exists document_versions_knowledge_base_id_idx on public.document_versions(knowledge_base_id);
create unique index if not exists document_versions_document_version_unique_idx on public.document_versions(document_id, version);
create index if not exists document_version_chunks_version_idx on public.document_version_chunks(document_version_id);
create index if not exists document_version_chunks_document_id_idx on public.document_version_chunks(document_id);
create index if not exists document_version_chunks_knowledge_base_id_idx on public.document_version_chunks(knowledge_base_id);
