import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import {
  createKnowledgeTaskRetestBatchJob,
  getKnowledgeTaskRetestBatchJob,
  type KnowledgeTaskRetestBatchJob,
  type KnowledgeTaskRetestBatchJobStatus,
  type KnowledgeTaskRetestBatchMode
} from "@/lib/knowledge-task-retest-batch-job";

export type KnowledgeTaskRetestSchedule = {
  enabled: boolean;
  mode: KnowledgeTaskRetestBatchMode;
  limit: number;
  interval_minutes: number;
  next_run_at: string | null;
  last_run_at: string | null;
  last_job_id: string | null;
  last_job_status: KnowledgeTaskRetestBatchJobStatus | "expired" | null;
  last_error: string | null;
  run_count: number;
  updated_by: string | null;
  updated_at: string;
};

const minIntervalMinutes = 30;
const maxIntervalMinutes = 60 * 24 * 14;
const defaultIntervalMinutes = 60 * 24;
const schedulePath = path.join(process.cwd(), ".data", "knowledge-task-retest-schedule.json");

let scheduleCache: KnowledgeTaskRetestSchedule | null = null;
let scheduleLoadPromise: Promise<KnowledgeTaskRetestSchedule> | null = null;
let scheduleTimer: ReturnType<typeof setTimeout> | null = null;

export async function getKnowledgeTaskRetestSchedule() {
  const schedule = await loadKnowledgeTaskRetestSchedule();
  const refreshed = await refreshLastJobStatus(schedule);
  ensureScheduleTimer(refreshed);
  return serializeSchedule(refreshed);
}

export async function updateKnowledgeTaskRetestSchedule(
  input: Partial<Pick<KnowledgeTaskRetestSchedule, "enabled" | "mode" | "limit" | "interval_minutes" | "next_run_at">>,
  updatedBy: string
) {
  const current = await loadKnowledgeTaskRetestSchedule();
  const now = new Date();
  const enabled = typeof input.enabled === "boolean" ? input.enabled : current.enabled;
  const intervalMinutes = normalizeIntervalMinutes(input.interval_minutes ?? current.interval_minutes);
  const intervalChanged = intervalMinutes !== current.interval_minutes;
  const wasEnabled = current.enabled;

  const next: KnowledgeTaskRetestSchedule = {
    ...current,
    enabled,
    mode: normalizeRetestBatchMode(input.mode ?? current.mode),
    limit: normalizeLimit(input.limit ?? current.limit),
    interval_minutes: intervalMinutes,
    updated_by: updatedBy,
    updated_at: now.toISOString()
  };

  if (!enabled) {
    next.next_run_at = null;
  } else if (!wasEnabled || intervalChanged || !isFutureIso(next.next_run_at)) {
    next.next_run_at = addMinutes(now, intervalMinutes);
  } else if (input.next_run_at && isFutureIso(input.next_run_at)) {
    next.next_run_at = input.next_run_at;
  }

  await persistSchedule(next);
  ensureScheduleTimer(next);
  return serializeSchedule(next);
}

export async function runKnowledgeTaskRetestScheduleNow(createdBy: string) {
  const schedule = await loadKnowledgeTaskRetestSchedule();
  const job = createKnowledgeTaskRetestBatchJob({
    mode: schedule.mode,
    limit: schedule.limit,
    createdBy,
    trigger: "schedule",
    triggerReason: "管理员手动按自动复测计划立即执行"
  });
  const next = markScheduleRun(schedule, job, createdBy, new Date());

  await persistSchedule(next);
  ensureScheduleTimer(next);

  return {
    schedule: serializeSchedule(next),
    job
  };
}

async function fireScheduledRetest() {
  clearScheduleTimer();

  try {
    const schedule = await loadKnowledgeTaskRetestSchedule();

    if (!schedule.enabled) {
      return;
    }

    if (schedule.next_run_at && new Date(schedule.next_run_at).getTime() > Date.now()) {
      ensureScheduleTimer(schedule);
      return;
    }

    const runningJob = getActiveLastJob(schedule);
    if (runningJob) {
      const next = {
        ...schedule,
        last_job_status: runningJob.status,
        next_run_at: addMinutes(new Date(), 5),
        updated_at: new Date().toISOString()
      };
      await persistSchedule(next);
      ensureScheduleTimer(next);
      return;
    }

    const job = createKnowledgeTaskRetestBatchJob({
      mode: schedule.mode,
      limit: schedule.limit,
      createdBy: schedule.updated_by ?? "system:auto-retest",
      trigger: "schedule",
      triggerReason: "自动复测计划定时执行"
    });
    const next = markScheduleRun(schedule, job, schedule.updated_by ?? "system:auto-retest", new Date());

    await persistSchedule(next);
    ensureScheduleTimer(next);
  } catch (error) {
    const schedule = scheduleCache ?? defaultSchedule();
    const next: KnowledgeTaskRetestSchedule = {
      ...schedule,
      last_error: error instanceof Error ? error.message : "自动复测计划执行失败",
      next_run_at: schedule.enabled ? addMinutes(new Date(), Math.min(schedule.interval_minutes, 60)) : null,
      updated_at: new Date().toISOString()
    };
    await persistSchedule(next);
    ensureScheduleTimer(next);
  }
}

