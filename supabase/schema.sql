create extension if not exists "pgcrypto";
create extension if not exists "pg_trgm";

create table if not exists public.users (
  id text primary key,
  email text not null,
  name text not null,
  role text not null check (role in ('admin', 'employee')) default 'employee',
  department text not null default '',
  position text not null default '',
  security_clearance text not null check (security_clearance in ('public', 'internal', 'confidential', 'restricted')) default 'internal',
  status text not null check (status in ('active', 'disabled')) default 'active',
  auth_provider text,
  external_subject text,
  created_at timestamptz not null default now()
);

create table if not exists public.knowledge_bases (
  id text primary key,
  name text not null,
  description text,
  openai_vector_store_id text,
  visibility text not null check (visibility in ('all', 'department', 'position', 'admin_only')) default 'all',
  departments text[] not null default '{}',
  positions text[] not null default '{}',
  created_by text,
  created_at timestamptz not null default now()
);

create table if not exists public.documents (
  id text primary key,
  knowledge_base_id text not null references public.knowledge_bases(id) on delete cascade,
  title text not null,
  file_name text not null,
  file_type text not null,
  storage_path text,
  openai_file_id text,
  status text not null check (status in ('uploading', 'processing', 'ready', 'failed')) default 'uploading',
  department text,
  tags text[] not null default '{}',
  security_level text not null check (security_level in ('public', 'internal', 'confidential', 'restricted')) default 'internal',
  publish_status text not null check (publish_status in ('draft', 'pending_review', 'approved', 'rejected', 'published', 'archived')) default 'published',
  acl_departments text[] not null default '{}',
  acl_positions text[] not null default '{}',
  acl_roles text[] not null default '{}',
  acl_users text[] not null default '{}',
  approved_by text,
  approved_at timestamptz,
  published_by text,
  published_at timestamptz,
  published_version_id text,
  published_version integer,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

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
  document_version_id text,
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

create table if not exists public.conversations (
  id text primary key,
  user_id text not null,
  title text not null,
  archived_at timestamptz,
  pinned_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.messages (
  id text primary key,
  conversation_id text not null references public.conversations(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  citations jsonb not null default '[]'::jsonb,
  model text,
  created_at timestamptz not null default now()
);

create table if not exists public.feedback (
  id text primary key,
  message_id text not null references public.messages(id) on delete cascade,
  user_id text not null,
  rating text not null check (rating in ('like', 'dislike')),
  comment text,
  status text not null check (status in ('pending', 'processing', 'resolved', 'ignored')) default 'pending',
  resolution_note text,
  needs_knowledge_update boolean not null default false,
  created_at timestamptz not null default now()
);

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

create table if not exists public.service_ticket_comments (
  id text primary key,
  ticket_id text not null references public.service_tickets(id) on delete cascade,
  author_id text not null,
  author_role text not null check (author_role in ('admin', 'employee')),
  body text not null,
  is_internal boolean not null default false,
  created_at timestamptz not null default now()
);

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

create table if not exists public.training_jobs (
  id text primary key,
  title text not null,
  description text not null default '',
  instructor text not null default '',
  cover_url text,
  visible_departments text[] not null default '{}',
  mandatory boolean not null default false,
  due_at timestamptz,
  quiz_enabled boolean not null default false,
  quiz_pass_score integer not null default 80,
  quiz_max_attempts integer not null default 3,
  quiz_time_limit_minutes integer not null default 30,
  certificate_enabled boolean not null default true,
  ppt_file_name text not null,
  ppt_storage_path text,
  script_json jsonb not null default '[]'::jsonb,
  audio_paths text[] not null default '{}',
  status text not null check (status in ('draft', 'generating', 'ready', 'failed')) default 'draft',
  publish_status text not null check (publish_status in ('draft', 'published', 'archived')) default 'published',
  published_by text,
  published_at timestamptz,
  created_by text,
  created_at timestamptz not null default now()
);

create table if not exists public.training_progress (
  id text primary key,
  training_job_id text not null references public.training_jobs(id) on delete cascade,
  user_id text not null,
  completed_pages integer[] not null default '{}',
  current_page integer not null default 0,
  progress_percent integer not null default 0,
  page_learning_seconds jsonb not null default '{}'::jsonb,
  total_learning_seconds integer not null default 0,
  playback_position_seconds numeric(12,3) not null default 0,
  last_active_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (training_job_id, user_id)
);

create table if not exists public.training_audit_events (
  id text primary key,
  training_job_id text not null references public.training_jobs(id) on delete cascade,
  actor_id text not null,
  action text not null check (action in ('created', 'updated', 'published', 'unpublished', 'archived', 'audio_regenerated', 'quiz_updated', 'reminders_sent', 'certificate_revoked')),
  detail text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.training_video_jobs (
  id text primary key,
  training_job_id text not null references public.training_jobs(id) on delete cascade,
  provider text not null,
  provider_job_id text,
  status text not null check (status in ('queued', 'generating', 'ready', 'failed')) default 'queued',
  video_url text,
  cover_url text,
  error_message text,
  avatar_id text,
  voice_id text,
  script_summary text,
  metadata jsonb not null default '{}'::jsonb,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.training_quiz_attempts (
  id text primary key,
  training_job_id text not null references public.training_jobs(id) on delete cascade,
  user_id text not null,
  session_id text,
  answers jsonb not null default '{}'::jsonb,
  result_detail jsonb not null default '[]'::jsonb,
  score integer not null default 0,
  passed boolean not null default false,
  attempt_number integer not null default 1,
  duration_seconds integer not null default 0,
  started_at timestamptz not null default now(),
  submitted_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.training_quiz_questions (
  id text primary key,
  training_job_id text not null references public.training_jobs(id) on delete cascade,
  type text not null check (type in ('single', 'multiple', 'true_false')),
  prompt text not null,
  options jsonb not null default '[]'::jsonb,
  correct_answers jsonb not null default '[]'::jsonb,
  explanation text not null default '',
  score_weight integer not null default 1,
  order_index integer not null default 0,
  status text not null check (status in ('draft', 'published')) default 'draft',
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.training_exam_sessions (
  id text primary key,
  training_job_id text not null references public.training_jobs(id) on delete cascade,
  user_id text not null,
  question_snapshot jsonb not null default '[]'::jsonb,
  status text not null check (status in ('in_progress', 'submitted', 'expired')) default 'in_progress',
  started_at timestamptz not null,
  expires_at timestamptz not null,
  submitted_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.training_certificates (
  id text primary key,
  certificate_no text not null unique,
  training_job_id text not null references public.training_jobs(id) on delete cascade,
  user_id text not null,
  quiz_attempt_id text not null,
  issued_at timestamptz not null,
  revoked_at timestamptz,
  revoked_by text,
  revoke_reason text,
  created_at timestamptz not null default now(),
  unique (training_job_id, user_id)
);

create index if not exists documents_knowledge_base_id_idx on public.documents(knowledge_base_id);
create index if not exists document_reviewer_assignments_user_idx on public.document_reviewer_assignments(user_id);
create index if not exists document_reviewer_assignments_active_idx on public.document_reviewer_assignments(active);
create index if not exists document_approval_requests_document_idx on public.document_approval_requests(document_id);
create index if not exists document_approval_requests_status_idx on public.document_approval_requests(status);
create index if not exists document_approval_requests_submitter_idx on public.document_approval_requests(submitted_by);
create unique index if not exists document_approval_requests_active_unique_idx on public.document_approval_requests(document_id) where status in ('pending', 'approved');
create index if not exists document_approval_events_document_idx on public.document_approval_events(document_id);
create index if not exists document_approval_events_request_idx on public.document_approval_events(request_id);
create index if not exists document_chunks_document_id_idx on public.document_chunks(document_id);
create index if not exists document_chunks_knowledge_base_id_idx on public.document_chunks(knowledge_base_id);
create index if not exists document_chunks_content_trgm_idx on public.document_chunks using gin (content gin_trgm_ops);
create index if not exists document_versions_document_id_idx on public.document_versions(document_id);
create index if not exists document_versions_knowledge_base_id_idx on public.document_versions(knowledge_base_id);
create unique index if not exists document_versions_document_version_unique_idx on public.document_versions(document_id, version);
create index if not exists document_version_chunks_version_idx on public.document_version_chunks(document_version_id);
create index if not exists document_version_chunks_document_id_idx on public.document_version_chunks(document_id);
create index if not exists document_version_chunks_knowledge_base_id_idx on public.document_version_chunks(knowledge_base_id);
create index if not exists conversations_user_id_idx on public.conversations(user_id);
create index if not exists conversations_archived_at_idx on public.conversations(archived_at);
create index if not exists conversations_deleted_at_idx on public.conversations(deleted_at);
create index if not exists conversations_pinned_at_idx on public.conversations(pinned_at);
create index if not exists messages_conversation_id_idx on public.messages(conversation_id);
create index if not exists feedback_message_id_idx on public.feedback(message_id);
create index if not exists training_jobs_created_at_idx on public.training_jobs(created_at);
create index if not exists training_progress_job_idx on public.training_progress(training_job_id);
create index if not exists training_progress_user_idx on public.training_progress(user_id);
create index if not exists training_audit_events_job_idx on public.training_audit_events(training_job_id, created_at desc);
create index if not exists training_audit_events_actor_idx on public.training_audit_events(actor_id, created_at desc);
create index if not exists training_video_jobs_training_job_idx on public.training_video_jobs(training_job_id);
create index if not exists training_video_jobs_status_idx on public.training_video_jobs(status);
create index if not exists training_video_jobs_updated_at_idx on public.training_video_jobs(updated_at);
create index if not exists training_quiz_attempts_job_idx on public.training_quiz_attempts(training_job_id);
create index if not exists training_quiz_attempts_user_idx on public.training_quiz_attempts(user_id);
create index if not exists training_quiz_questions_job_idx on public.training_quiz_questions(training_job_id, status, order_index);
create index if not exists training_exam_sessions_user_job_idx on public.training_exam_sessions(training_job_id, user_id, status);
create index if not exists training_exam_sessions_expires_idx on public.training_exam_sessions(status, expires_at);
create index if not exists training_certificates_user_idx on public.training_certificates(user_id, issued_at desc);
create index if not exists knowledge_tasks_conversation_id_idx on public.knowledge_tasks(conversation_id);
create index if not exists knowledge_tasks_status_idx on public.knowledge_tasks(status);
create index if not exists service_tickets_conversation_id_idx on public.service_tickets(conversation_id);
create index if not exists service_tickets_user_id_idx on public.service_tickets(user_id);
create index if not exists service_tickets_status_idx on public.service_tickets(status);
create index if not exists service_tickets_due_at_idx on public.service_tickets(due_at);
create index if not exists service_tickets_updated_at_idx on public.service_tickets(updated_at);
create index if not exists service_ticket_comments_ticket_id_idx on public.service_ticket_comments(ticket_id);
create index if not exists service_ticket_comments_created_at_idx on public.service_ticket_comments(created_at);
create index if not exists notifications_user_created_idx on public.notifications(user_id, created_at desc);
create index if not exists notifications_user_read_idx on public.notifications(user_id, read_at);
create index if not exists notifications_category_idx on public.notifications(category);
create unique index if not exists notifications_user_dedupe_unique_idx on public.notifications(user_id, dedupe_key) where dedupe_key is not null;
create index if not exists users_external_subject_idx on public.users(auth_provider, external_subject);

-- Storage:
-- Create a private bucket named "documents" in Supabase Storage.
-- Training PPTX files are also stored in the "documents" bucket under training/.
-- Training slide audio cache is stored under training-audio/{training_job_id}/.
--
-- Auth:
-- Enable Email auth in Supabase Authentication.
-- The application creates public.users profiles on first authenticated request.
-- Admin users are assigned by the SUPABASE_ADMIN_EMAILS environment variable.
