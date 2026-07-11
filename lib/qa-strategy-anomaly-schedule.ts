import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import { generateQaRemediationTasks, toRemediationCandidate } from "@/lib/qa-remediation";
import { notifyAdmins } from "@/lib/notification-events";
import { listModelUsageEvents, listQaTestCases } from "@/lib/db";
import type { ModelUsageEvent, QaTestCase } from "@/lib/types";

export type QaStrategyAnomalySchedule = {
  enabled: boolean;
  interval_minutes: number;
  window_days: number;
  limit: number;
  next_run_at: string | null;
  last_run_at: string | null;
  last_error: string | null;
  last_result: QaStrategyAnomalyRunResult | null;
  run_count: number;
  updated_by: string | null;
  updated_at: string;
};

export type QaStrategyAnomalyRunResult = {
  trigger: "manual" | "schedule";
  event_count: number;
  qa_sample_count: number;
  candidate_count: number;
  created_count: number;
  skipped_count: number;
  candidate_test_ids: string[];
  created_task_ids: string[];
  skipped_test_ids: string[];
  window_days: number;
  limit: number;
  started_at: string;
  finished_at: string;
};

const minIntervalMinutes = 30;
const maxIntervalMinutes = 60 * 24 * 14;
const defaultIntervalMinutes = 60 * 24;
const defaultWindowDays = 90;
const maxWindowDays = 365;
const schedulePath = path.join(process.cwd(), ".data", "qa-strategy-anomaly-schedule.json");

let scheduleCache: QaStrategyAnomalySchedule | null = null;
let scheduleLoadPromise: Promise<QaStrategyAnomalySchedule> | null = null;
let scheduleTimer: ReturnType<typeof setTimeout> | null = null;
let scheduledRunPromise: Promise<void> | null = null;

export async function getQaStrategyAnomalySchedule() {
  const schedule = await loadQaStrategyAnomalySchedule();
  ensureScheduleTimer(schedule);
  return serializeSchedule(schedule);
}

