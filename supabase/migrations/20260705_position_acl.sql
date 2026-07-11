alter table public.users
  add column if not exists position text not null default '';

alter table public.knowledge_bases
  add column if not exists positions text[] not null default '{}';

alter table public.knowledge_bases
  drop constraint if exists knowledge_bases_visibility_check;

alter table public.knowledge_bases
  add constraint knowledge_bases_visibility_check
    check (visibility in ('all', 'department', 'position', 'admin_only'));

alter table public.documents
  add column if not exists security_level text not null default 'internal',
  add column if not exists publish_status text not null default 'published',
  add column if not exists acl_departments text[] not null default '{}',
  add column if not exists acl_positions text[] not null default '{}',
  add column if not exists acl_users text[] not null default '{}',
  add column if not exists approved_by text,
  add column if not exists approved_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

alter table public.documents
  drop constraint if exists documents_security_level_check;

alter table public.documents
  add constraint documents_security_level_check
    check (security_level in ('public', 'internal', 'confidential', 'restricted'));

alter table public.documents
  drop constraint if exists documents_publish_status_check;

alter table public.documents
  add constraint documents_publish_status_check
    check (publish_status in ('draft', 'pending_review', 'published', 'archived'));
