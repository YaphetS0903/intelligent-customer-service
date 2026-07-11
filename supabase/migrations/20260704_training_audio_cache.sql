alter table public.training_jobs
  add column if not exists audio_paths text[] not null default '{}';

update public.training_jobs
set audio_paths = '{}'
where audio_paths is null;

alter table public.training_jobs
  alter column audio_paths set default '{}';
