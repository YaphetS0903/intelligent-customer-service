#!/usr/bin/env node
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import mysql from "mysql2/promise";

const cwd = process.cwd();
const fileEnv = readEnvFile(path.resolve(cwd, process.env.ENV_FILE || ".env.local"));
const results = [];
let databaseTables = null;
const requiredTables = [
  "users",
  "knowledge_bases",
  "documents",
  "document_chunks",
  "document_versions",
  "document_version_chunks",
  "document_approval_requests",
  "document_approval_events",
  "document_reviewer_assignments",
  "document_permission_templates",
  "conversations",
  "messages",
  "feedback",
  "knowledge_tasks",
  "service_tickets",
  "service_ticket_comments",
  "security_events",
  "notifications",
  "training_jobs",
  "training_video_jobs",
  "training_progress",
  "training_quiz_attempts",
  "qa_test_cases",
  "model_usage_events",
  "runtime_monitor_samples",
  "runtime_alerts"
];

const config = {
  authSecret: readConfig("AUTH_SECRET"),
  appBaseUrl: readConfig("APP_BASE_URL"),
  runtimeBaseUrl: readConfig("RUNTIME_MONITOR_BASE_URL") || readConfig("APP_BASE_URL"),
  databaseProvider: readConfig("DATABASE_PROVIDER"),
  mysqlAutoMigrate: readConfig("MYSQL_AUTO_MIGRATE"),
  mysqlHost: readConfig("MYSQL_HOST"),
  mysqlPort: Number(readConfig("MYSQL_PORT") || "3306"),
  mysqlDatabase: readConfig("MYSQL_DATABASE"),
  mysqlUser: readConfig("MYSQL_USER"),
  mysqlPassword: readConfig("MYSQL_PASSWORD")
};

await runCheck("生产环境配置", checkProductionConfig);
await runCheck("MySQL 连接", checkDatabase);
await runCheck("MySQL 核心表", checkRequiredTables);
await runCheck("服务器磁盘", checkDisk);
await runCheck("最近数据库备份", checkBackupState);
await runCheck("最近恢复演练", checkRestoreState);
await runCheck("登录页健康检查", () => checkEndpoint("/login", 200));
await runCheck("未登录鉴权检查", () => checkEndpoint("/api/auth/me", 401));

const failed = results.filter((item) => item.status === "failed");
const warnings = results.filter((item) => item.status === "warning");

for (const result of results) {
  const marker = result.status === "ready" ? "PASS" : result.status === "warning" ? "WARN" : "FAIL";
  console.log(`[${marker}] ${result.name}: ${result.detail}`);
}
console.log(`Preflight complete: ${results.length} checks, ${failed.length} failed, ${warnings.length} warnings`);

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ checkedAt: new Date().toISOString(), results, failed: failed.length, warnings: warnings.length }));
}

if (failed.length > 0) {
  process.exitCode = 1;
}

async function runCheck(name, check) {
  try {
    const value = await check();
    results.push({ name, status: value.status || "ready", detail: value.detail });
  } catch (error) {
    results.push({ name, status: "failed", detail: errorMessage(error) });
  }
}

async function checkProductionConfig() {
  const errors = [];
  if (config.authSecret.length < 32 || /change|replace|example|placeholder/i.test(config.authSecret)) {
    errors.push("AUTH_SECRET 未设置为至少 32 位的生产密钥");
  }
  try {
    const url = new URL(config.appBaseUrl);
    if (!["http:", "https:"].includes(url.protocol)) {
      errors.push("APP_BASE_URL 不是 HTTP(S) 地址");
    }
    if (["localhost", "127.0.0.1", "0.0.0.0", "::1"].includes(url.hostname)) {
      errors.push("APP_BASE_URL 仍是本机地址");
    }
  } catch {
    errors.push("APP_BASE_URL 无效");
  }
  if (config.databaseProvider !== "mysql") {
    errors.push("DATABASE_PROVIDER 必须为 mysql");
  }
  if (!config.mysqlHost || !config.mysqlDatabase || !config.mysqlUser || !config.mysqlPassword) {
    errors.push("MySQL 连接参数不完整");
  }
  if (config.mysqlAutoMigrate !== "false") {
    errors.push("生产环境 MYSQL_AUTO_MIGRATE 必须为 false");
  }
  if (errors.length > 0) {
    throw new Error(errors.join("；"));
  }
  return { detail: `${config.appBaseUrl}，MySQL 自动迁移已关闭` };
}

