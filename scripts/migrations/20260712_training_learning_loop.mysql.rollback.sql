drop table if exists training_audit_events;

alter table training_progress
  drop column last_active_at,
  drop column playback_position_seconds,
  drop column total_learning_seconds,
  drop column page_learning_seconds;

alter table training_jobs
  drop column visible_departments,
  drop column cover_url,
  drop column instructor,
  drop column description;
