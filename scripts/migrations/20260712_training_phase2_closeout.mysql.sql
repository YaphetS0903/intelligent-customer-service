alter table training_jobs add column mandatory boolean not null default false;
alter table training_jobs add column due_at datetime null;
alter table training_jobs add column quiz_enabled boolean not null default false;
alter table training_jobs add column quiz_pass_score int not null default 80;
alter table training_jobs add column quiz_max_attempts int not null default 3;
alter table training_jobs add column quiz_time_limit_minutes int not null default 30;
alter table training_jobs add column certificate_enabled boolean not null default true;

alter table training_quiz_attempts add column session_id varchar(128) null;
alter table training_quiz_attempts add column result_detail json null;
update training_quiz_attempts set result_detail = json_array() where result_detail is null;
alter table training_quiz_attempts modify column result_detail json not null;
alter table training_quiz_attempts add column attempt_number int not null default 1;
alter table training_quiz_attempts add column duration_seconds int not null default 0;
alter table training_quiz_attempts add column started_at datetime null;
update training_quiz_attempts set started_at = created_at where started_at is null;
alter table training_quiz_attempts modify column started_at datetime not null;
alter table training_quiz_attempts add column submitted_at datetime null;
update training_quiz_attempts set submitted_at = created_at where submitted_at is null;
alter table training_quiz_attempts modify column submitted_at datetime not null;

create table training_quiz_questions (
  id varchar(128) primary key,
  training_job_id varchar(128) not null,
  type varchar(32) not null,
  prompt text not null,
  options json not null,
  correct_answers json not null,
  explanation text not null,
  score_weight int not null default 1,
  order_index int not null default 0,
  status varchar(32) not null default 'draft',
  created_by varchar(128) null,
  created_at datetime not null default current_timestamp,
  updated_at datetime not null default current_timestamp,
  index training_quiz_questions_job_idx (training_job_id, status, order_index)
);

create table training_exam_sessions (
  id varchar(128) primary key,
  training_job_id varchar(128) not null,
  user_id varchar(128) not null,
  question_snapshot json not null,
  status varchar(32) not null default 'in_progress',
  started_at datetime not null,
  expires_at datetime not null,
  submitted_at datetime null,
  created_at datetime not null default current_timestamp,
  index training_exam_sessions_user_job_idx (training_job_id, user_id, status),
  index training_exam_sessions_expires_idx (status, expires_at)
);

create table training_certificates (
  id varchar(128) primary key,
  certificate_no varchar(64) not null,
  training_job_id varchar(128) not null,
  user_id varchar(128) not null,
  quiz_attempt_id varchar(128) not null,
  issued_at datetime not null,
  revoked_at datetime null,
  revoked_by varchar(128) null,
  revoke_reason text null,
  created_at datetime not null default current_timestamp,
  unique index training_certificates_no_unique_idx (certificate_no),
  unique index training_certificates_user_job_unique_idx (training_job_id, user_id),
  index training_certificates_user_idx (user_id, issued_at)
);