function markScheduleRun(
  schedule: KnowledgeTaskRetestSchedule,
  job: KnowledgeTaskRetestBatchJob,
  updatedBy: string,
  now: Date
) {
  return {
    ...schedule,
    last_run_at: now.toISOString(),
    last_job_id: job.id,
    last_job_status: job.status,
    last_error: null,
    run_count: schedule.run_count + 1,
    next_run_at: schedule.enabled ? addMinutes(now, schedule.interval_minutes) : schedule.next_run_at,
    updated_by: updatedBy,
    updated_at: now.toISOString()
  };
}

function getActiveLastJob(schedule: KnowledgeTaskRetestSchedule) {
  if (!schedule.last_job_id) {
    return null;
  }

  const job = getKnowledgeTaskRetestBatchJob(schedule.last_job_id);

  if (!job || job.status !== "queued" && job.status !== "running") {
    return null;
  }

  return job;
}

async function refreshLastJobStatus(schedule: KnowledgeTaskRetestSchedule) {
  if (!schedule.last_job_id) {
    return schedule;
  }

  const job = getKnowledgeTaskRetestBatchJob(schedule.last_job_id);

  if (job) {
    const next = {
      ...schedule,
      last_job_status: job.status,
      updated_at: schedule.updated_at
    };
    scheduleCache = next;
    return next;
  }

  if (schedule.last_job_status === "queued" || schedule.last_job_status === "running") {
    const next = {
      ...schedule,
      last_job_status: "expired" as const,
      updated_at: new Date().toISOString()
    };
    await persistSchedule(next);
    return next;
  }

  return schedule;
}

async function loadKnowledgeTaskRetestSchedule() {
  if (scheduleCache) {
    return scheduleCache;
  }

  scheduleLoadPromise ??= readScheduleFromDisk();

  try {
    scheduleCache = await scheduleLoadPromise;
    return scheduleCache;
  } finally {
    scheduleLoadPromise = null;
  }
}

async function readScheduleFromDisk() {
  try {
    const raw = await readFile(schedulePath, "utf8");
    return normalizeSchedule(JSON.parse(raw));
  } catch {
    return defaultSchedule();
  }
}

async function persistSchedule(schedule: KnowledgeTaskRetestSchedule) {
  scheduleCache = serializeSchedule(schedule);
  await mkdir(path.dirname(schedulePath), { recursive: true });
  await writeFile(schedulePath, `${JSON.stringify(scheduleCache, null, 2)}\n`, "utf8");
}

function ensureScheduleTimer(schedule: KnowledgeTaskRetestSchedule) {
  clearScheduleTimer();

  if (!schedule.enabled || !schedule.next_run_at) {
    return;
  }

  const delay = Math.max(new Date(schedule.next_run_at).getTime() - Date.now(), 1000);
  scheduleTimer = setTimeout(() => {
    void fireScheduledRetest();
  }, Math.min(delay, 2_147_483_647));
  scheduleTimer.unref?.();
}

function clearScheduleTimer() {
  if (!scheduleTimer) {
    return;
  }

  clearTimeout(scheduleTimer);
  scheduleTimer = null;
}

function normalizeSchedule(value: unknown): KnowledgeTaskRetestSchedule {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const fallback = defaultSchedule();

  return {
    enabled: typeof record.enabled === "boolean" ? record.enabled : fallback.enabled,
    mode: normalizeRetestBatchMode(record.mode),
    limit: normalizeLimit(record.limit),
    interval_minutes: normalizeIntervalMinutes(record.interval_minutes),
    next_run_at: normalizeIso(record.next_run_at),
    last_run_at: normalizeIso(record.last_run_at),
    last_job_id: typeof record.last_job_id === "string" ? record.last_job_id : null,
    last_job_status: normalizeLastJobStatus(record.last_job_status),
    last_error: typeof record.last_error === "string" ? record.last_error : null,
    run_count: Math.max(Number(record.run_count ?? 0), 0) || 0,
    updated_by: typeof record.updated_by === "string" ? record.updated_by : null,
    updated_at: normalizeIso(record.updated_at) ?? fallback.updated_at
  };
}

function defaultSchedule(): KnowledgeTaskRetestSchedule {
  return {
    enabled: false,
    mode: "open",
    limit: 20,
    interval_minutes: defaultIntervalMinutes,
    next_run_at: null,
    last_run_at: null,
    last_job_id: null,
    last_job_status: null,
    last_error: null,
    run_count: 0,
    updated_by: null,
    updated_at: new Date().toISOString()
  };
}

function normalizeRetestBatchMode(value: unknown): KnowledgeTaskRetestBatchMode {
  if (value === "pending" || value === "processing" || value === "all") {
    return value;
  }

  return "open";
}

function normalizeLastJobStatus(value: unknown): KnowledgeTaskRetestSchedule["last_job_status"] {
  if (
    value === "queued" ||
    value === "running" ||
    value === "completed" ||
    value === "failed" ||
    value === "canceled" ||
    value === "expired"
  ) {
    return value;
  }

  return null;
}

function normalizeLimit(value: unknown) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 50) : 20;
}

function normalizeIntervalMinutes(value: unknown) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed)
    ? Math.min(Math.max(parsed, minIntervalMinutes), maxIntervalMinutes)
    : defaultIntervalMinutes;
}

function normalizeIso(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const time = new Date(value).getTime();
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function isFutureIso(value: string | null) {
  return Boolean(value && new Date(value).getTime() > Date.now());
}

function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60 * 1000).toISOString();
}

function serializeSchedule(schedule: KnowledgeTaskRetestSchedule): KnowledgeTaskRetestSchedule {
  return { ...schedule };
}
