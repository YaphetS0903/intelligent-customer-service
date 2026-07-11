import { randomUUID } from "crypto";
import { listKnowledgeTasks } from "@/lib/db";
import { retestKnowledgeTask } from "@/lib/knowledge-task-retest";
import type { WorkStatus } from "@/lib/types";

export type KnowledgeTaskRetestBatchJobStatus = "queued" | "running" | "completed" | "failed" | "canceled";
export type KnowledgeTaskRetestBatchMode = "open" | "pending" | "processing" | "all";

export type KnowledgeTaskRetestBatchJob = {
  id: string;
  mode: KnowledgeTaskRetestBatchMode;
  status: KnowledgeTaskRetestBatchJobStatus;
  limit: number;
  task_ids: string[];
  trigger: "manual" | "governance" | "schedule" | "strategy";
  trigger_reason: string | null;
  total: number;
  completed: number;
  resolved: number;
  processing: number;
  ignored: number;
  failed: number;
  current_question: string | null;
  errors: string[];
  results: Array<{
    id: string;
    status: "ready" | "failed";
    task_status?: WorkStatus;
    error?: string;
  }>;
  cancel_requested: boolean;
  created_by: string;
  created_at: string;
  started_at: string | null;
  updated_at: string;
  finished_at: string | null;
};

const jobs = new Map<string, KnowledgeTaskRetestBatchJob>();

export function createKnowledgeTaskRetestBatchJob(input: {
  mode?: string;
  limit?: number;
  createdBy: string;
  taskIds?: string[];
  trigger?: "manual" | "governance" | "schedule" | "strategy";
  triggerReason?: string | null;
}) {
  cleanupKnowledgeTaskRetestBatchJobs();

  const now = new Date().toISOString();
  const job: KnowledgeTaskRetestBatchJob = {
    id: `taskretest-${randomUUID()}`,
    mode: normalizeRetestBatchMode(input.mode),
    status: "queued",
    limit: Math.min(Math.max(Number(input.limit ?? 20), 1), 50),
    task_ids: cleanTaskIds(input.taskIds),
    trigger: input.trigger ?? "manual",
    trigger_reason: input.triggerReason?.trim() || null,
    total: 0,
    completed: 0,
    resolved: 0,
    processing: 0,
    ignored: 0,
    failed: 0,
    current_question: null,
    errors: [],
    results: [],
    cancel_requested: false,
    created_by: input.createdBy,
    created_at: now,
    started_at: null,
    updated_at: now,
    finished_at: null
  };

  jobs.set(job.id, job);
  void runKnowledgeTaskRetestBatchJob(job.id);

  return serializeKnowledgeTaskRetestBatchJob(job);
}

export function getKnowledgeTaskRetestBatchJob(id: string) {
  const job = jobs.get(id);
  return job ? serializeKnowledgeTaskRetestBatchJob(job) : null;
}

export function cancelKnowledgeTaskRetestBatchJob(id: string) {
  const job = jobs.get(id);

  if (!job) {
    return null;
  }

  if (job.status === "queued" || job.status === "running") {
    job.cancel_requested = true;
    touch(job);
  }

  return serializeKnowledgeTaskRetestBatchJob(job);
}

function normalizeRetestBatchMode(value: unknown): KnowledgeTaskRetestBatchMode {
  if (value === "pending" || value === "processing" || value === "all") {
    return value;
  }

  return "open";
}

async function runKnowledgeTaskRetestBatchJob(jobId: string) {
  const job = jobs.get(jobId);

  if (!job) {
    return;
  }

  job.status = "running";
  job.started_at = new Date().toISOString();
  touch(job);

  try {
    const taskIds = new Set(job.task_ids);
    const candidates = (await listKnowledgeTasks())
      .filter((task) => task.source === "manual" && task.source_id?.startsWith("qa:"))
      .filter((task) => taskIds.size === 0 || taskIds.has(task.id))
      .filter((task) => shouldRetestTaskForMode(task.status, job.mode))
      .slice(0, job.limit);

    job.total = candidates.length;
    touch(job);

    for (const task of candidates) {
      if (job.cancel_requested) {
        finish(job, "canceled");
        return;
      }

      job.current_question = task.question;
      touch(job);

      try {
        const result = await retestKnowledgeTask(task.id);
        if (result.status === "resolved") {
          job.resolved += 1;
        } else if (result.status === "ignored") {
          job.ignored += 1;
        } else {
          job.processing += 1;
        }
        job.results.push({
          id: task.id,
          status: "ready",
          task_status: result.status
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "复测失败";
        job.failed += 1;
        job.errors.push(`${task.question}：${message}`);
        job.errors = job.errors.slice(-10);
        job.results.push({
          id: task.id,
          status: "failed",
          error: message
        });
      } finally {
        job.completed += 1;
        touch(job);
      }
    }

    finish(job, job.cancel_requested ? "canceled" : "completed");
  } catch (error) {
    const message = error instanceof Error ? error.message : "批量复测失败";
    job.errors.push(message);
    finish(job, "failed");
  }
}

function shouldRetestTaskForMode(status: WorkStatus, mode: KnowledgeTaskRetestBatchMode) {
  if (mode === "all") {
    return status !== "ignored";
  }

  if (mode === "pending") {
    return status === "pending";
  }

  if (mode === "processing") {
    return status === "processing";
  }

  return status === "pending" || status === "processing";
}

function touch(job: KnowledgeTaskRetestBatchJob) {
  job.updated_at = new Date().toISOString();
}

function finish(job: KnowledgeTaskRetestBatchJob, status: KnowledgeTaskRetestBatchJobStatus) {
  job.status = status;
  job.current_question = status === "completed"
    ? "整改复测完成"
    : status === "canceled"
      ? "整改复测已停止"
      : job.current_question;
  job.finished_at = new Date().toISOString();
  touch(job);
}

function serializeKnowledgeTaskRetestBatchJob(job: KnowledgeTaskRetestBatchJob): KnowledgeTaskRetestBatchJob {
  return {
    ...job,
    task_ids: [...job.task_ids],
    errors: [...job.errors],
    results: job.results.slice(-50).map((result) => ({ ...result }))
  };
}

function cleanTaskIds(value: string[] | undefined) {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const item of value ?? []) {
    const id = String(item ?? "").trim();

    if (!id || seen.has(id)) {
      continue;
    }

    seen.add(id);
    result.push(id);

    if (result.length >= 50) {
      break;
    }
  }

  return result;
}

function cleanupKnowledgeTaskRetestBatchJobs() {
  const now = Date.now();
  const terminalStatuses = new Set<KnowledgeTaskRetestBatchJobStatus>(["completed", "failed", "canceled"]);

  for (const [id, job] of jobs) {
    if (!terminalStatuses.has(job.status)) {
      continue;
    }

    const finishedAt = job.finished_at ? new Date(job.finished_at).getTime() : 0;
    if (finishedAt && now - finishedAt > 1000 * 60 * 60 * 12) {
      jobs.delete(id);
    }
  }

  const terminalJobs = [...jobs.values()]
    .filter((job) => terminalStatuses.has(job.status))
    .sort((a, b) => new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime());

  while (jobs.size > 30 && terminalJobs.length > 0) {
    const oldest = terminalJobs.shift();
    if (oldest) {
      jobs.delete(oldest.id);
    }
  }
}
