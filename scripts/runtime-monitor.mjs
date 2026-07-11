#!/usr/bin/env node
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";

const cwd = process.cwd();
const fileEnv = readEnvFile(path.resolve(cwd, process.env.ENV_FILE || ".env.local"));
const stateFile = path.resolve(cwd, process.env.RUNTIME_MONITOR_STATE_FILE || "./.ops/runtime-monitor-state.json");
const failureThreshold = readPositiveInt(process.env.RUNTIME_MONITOR_FAILURE_THRESHOLD, 3);
const latencyWarningMs = readPositiveInt(process.env.RUNTIME_MONITOR_LATENCY_WARNING_MS, 3000);
const diskWarningPercent = readPositiveNumber(process.env.RUNTIME_MONITOR_DISK_WARNING_PERCENT, 15);
const diskCriticalPercent = readPositiveNumber(process.env.RUNTIME_MONITOR_DISK_CRITICAL_PERCENT, 8);
const requestTimeoutMs = readPositiveInt(process.env.RUNTIME_MONITOR_REQUEST_TIMEOUT_MS, 10_000);
const baseUrl = readConfig("RUNTIME_MONITOR_BASE_URL") || readConfig("APP_BASE_URL") || "http://127.0.0.1:3020";
const endpoints = parseEndpoints(readConfig("RUNTIME_MONITOR_ENDPOINTS") || "/login:200,/api/auth/me:401");
const previousState = await readJsonFile(stateFile) ?? { checks: [], alerts: [] };
const checkedAt = new Date().toISOString();

const config = {
  host: readConfig("MYSQL_HOST"),
  port: Number(readConfig("MYSQL_PORT") || "3306"),
  database: readConfig("MYSQL_DATABASE"),
  user: readConfig("MYSQL_USER"),
  password: readConfig("MYSQL_PASSWORD")
};

let connection = null;
const checks = [];

try {
  const databaseCheck = await checkDatabase();
  checks.push(withConsecutiveState(databaseCheck));
  checks.push(withConsecutiveState(await checkDisk()));
  for (const endpoint of endpoints) {
    checks.push(withConsecutiveState(await checkEndpoint(endpoint)));
  }

  const alerts = buildActiveAlerts(checks);
  const state = {
    checkedAt,
    failureThreshold,
    latencyWarningMs,
    diskWarningPercent,
    diskCriticalPercent,
    checks,
    alerts
  };
  await writeJsonAtomic(stateFile, state);

  if (connection) {
    await ensureMonitorTables();
    await persistSamples(checks);
    await syncAlerts(alerts, previousState.alerts ?? []);
    await cleanupSamples();
  }

  const failed = checks.filter((check) => check.status === "failed").length;
  console.log(`Runtime monitor complete: ${checks.length} checks, ${failed} failed, ${alerts.length} active alerts`);
  console.log(JSON.stringify(state));
} catch (error) {
  console.error(error instanceof Error ? error.stack || error.message : "Runtime monitor failed");
  process.exitCode = 1;
} finally {
  await connection?.end().catch(() => {});
}

async function checkDatabase() {
  const startedAt = Date.now();
  try {
    connection = await mysql.createConnection({
      host: config.host,
      port: config.port,
      database: config.database,
      user: config.user,
      password: config.password,
      connectTimeout: 10_000,
      namedPlaceholders: true,
      timezone: "Z"
    });
    await connection.query({ sql: "select 1 as ok", timeout: requestTimeoutMs });
    return checkResult("database", config.database || "mysql", "ready", Date.now() - startedAt, null, "数据库连接正常");
  } catch (error) {
    connection?.destroy();
    connection = null;
    return checkResult("database", config.database || "mysql", "failed", Date.now() - startedAt, null, errorMessage(error));
  }
}

async function checkDisk() {
  try {
    const stats = await fsp.statfs(cwd);
    const total = Number(stats.blocks) * Number(stats.bsize);
    const free = Number(stats.bavail) * Number(stats.bsize);
    const freePercent = total > 0 ? free / total * 100 : 0;
    return {
      ...checkResult("disk", cwd, freePercent <= diskCriticalPercent ? "failed" : freePercent <= diskWarningPercent ? "warning" : "ready", 0, null, `磁盘可用 ${freePercent.toFixed(1)}%`),
      metric_value: Number(freePercent.toFixed(2)),
      metric_unit: "percent_free"
    };
  } catch (error) {
    return checkResult("disk", cwd, "failed", 0, null, errorMessage(error));
  }
}

async function checkEndpoint(endpoint) {
  const url = new URL(endpoint.path, baseUrl).toString();
  const startedAt = Date.now();
  try {
    const response = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(requestTimeoutMs),
      headers: { "User-Agent": "tianrui-runtime-monitor/1.0" }
    });
    const latencyMs = Date.now() - startedAt;
    const ok = response.status === endpoint.expectedStatus;
    return checkResult(
      "endpoint",
      endpoint.path,
      ok ? "ready" : "failed",
      latencyMs,
      response.status,
      ok ? `HTTP ${response.status}` : `期望 HTTP ${endpoint.expectedStatus}，实际 ${response.status}`
    );
  } catch (error) {
    return checkResult("endpoint", endpoint.path, "failed", Date.now() - startedAt, null, errorMessage(error));
  }
}

