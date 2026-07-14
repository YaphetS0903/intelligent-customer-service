import { listTrainingProgress, listUsers } from "@/lib/db";
import { notifyUsers } from "@/lib/notification-events";
import type { TrainingJob } from "@/lib/types";

export async function notifyTrainingPublished(job: TrainingJob) {
  const users = await visibleActiveEmployees(job);
  return notifyUsers(users.map((user) => user.id), {
    category: "system",
    severity: job.mandatory ? "warning" : "info",
    title: job.mandatory ? "新的必修课程" : "新的培训课程",
    body: buildAssignmentBody(job),
    href: `/training/${job.id}`,
    source_type: "training_course",
    source_id: job.id,
    dedupe_key: `training-published:${job.id}:${job.published_at ?? "published"}`,
    metadata: { training_job_id: job.id, mandatory: job.mandatory, due_at: job.due_at }
  });
}

export async function sendTrainingDueReminders(job: TrainingJob) {
  if (job.publish_status !== "published") throw new Error("课程未发布，不能发送学习提醒");
  const [users, progress] = await Promise.all([visibleActiveEmployees(job), listTrainingProgress()]);
  const completed = new Set(progress.filter((item) => item.training_job_id === job.id && item.progress_percent >= 100).map((item) => item.user_id));
  const recipients = users.filter((user) => !completed.has(user.id));
  const dateKey = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date());
  const notifications = await Promise.all(recipients.map((user) => notifyUsers([user.id], {
    category: "system",
    severity: isOverdue(job.due_at) ? "critical" : "warning",
    title: isOverdue(job.due_at) ? "必修课程已逾期" : "请完成培训课程",
    body: buildReminderBody(job),
    href: `/training/${job.id}`,
    source_type: "training_reminder",
    source_id: job.id,
    dedupe_key: `training-reminder:${job.id}:${user.id}:${dateKey}`,
    metadata: { training_job_id: job.id, mandatory: job.mandatory, due_at: job.due_at, overdue: isOverdue(job.due_at) }
  })));
  return { eligible: users.length, completed: completed.size, reminded: recipients.length, notifications: notifications.flat().length };
}

async function visibleActiveEmployees(job: TrainingJob) {
  const users = await listUsers();
  return users.filter((user) => user.role === "employee" && user.status === "active" && (job.visible_departments.length === 0 || job.visible_departments.includes(user.department)));
}

function buildAssignmentBody(job: TrainingJob) {
  const due = formatDueDate(job.due_at);
  return `${job.title} 已发布${due ? `，请在 ${due} 前完成` : "，可以开始学习"}。`;
}

function buildReminderBody(job: TrainingJob) {
  const due = formatDueDate(job.due_at);
  return isOverdue(job.due_at)
    ? `${job.title} 的完成期限${due ? `为 ${due}` : "已到"}，请尽快完成学习和考试。`
    : `${job.title} 尚未完成${due ? `，完成期限为 ${due}` : ""}，请安排学习。`;
}

function formatDueDate(value: string | null) {
  return value ? new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long", day: "numeric", timeZone: "Asia/Shanghai" }).format(new Date(value)) : null;
}

function isOverdue(value: string | null) {
  return Boolean(value && new Date(value).getTime() < Date.now());
}
