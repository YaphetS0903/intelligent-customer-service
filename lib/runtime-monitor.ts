import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { mysqlExecute, mysqlQuery } from "@/lib/mysql";

declare global {
  // eslint-disable-next-line no-var
  var __runtimeMonitorRun: Promise<void> | undefined;
}

const execFileAsync = promisify(execFile);
const stateFile = path.resolve(process.cwd(), process.env.RUNTIME_MONITOR_STATE_FILE || "./.ops/runtime-monitor-state.json");

export async function getRuntimeMonitorOverview() {
  const state = await readLocalState();
  const [samples, alerts] = await Promise.all([
    mysqlQuery<Record<string, unknown>[]>(
      "select * from runtime_monitor_samples order by checked_at desc limit 120"
    ).catch(() => []),
    mysqlQuery<Record<string, unknown>[]>(
      "select * from runtime_alerts order by case when status='open' then 0 else 1 end, last_seen_at desc limit 100"
    ).catch(() => [])
  ]);

  return {
    checked_at: typeof state?.checkedAt === "string" ? state.checkedAt : null,
    thresholds: {
      failure_count: Number(state?.failureThreshold ?? process.env.RUNTIME_MONITOR_FAILURE_THRESHOLD ?? 3),
      latency_ms: Number(state?.latencyWarningMs ?? process.env.RUNTIME_MONITOR_LATENCY_WARNING_MS ?? 3000),
      disk_warning_percent: Number(state?.diskWarningPercent ?? process.env.RUNTIME_MONITOR_DISK_WARNING_PERCENT ?? 15),
      disk_critical_percent: Number(state?.diskCriticalPercent ?? process.env.RUNTIME_MONITOR_DISK_CRITICAL_PERCENT ?? 8)
    },
    checks: Array.isArray(state?.checks) ? state.checks : [],
    local_alerts: Array.isArray(state?.alerts) ? state.alerts : [],
    samples: samples.map(normalizeRow),
    alerts: alerts.map(normalizeRow),
    running: Boolean(globalThis.__runtimeMonitorRun)
  };
}

export async function runRuntimeMonitorNow() {
  if (globalThis.__runtimeMonitorRun) throw new Error("运行监控正在执行");
  const run = execFileAsync(process.execPath, ["scripts/runtime-monitor.mjs"], {
    cwd: process.cwd(),
    env: process.env,
    timeout: 120_000,
    maxBuffer: 1024 * 1024
  }).then(() => undefined);
  globalThis.__runtimeMonitorRun = run;
  try {
    await run;
  } finally {
    globalThis.__runtimeMonitorRun = undefined;
  }
}

export async function resolveRuntimeAlert(id: string) {
  if (!id.trim()) throw new Error("告警 ID 不能为空");
  await mysqlExecute(
    "update runtime_alerts set status='resolved', resolved_at=utc_timestamp(), last_seen_at=utc_timestamp() where id=:id",
    { id: id.trim() }
  );
}

async function readLocalState(): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await fs.readFile(stateFile, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function normalizeRow(row: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [
    key,
    value instanceof Date ? value.toISOString() : key === "metadata" && typeof value === "string" ? parseJson(value) : value
  ]));
}

function parseJson(value: string) {
  try { return JSON.parse(value); } catch { return {}; }
}