function withConsecutiveState(check) {
  const previous = (previousState.checks ?? []).find((item) => item.type === check.type && item.target === check.target);
  const failed = check.status === "failed";
  const slow = check.status === "ready" && check.latency_ms >= latencyWarningMs && check.type !== "disk";
  return {
    ...check,
    consecutive_failures: failed ? Number(previous?.consecutive_failures ?? 0) + 1 : 0,
    consecutive_slow: slow ? Number(previous?.consecutive_slow ?? 0) + 1 : 0
  };
}

function buildActiveAlerts(currentChecks) {
  const alerts = [];
  for (const check of currentChecks) {
    if (check.type === "disk" && Number(check.metric_value) <= diskWarningPercent) {
      const critical = Number(check.metric_value) <= diskCriticalPercent;
      alerts.push(alertFor(check, "disk_low", critical ? "critical" : "warning", critical ? "服务器磁盘空间严重不足" : "服务器磁盘空间不足"));
      continue;
    }
    if (check.consecutive_failures >= failureThreshold) {
      const category = check.type === "database" ? "database_unavailable" : check.type === "endpoint" ? "endpoint_unavailable" : "runtime_failure";
      alerts.push(alertFor(check, category, "critical", check.type === "database" ? "数据库连续连接失败" : `${check.target} 连续访问失败`));
      continue;
    }
    if (check.consecutive_slow >= failureThreshold) {
      alerts.push(alertFor(check, "endpoint_slow", "warning", `${check.target} 连续响应缓慢`));
    }
  }
  return alerts;
}

function alertFor(check, category, severity, title) {
  return {
    fingerprint: `${category}:${check.type}:${check.target}`,
    category,
    severity,
    title,
    detail: `${check.detail}；连续失败 ${check.consecutive_failures} 次；延迟 ${check.latency_ms}ms`,
    first_seen_at: checkedAt,
    last_seen_at: checkedAt,
    metadata: { check }
  };
}

async function ensureMonitorTables() {
  await connection.query(`create table if not exists runtime_monitor_samples (
    id varchar(128) primary key,
    target_type varchar(32) not null,
    target varchar(255) not null,
    status varchar(32) not null,
    latency_ms int not null default 0,
    status_code int null,
    detail text null,
    metric_value decimal(16,4) null,
    metric_unit varchar(64) null,
    checked_at datetime not null,
    index runtime_monitor_samples_target_idx (target_type, target, checked_at),
    index runtime_monitor_samples_checked_idx (checked_at)
  )`);
  await connection.query(`create table if not exists runtime_alerts (
    id varchar(128) primary key,
    fingerprint varchar(255) not null,
    category varchar(64) not null,
    severity varchar(32) not null,
    title varchar(255) not null,
    detail text not null,
    status varchar(32) not null default 'open',
    occurrence_count int not null default 1,
    first_seen_at datetime not null,
    last_seen_at datetime not null,
    resolved_at datetime null,
    metadata json not null,
    unique index runtime_alerts_fingerprint_idx (fingerprint),
    index runtime_alerts_status_idx (status, last_seen_at),
    index runtime_alerts_category_idx (category, last_seen_at)
  )`);
}

