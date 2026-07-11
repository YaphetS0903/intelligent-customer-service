alter table public.training_jobs
  drop constraint if exists training_jobs_ppt_document_id_fkey;

alter table public.training_jobs
  drop column if exists ppt_document_id;

alter table public.training_jobs
  add column if not exists ppt_file_name text not null default '',
  add column if not exists ppt_storage_path text;

alter table public.training_jobs
  alter column script_json set default '[]'::jsonb;

update public.training_jobs
set script_json = '[]'::jsonb
where script_json is null;

alter table public.training_jobs
  alter column script_json set not null;

create index if not exists training_jobs_created_at_idx on public.training_jobs(created_at);
