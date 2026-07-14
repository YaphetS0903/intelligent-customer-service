alter table training_quiz_attempts drop index training_quiz_attempts_session_unique_idx;

alter table conversations drop index conversations_deleted_at_idx;
alter table conversations drop column deleted_at;