async function persistSamples(currentChecks) {
  for (const check of currentChecks) {
    await connection.execute(
      `insert into runtime_monitor_samples
        (id, target_type, target, status, latency_ms, status_code, detail, metric_value, metric_unit, checked_at)
        values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        `monitor-${randomUUID()}`,
        check.type,
        check.target,
        check.status,
        check.latency_ms,
        check.status_code,
        check.detail,
        check.metric_value ?? null,
        check.metric_unit ?? null,
        toMySqlDate(checkedAt)
      ]
    );
  }
}

async function syncAlerts(activeAlerts, previousLocalAlerts) {
  const activeFingerprints = new Set(activeAlerts.map((alert) => alert.fingerprint));
  for (const alert of activeAlerts) {
    const [rows] = await connection.execute("select id, status, occurrence_count, first_seen_at from runtime_alerts where fingerprint = ? limit 1", [alert.fingerprint]);
    const existing = rows[0];
    const alertId = existing?.id ?? `runtime-alert-${randomUUID()}`;
    if (existing) {
      await connection.execute(
        `update runtime_alerts set category=?, severity=?, title=?, detail=?, status='open', occurrence_count=?,
          first_seen_at=?, last_seen_at=?, resolved_at=null, metadata=? where id=?`,
        [alert.category, alert.severity, alert.title, alert.detail, Number(existing.occurrence_count ?? 0) + 1,
          existing.status === "open" ? toMySqlDate(existing.first_seen_at) : toMySqlDate(checkedAt), toMySqlDate(checkedAt), JSON.stringify(alert.metadata), alertId]
      );
    } else {
      await connection.execute(
        `insert into runtime_alerts
          (id, fingerprint, category, severity, title, detail, status, occurrence_count, first_seen_at, last_seen_at, resolved_at, metadata)
          values (?, ?, ?, ?, ?, ?, 'open', 1, ?, ?, null, ?)`,
        [alertId, alert.fingerprint, alert.category, alert.severity, alert.title, alert.detail,
          toMySqlDate(alert.first_seen_at), toMySqlDate(alert.last_seen_at), JSON.stringify(alert.metadata)]
      );
    }
    if (!existing || existing.status !== "open") await notifyAdmins(alertId, alert);
  }

  const [openRows] = await connection.query("select id, fingerprint from runtime_alerts where status = 'open'");
  for (const row of openRows) {
    if (!activeFingerprints.has(row.fingerprint)) {
      await connection.execute("update runtime_alerts set status='resolved', resolved_at=?, last_seen_at=? where id=?", [toMySqlDate(checkedAt), toMySqlDate(checkedAt), row.id]);
    }
  }

  for (const previous of previousLocalAlerts) {
    if (activeFingerprints.has(previous.fingerprint)) continue;
    const [rows] = await connection.execute("select id from runtime_alerts where fingerprint = ? limit 1", [previous.fingerprint]);
    if (rows[0]) continue;
    await connection.execute(
      `insert into runtime_alerts
        (id, fingerprint, category, severity, title, detail, status, occurrence_count, first_seen_at, last_seen_at, resolved_at, metadata)
        values (?, ?, ?, ?, ?, ?, 'resolved', 1, ?, ?, ?, ?)`,
      [`runtime-alert-${randomUUID()}`, previous.fingerprint, previous.category, previous.severity, previous.title,
        previous.detail, toMySqlDate(previous.first_seen_at ?? checkedAt), toMySqlDate(checkedAt), toMySqlDate(checkedAt), JSON.stringify(previous.metadata ?? {})]
    );
  }
}

async function notifyAdmins(alertId, alert) {
  const [admins] = await connection.query("select id from users where role='admin' and status='active'");
  for (const admin of admins) {
    await connection.execute(
      `insert into notifications
        (id, user_id, category, severity, title, body, href, source_type, source_id, dedupe_key, metadata, read_at, created_at)
        values (?, ?, 'system', ?, ?, ?, '/admin/operations', 'runtime_alert', ?, ?, ?, null, ?)`,
      [`notification-${randomUUID()}`, admin.id, alert.severity, alert.title, alert.detail, alertId,
        `runtime-alert:${alert.fingerprint}:${Date.now()}`, JSON.stringify({ fingerprint: alert.fingerprint }), toMySqlDate(checkedAt)]
    );
  }
}

async function cleanupSamples() {
  await connection.execute("delete from runtime_monitor_samples where checked_at < date_sub(utc_timestamp(), interval 30 day)");
}

function checkResult(type, target, status, latencyMs, statusCode, detail) {
  return {
    type,
    target,
    status,
    latency_ms: latencyMs,
    status_code: statusCode,
    detail,
    metric_value: null,
    metric_unit: null,
    checked_at: checkedAt
  };
}

function parseEndpoints(value) {
  return value.split(",").map((item) => item.trim()).filter(Boolean).map((item) => {
    const separator = item.lastIndexOf(":");
    const pathValue = separator > 0 ? item.slice(0, separator) : item;
    const expectedStatus = separator > 0 ? Number(item.slice(separator + 1)) : 200;
    return { path: pathValue.startsWith("/") ? pathValue : `/${pathValue}`, expectedStatus };
  }).filter((item) => Number.isInteger(item.expectedStatus));
}

function readConfig(key) {
  return process.env[key] || fileEnv[key] || "";
}

function readEnvFile(filePath) {
  try {
    const entries = {};
    for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const separator = trimmed.indexOf("=");
      if (separator <= 0) continue;
      const key = trimmed.slice(0, separator).trim();
      let value = trimmed.slice(separator + 1).trim();
      if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
      entries[key] = value;
    }
    return entries;
  } catch {
    return {};
  }
}

async function readJsonFile(filePath) {
  try { return JSON.parse(await fsp.readFile(filePath, "utf8")); } catch { return null; }
}

async function writeJsonAtomic(filePath, value) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp`;
  await fsp.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await fsp.rename(temporary, filePath);
  await fsp.chmod(filePath, 0o600);
}

function toMySqlDate(value) {
  return new Date(value).toISOString().slice(0, 19).replace("T", " ");
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error ?? "未知错误");
}

function readPositiveInt(value, fallback) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readPositiveNumber(value, fallback) {
  const parsed = Number(value ?? "");
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
