alter table public.documents add column if not exists published_by text;
alter table public.documents add column if not exists published_at timestamptz;
alter table public.documents add column if not exists published_version_id text;
alter table public.documents add column if not exists published_version integer;