async function checkDatabase() {
  let lastError;
  const attempts = readPositiveInt(readConfig("PREFLIGHT_MYSQL_ATTEMPTS"), 3);
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    let connection;
    try {
      connection = await mysql.createConnection({
        host: config.mysqlHost,
        port: config.mysqlPort,
        database: config.mysqlDatabase,
        user: config.mysqlUser,
        password: config.mysqlPassword,
        connectTimeout: readPositiveInt(readConfig("PREFLIGHT_MYSQL_TIMEOUT_MS"), 8000),
        enableKeepAlive: true,
        keepAliveInitialDelay: 0
      });
      const [rows] = await connection.query(
        {
          sql: "select table_name from information_schema.tables where table_schema = ? and table_type = 'BASE TABLE'",
          timeout: 10_000
        },
        [config.mysqlDatabase]
      );
      databaseTables = new Set(rows.map((row) => String(row.TABLE_NAME || row.table_name)));
      return { detail: `${config.mysqlHost}:${config.mysqlPort}/${config.mysqlDatabase}，${databaseTables.size} 张表` };
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await sleep(500 * attempt);
      }
    } finally {
      await connection?.end().catch(() => undefined);
    }
  }
  throw lastError;
}

async function checkRequiredTables() {
  if (!databaseTables) {
    throw new Error("MySQL 尚未连接，无法检查核心表");
  }
  const missing = requiredTables.filter((table) => !databaseTables.has(table));
  if (missing.length > 0) {
    throw new Error(`缺少 ${missing.length} 张核心表：${missing.join(", ")}`);
  }
  return { detail: `${requiredTables.length} 张核心表齐全` };
}

async function checkDisk() {
  const stats = await fsp.statfs(cwd);
  const total = Number(stats.blocks) * Number(stats.bsize);
  const free = Number(stats.bavail) * Number(stats.bsize);
  const freePercent = total > 0 ? free / total * 100 : 0;
  const minimumPercent = readPositiveNumber(readConfig("PREFLIGHT_DISK_MIN_PERCENT"), 12);
  const minimumBytes = readPositiveNumber(readConfig("PREFLIGHT_DISK_MIN_GB"), 3) * 1024 ** 3;
  if (freePercent < minimumPercent || free < minimumBytes) {
    throw new Error(`磁盘仅剩 ${formatBytes(free)}（${freePercent.toFixed(1)}%）`);
  }
  return { detail: `可用 ${formatBytes(free)}（${freePercent.toFixed(1)}%）` };
}

async function checkBackupState() {
  const statePath = path.resolve(cwd, readConfig("BACKUP_STATE_FILE") || "./.ops/mysql-backup-last-success.json");
  const state = await readJson(statePath);
  const checkedAt = parseDate(state.checkedAt, "备份状态时间无效");
  const maxAgeHours = readPositiveNumber(readConfig("PREFLIGHT_BACKUP_MAX_AGE_HOURS"), 36);
  assertFresh(checkedAt, maxAgeHours * 60 * 60 * 1000, `最近备份已超过 ${maxAgeHours} 小时`);
  const configuredBackupDir = path.resolve(cwd, readConfig("BACKUP_DIR") || "./backups/mysql");
  const target = path.resolve(cwd, String(state.target || ""));
  const backupDir = await fsp.realpath(configuredBackupDir).catch(() => configuredBackupDir);
  const realTarget = await fsp.realpath(target).catch(() => target);
  if (!state.target || !isPathInside(backupDir, realTarget)) {
    throw new Error("备份文件不在 BACKUP_DIR 内");
  }
  const stats = await fsp.stat(realTarget);
  if (!stats.isFile() || stats.size < 100) {
    throw new Error("最近备份文件不存在或为空");
  }
  return { detail: `${formatAge(checkedAt)}，${formatBytes(stats.size)}` };
}

