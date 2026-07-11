alter table public.users
  add column if not exists security_clearance text not null default 'internal';

alter table public.users
  drop constraint if exists users_security_clearance_check;

alter table public.users
  add constraint users_security_clearance_check
    check (security_clearance in ('public', 'internal', 'confidential', 'restricted'));

alter table public.documents
  add column if not exists acl_roles text[] not null default '{}';

alter table public.documents
  drop constraint if exists documents_publish_status_check;

alter table public.documents
  add constraint documents_publish_status_check
    check (publish_status in ('draft', 'pending_review', 'approved', 'rejected', 'published', 'archived'));

create table if not exists public.document_reviewer_assignments (
  id text primary key,
  user_id text not null references public.users(id) on delete cascade,
  reviewer_type text not null check (reviewer_type in ('knowledge_base_manager', 'department_head', 'safety_reviewer', 'quality_reviewer')),
  knowledge_base_ids text[] not null default '{}',
  departments text[] not null default '{}',
  security_levels text[] not null default '{}',
  can_review boolean not null default true,
  can_publish boolean not null default false,
  active boolean not null default true,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.document_approval_requests (
  id text primary key,
  document_id text not null references public.documents(id) on delete cascade,
  document_version_id text references public.document_versions(id) on delete set null,
  status text not null check (status in ('pending', 'approved', 'rejected', 'withdrawn', 'published', 'archived')) default 'pending',
  submitted_by text not null,
  submitted_at timestamptz not null,
  reviewed_by text,
  reviewed_at timestamptz,
  review_comment text,
  published_by text,
  published_at timestamptz,
  withdrawn_by text,
  withdrawn_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.document_approval_events (
  id text primary key,
  request_id text references public.document_approval_requests(id) on delete set null,
  document_id text not null references public.documents(id) on delete cascade,
  action text not null check (action in ('submitted', 'withdrawn', 'approved', 'rejected', 'published', 'archived', 'restored_to_draft', 'version_rolled_back', 'acl_updated')),
  actor_id text not null,
  actor_name text not null,
  actor_role text not null check (actor_role in ('admin', 'employee')),
  comment text,
  from_status text,
  to_status text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.document_permission_templates (
  id text primary key,
  name text not null unique,
  description text,
  security_level text not null check (security_level in ('public', 'internal', 'confidential', 'restricted')) default 'internal',
  acl_departments text[] not null default '{}',
  acl_positions text[] not null default '{}',
  acl_roles text[] not null default '{}',
  acl_users text[] not null default '{}',
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists document_reviewer_assignments_user_idx on public.document_reviewer_assignments(user_id);
create index if not exists document_reviewer_assignments_active_idx on public.document_reviewer_assignments(active);
create index if not exists document_approval_requests_document_idx on public.document_approval_requests(document_id);
create index if not exists document_approval_requests_status_idx on public.document_approval_requests(status);
create index if not exists document_approval_requests_submitter_idx on public.document_approval_requests(submitted_by);
create unique index if not exists document_approval_requests_active_unique_idx on public.document_approval_requests(document_id) where status in ('pending', 'approved');
create index if not exists document_approval_events_document_idx on public.document_approval_events(document_id);
create index if not exists document_approval_events_request_idx on public.document_approval_events(request_id);
