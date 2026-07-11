import type { TrainingJob, UserProfile } from "@/lib/types";

export function canAccessTrainingJob(user: UserProfile, job: TrainingJob) {
  if (user.role === "admin") return true;
  if (job.publish_status !== "published" || job.status !== "ready") return false;
  if (job.visible_departments.length === 0) return true;
  return Boolean(user.department && job.visible_departments.includes(user.department));
}

export function validateTrainingPublish(job: TrainingJob) {
  if (job.status !== "ready") return "课程讲稿未生成完成，暂不能发布";
  if (!job.title.trim()) return "请填写课程标题";
  if (!job.description.trim()) return "请填写课程简介";
  if (!job.instructor.trim()) return "请填写讲师或负责部门";
  if (job.script_json.length === 0 || job.script_json.some((slide) => !slide.script.trim())) {
    return "课程存在空白讲稿，暂不能发布";
  }
  return null;
}