async function checkRestoreState() {
  const statePath = path.resolve(cwd, readConfig("RESTORE_STATE_FILE") || "./.ops/mysql-restore-last-success.json");
  const state = await readJson(statePath);
  const checkedAt = parseDate(state.checkedAt, "恢复演练状态时间无效");
  const maxAgeDays = readPositiveNumber(readConfig("PREFLIGHT_RESTORE_MAX_AGE_DAYS"), 31);
  assertFresh(checkedAt, maxAgeDays * 24 * 60 * 60 * 1000, `最近恢复演练已超过 ${maxAgeDays} 天`);
  if (state.database !== config.mysqlDatabase || Number(state.tableCount) < requiredTables.length) {
    throw new Error("恢复演练数据库或表数量与当前生产库不匹配");
  }
  if (Number(state.rowCountMismatches) !== 0 || state.restoreArtifactsRemoved !== true) {
    throw new Error("恢复演练存在行数差异或临时数据未清理");
  }
  return { detail: `${formatAge(checkedAt)}，${state.tableCount} 张表、${state.totalRows} 行通过` };
}

async function checkEndpoint(endpoint, expectedStatus) {
  const url = new URL(endpoint, config.runtimeBaseUrl).toString();
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const startedAt = Date.now();
    try {
      const response = await fetch(url, {
        redirect: "manual",
        signal: AbortSignal.timeout(readPositiveInt(readConfig("PREFLIGHT_HTTP_TIMEOUT_MS"), 10_000)),
        headers: { "User-Agent": "tianrui-deploy-preflight/1.0" }
      });
      if (response.status !== expectedStatus) {
        throw new Error(`期望 HTTP ${expectedStatus}，实际 ${response.status}`);
      }
      return { detail: `HTTP ${response.status}，${Date.now() - startedAt}ms` };
    } catch (error) {
      lastError = error;
      if (attempt < 3) {
        await sleep(400 * attempt);
      }
    }
  }
  throw new Error(`${url}：${errorMessage(lastError)}`);
}

function readConfig(key) {
  return process.env[key] ?? fileEnv[key] ?? "";
}

function readEnvFile(filePath) {
  try {
    return Object.fromEntries(
      fs.readFileSync(filePath, "utf8").split(/\r?\n/).flatMap((line) => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) return [];
        const separator = trimmed.indexOf("=");
        if (separator <= 0) return [];
        const key = trimmed.slice(0, separator).trim();
        let value = trimmed.slice(separator + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        return [[key, value]];
      })
    );
  } catch {
    return {};
  }
}

async function readJson(filePath) {
  try {
    return JSON.parse(await fsp.readFile(filePath, "utf8"));
  } catch (error) {
    throw new Error(`${filePath} 无法读取：${errorMessage(error)}`);
  }
}

function parseDate(value, message) {
  const date = new Date(String(value || ""));
  if (Number.isNaN(date.getTime())) throw new Error(message);
  return date;
}

function assertFresh(date, maxAgeMs, message) {
  const age = Date.now() - date.getTime();
  if (age < -5 * 60 * 1000 || age > maxAgeMs) throw new Error(message);
}

function isPathInside(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function formatAge(date) {
  const minutes = Math.max(0, Math.round((Date.now() - date.getTime()) / 60_000));
  return minutes < 120 ? `${minutes} 分钟前` : minutes < 2880 ? `${Math.round(minutes / 60)} 小时前` : `${Math.round(minutes / 1440)} 天前`;
}

function formatBytes(bytes) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

function readPositiveInt(value, fallback) {
  const parsed = Number.parseInt(value || "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readPositiveNumber(value, fallback) {
  const parsed = Number(value || "");
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error || "未知错误");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