export async function updateQaStrategyAnomalySchedule(
  input: Partial<Pick<QaStrategyAnomalySchedule, "enabled" | "interval_minutes" | "window_days" | "limit" | "next_run_at">>,
  updatedBy: string
) {
  const current = await loadQaStrategyAnomalySchedule();
  const now = new Date();
  const enabled = typeof input.enabled === "boolean" ? input.enabled : current.enabled;
  const intervalMinutes = normalizeIntervalMinutes(input.interval_minutes ?? current.interval_minutes);
  const intervalChanged = intervalMinutes !== current.interval_minutes;
  const wasEnabled = current.enabled;

  const next: QaStrategyAnomalySchedule = {
    ...current,
    enabled,
    interval_minutes: intervalMinutes,
    window_days: normalizeWindowDays(input.window_days ?? current.window_days),
    limit: normalizeLimit(input.limit ?? current.limit),
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

export async function runQaStrategyAnomalyScheduleNow(createdBy: string) {
  const schedule = await loadQaStrategyAnomalySchedule();
  const result = await runQaStrategyAnomalySweep({
    createdBy,
    trigger: "manual",
    windowDays: schedule.window_days,
    limit: schedule.limit
  });
  const next = markScheduleRun(schedule, result, createdBy, new Date());

  await persistSchedule(next);
  ensureScheduleTimer(next);

  return {
    schedule: serializeSchedule(next),
    result
  };
}

export async function runQaStrategyAnomalySweep(input: {
  createdBy: string;
  trigger: "manual" | "schedule";
  windowDays: number;
  limit: number;
}): Promise<QaStrategyAnomalyRunResult> {
  const startedAt = new Date().toISOString();
  const windowDays = normalizeWindowDays(input.windowDays);
  const limit = normalizeLimit(input.limit);
  const [events, tests] = await Promise.all([
    retryDbRead(() => listModelUsageEvents(1000, { source: "qa" }), "qa-strategy-anomaly:usage", 2),
    retryDbRead(() => listQaTestCases({ compactCitations: true }), "qa-strategy-anomaly:tests", 2)
  ]);
  const candidates = collectAnomalyCandidates(events, tests, windowDays, limit);
  const result = await generateQaRemediationTasks({
    createdBy: input.createdBy,
    testIds: candidates.testIds,
    limit
  });

  const runResult: QaStrategyAnomalyRunResult = {
    trigger: input.trigger,
    event_count: candidates.eventCount,
    qa_sample_count: candidates.qaSampleCount,
    candidate_count: candidates.testIds.length,
    created_count: result.created.length,
    skipped_count: result.skipped.length,
    candidate_test_ids: candidates.testIds,
    created_task_ids: result.created.map((task) => task.id),
    skipped_test_ids: result.skipped.map((item) => item.test_id),
    window_days: windowDays,
    limit,
    started_at: startedAt,
    finished_at: new Date().toISOString()
  };
  if (runResult.candidate_count > 0) {
    await notifyAdmins({
      category: "qa",
      severity: runResult.created_count > 0 ? "warning" : "info",
      title: "QA 策略异常巡检发现风险",
      body: `本次发现 ${runResult.candidate_count} 条异常 QA，新增 ${runResult.created_count} 条整改任务，跳过 ${runResult.skipped_count} 条已有任务。`,
      href: "/admin/qa-tests",
      source_type: "qa_strategy_anomaly_run",
      source_id: runResult.finished_at,
      dedupe_key: `qa-anomaly:${runResult.finished_at}`,
      metadata: {
        trigger: runResult.trigger,
        candidate_count: runResult.candidate_count,
        created_count: runResult.created_count,
        skipped_count: runResult.skipped_count,
        created_task_ids: runResult.created_task_ids
      }
    });
  }
  return runResult;
}

async function fireScheduledSweep() {
  clearScheduleTimer();

  if (scheduledRunPromise) {
    return scheduledRunPromise;
  }

  scheduledRunPromise = (async () => {
    try {
      const schedule = await loadQaStrategyAnomalySchedule();

      if (!schedule.enabled) {
        return;
      }

      if (schedule.next_run_at && new Date(schedule.next_run_at).getTime() > Date.now()) {
        ensureScheduleTimer(schedule);
        return;
      }

      const result = await runQaStrategyAnomalySweep({
        createdBy: schedule.updated_by ?? "system:qa-strategy-anomaly",
        trigger: "schedule",
        windowDays: schedule.window_days,
        limit: schedule.limit
      });
      const next = markScheduleRun(schedule, result, schedule.updated_by ?? "system:qa-strategy-anomaly", new Date());

      await persistSchedule(next);
      ensureScheduleTimer(next);
    } catch (error) {
      const schedule = scheduleCache ?? defaultSchedule();
      const next: QaStrategyAnomalySchedule = {
        ...schedule,
        last_error: error instanceof Error ? error.message : "策略异常巡检失败",
        next_run_at: schedule.enabled ? addMinutes(new Date(), Math.min(schedule.interval_minutes, 60)) : null,
        updated_at: new Date().toISOString()
      };
      await persistSchedule(next);
      await notifyAdmins({
        category: "qa",
        severity: "critical",
        title: "QA 策略异常巡检失败",
        body: next.last_error ?? "策略异常巡检失败，请检查数据库与任务状态。",
        href: "/admin/qa-tests",
        source_type: "qa_strategy_anomaly_error",
        source_id: next.updated_at,
        dedupe_key: `qa-anomaly-error:${next.updated_at}`,
        metadata: { next_run_at: next.next_run_at, error: next.last_error }
      });
      ensureScheduleTimer(next);
    } finally {
      scheduledRunPromise = null;
    }
  })();

  return scheduledRunPromise;
}

function collectAnomalyCandidates(
  events: ModelUsageEvent[],
  tests: QaTestCase[],
  windowDays: number,
  limit: number
) {
  const testById = new Map(tests.map((test) => [test.id, test]));
  const scopedEvents = filterEventsByWindow(events, windowDays);
  const sampleIds = [...new Set(scopedEvents.map((event) => event.source_id).filter((id): id is string => Boolean(id && testById.has(id))))];
  const sampleTests = (sampleIds.length > 0 ? sampleIds.map((id) => testById.get(id)) : tests)
    .filter((test): test is QaTestCase => Boolean(test));
  const testIds = sampleTests
    .map((test) => ({ test, risk: scoreQaAnomalyRisk(test) }))
    .filter((item) => item.risk > 0 && toRemediationCandidate(item.test))
    .sort((a, b) => b.risk - a.risk || new Date(b.test.updated_at).getTime() - new Date(a.test.updated_at).getTime())
    .slice(0, limit)
    .map((item) => item.test.id);

  return {
    eventCount: scopedEvents.length,
    qaSampleCount: sampleTests.length,
    testIds
  };
}

function scoreQaAnomalyRisk(test: QaTestCase) {
  let score = 0;

  if (!test.answer) {
    score += 12;
  }
  if (test.status === "failed") {
    score += 40;
  }
  if (test.answer && test.citations.length === 0) {
    score += 30;
  }
  if (test.answer?.includes("未在知识库中找到明确依据")) {
    score += 30;
  }

  const candidate = toRemediationCandidate(test);
  if (candidate?.coverage.coverage !== undefined && candidate.coverage.coverage < 60) {
    score += 60 - candidate.coverage.coverage;
  }
  if (candidate?.coverage.missing.length) {
    score += Math.min(candidate.coverage.missing.length * 3, 18);
  }

  return Math.round(score);
}

function filterEventsByWindow(events: ModelUsageEvent[], windowDays: number) {
  const timestamps = events
    .map((event) => new Date(event.created_at).getTime())
    .filter((time) => Number.isFinite(time));
  const endTime = timestamps.length > 0 ? Math.max(...timestamps) : Date.now();
  const startTime = endTime - windowDays * 24 * 60 * 60 * 1000;

  return events.filter((event) => {
    const time = new Date(event.created_at).getTime();
    return Number.isFinite(time) && time >= startTime && time <= endTime;
  });
}

function markScheduleRun(
  schedule: QaStrategyAnomalySchedule,
  result: QaStrategyAnomalyRunResult,
  updatedBy: string,
  now: Date
) {
  return {
    ...schedule,
    last_run_at: now.toISOString(),
    last_error: null,
    last_result: result,
    run_count: schedule.run_count + 1,
    next_run_at: schedule.enabled ? addMinutes(now, schedule.interval_minutes) : schedule.next_run_at,
    updated_by: updatedBy,
    updated_at: now.toISOString()
  };
}

async function loadQaStrategyAnomalySchedule() {
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

async function persistSchedule(schedule: QaStrategyAnomalySchedule) {
  scheduleCache = serializeSchedule(schedule);
  await mkdir(path.dirname(schedulePath), { recursive: true });
  await writeFile(schedulePath, `${JSON.stringify(scheduleCache, null, 2)}\n`, "utf8");
}

function ensureScheduleTimer(schedule: QaStrategyAnomalySchedule) {
  clearScheduleTimer();

  if (!schedule.enabled || !schedule.next_run_at) {
    return;
  }

  const delay = Math.max(new Date(schedule.next_run_at).getTime() - Date.now(), 1000);
  scheduleTimer = setTimeout(() => {
    void fireScheduledSweep();
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

async function retryDbRead<T>(operation: () => Promise<T>, label: string, attempts = 2): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      console.warn(`[${label}] read failed, attempt ${attempt}/${attempts}`, error);
      if (attempt < attempts) {
        await sleep(700 * attempt);
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error("读取数据库失败");
}

function normalizeSchedule(value: unknown): QaStrategyAnomalySchedule {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const fallback = defaultSchedule();

  return {
    enabled: typeof record.enabled === "boolean" ? record.enabled : fallback.enabled,
    interval_minutes: normalizeIntervalMinutes(record.interval_minutes),
    window_days: normalizeWindowDays(record.window_days),
    limit: normalizeLimit(record.limit),
    next_run_at: normalizeIso(record.next_run_at),
    last_run_at: normalizeIso(record.last_run_at),
    last_error: typeof record.last_error === "string" ? record.last_error : null,
    last_result: normalizeLastResult(record.last_result),
    run_count: Math.max(Number(record.run_count ?? 0), 0) || 0,
    updated_by: typeof record.updated_by === "string" ? record.updated_by : null,
    updated_at: normalizeIso(record.updated_at) ?? fallback.updated_at
  };
}

function defaultSchedule(): QaStrategyAnomalySchedule {
  return {
    enabled: false,
    interval_minutes: defaultIntervalMinutes,
    window_days: defaultWindowDays,
    limit: 20,
    next_run_at: null,
    last_run_at: null,
    last_error: null,
    last_result: null,
    run_count: 0,
    updated_by: null,
    updated_at: new Date().toISOString()
  };
}

function normalizeLastResult(value: unknown): QaStrategyAnomalyRunResult | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;

  return {
    trigger: record.trigger === "schedule" ? "schedule" : "manual",
    event_count: Math.max(Number(record.event_count ?? 0), 0) || 0,
    qa_sample_count: Math.max(Number(record.qa_sample_count ?? 0), 0) || 0,
    candidate_count: Math.max(Number(record.candidate_count ?? 0), 0) || 0,
    created_count: Math.max(Number(record.created_count ?? 0), 0) || 0,
    skipped_count: Math.max(Number(record.skipped_count ?? 0), 0) || 0,
    candidate_test_ids: normalizeStringArray(record.candidate_test_ids, 50),
    created_task_ids: normalizeStringArray(record.created_task_ids, 50),
    skipped_test_ids: normalizeStringArray(record.skipped_test_ids, 50),
    window_days: normalizeWindowDays(record.window_days),
    limit: normalizeLimit(record.limit),
    started_at: normalizeIso(record.started_at) ?? new Date().toISOString(),
    finished_at: normalizeIso(record.finished_at) ?? new Date().toISOString()
  };
}

function normalizeStringArray(value: unknown, limit: number) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => String(item ?? "").trim())
    .filter(Boolean)
    .slice(0, limit);
}

function normalizeLimit(value: unknown) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 50) : 20;
}

function normalizeWindowDays(value: unknown) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? Math.min(Math.max(parsed, 7), maxWindowDays) : defaultWindowDays;
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

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function serializeSchedule(schedule: QaStrategyAnomalySchedule): QaStrategyAnomalySchedule {
  return {
    ...schedule,
    last_result: schedule.last_result ? { ...schedule.last_result } : null
  };
}
