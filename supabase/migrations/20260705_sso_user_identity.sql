alter table public.users
  add column if not exists status text not null default 'active';

alter table public.users
  add column if not exists auth_provider text;

alter table public.users
  add column if not exists external_subject text;

create index if not exists users_external_subject_idx on public.users(auth_provider, external_subject);
