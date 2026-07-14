drop table if exists training_certificates;
drop table if exists training_exam_sessions;
drop table if exists training_quiz_questions;

alter table training_quiz_attempts
  drop column submitted_at,
  drop column started_at,
  drop column duration_seconds,
  drop column attempt_number,
  drop column result_detail,
  drop column session_id;

alter table training_jobs
  drop column certificate_enabled,
  drop column quiz_time_limit_minutes,
  drop column quiz_max_attempts,
  drop column quiz_pass_score,
  drop column quiz_enabled,
  drop column due_at,
  drop column mandatory;
