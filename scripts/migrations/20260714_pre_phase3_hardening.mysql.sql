alter table conversations add column deleted_at datetime null;
alter table conversations add index conversations_deleted_at_idx (deleted_at);

set @duplicate_exam_sessions = (
  select count(*) from (
    select session_id from training_quiz_attempts
    where session_id is not null
    group by session_id
    having count(*) > 1
  ) duplicate_sessions
);
set @assert_exam_sessions = if(
  @duplicate_exam_sessions = 0,
  'select 1',
  'signal sqlstate ''45000'' set message_text = ''存在重复考试 session_id，请先人工核对成绩记录'''
);
prepare assert_exam_sessions_statement from @assert_exam_sessions;
execute assert_exam_sessions_statement;
deallocate prepare assert_exam_sessions_statement;

alter table training_quiz_attempts add unique index training_quiz_attempts_session_unique_idx (session_id);
