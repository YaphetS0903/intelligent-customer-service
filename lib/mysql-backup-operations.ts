import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

export type MysqlBackupJobAction = "backup" | "verify_restore";
export type MysqlBackupJob = {
  id: string;
  action: MysqlBackupJobAction;
  status: "running" | "succeeded" | "failed";
  file_name: string | null;
  started_at: string;
  finished_at: string | null;
  output: string;
  error: string | null;
};

declare global {
  // eslint-disable-next-line no-var
  var __mysqlBackupJobs: Map<string, MysqlBackupJob> | undefined;
}

const jobs = globalThis.__mysqlBackupJobs ?? new Map<string, MysqlBackupJob>();
globalThis.__mysqlBackupJobs = jobs;
const execFileAsync = promisify(execFile);
const backupDir = path.resolve(process.cwd(), process.env.BACKUP_DIR || "./backups/mysql");
const backupStateFile = path.resolve(process.cwd(), process.env.BACKUP_STATE_FILE || "./.ops/mysql-backup-last-success.json");
const restoreStateFile = path.resolve(process.cwd(), process.env.RESTORE_STATE_FILE || "./.ops/mysql-restore-last-success.json");

export async function getMysqlBackupOverview() {
  const [entries, backupState, restoreState, schedule] = await Promise.all([
    fs.readdir(backupDir, { withFileTypes: true }).catch(() => []),
    readJsonFile(backupStateFile),
    readJsonFile(restoreStateFile),
    readBackupSchedule()
  ]);
  const backupFiles = await Promise.all(entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql.gz"))
    .map(async (entry) => {
      const filePath = path.join(backupDir, entry.name);
      const stats = await fs.stat(filePath);
      return {
        file_name: entry.name,
        size_bytes: stats.size,
        created_at: stats.mtime.toISOString(),
        is_latest: path.basename(String(backupState?.target ?? "")) === entry.name,
        restore_verified: path.basename(String(restoreState?.source ?? "")) === entry.name && restoreState?.rowCountMismatches === 0
      };
    }));
  backupFiles.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  return {
    backup_dir: backupDir,
    keep_days: readPositiveInt(process.env.KEEP_DAYS, 14),
    schedule,
    last_backup: backupState ? sanitizeBackupState(backupState) : null,
    last_restore_verification: restoreState ? sanitizeRestoreState(restoreState) : null,
    backups: backupFiles,
    jobs: listMysqlBackupJobs()
  };
}

export async function startMysqlBackupJob(action: MysqlBackupJobAction, fileName?: string | null) {
  const running = [...jobs.values()].find((job) => job.status === "running");
  if (running) {
    throw new Error("已有备份或恢复验证任务正在运行");
  }

  let args: string[];
  let command: string;
  let selectedFile: string | null = null;
  if (action === "backup") {
    command = "bash";
    args = ["scripts/backup-mysql.sh"];
  } else {
    command = process.execPath;
    selectedFile = fileName ? validateBackupFileName(fileName) : null;
    const source = selectedFile ? path.join(backupDir, selectedFile) : null;
    if (source) await assertBackupFileExists(source);
    args = ["scripts/verify-mysql-restore.mjs", ...(source ? [source] : [])];
  }

  const job: MysqlBackupJob = {
    id: `mysqljob-${randomUUID()}`,
    action,
    status: "running",
    file_name: selectedFile,
    started_at: new Date().toISOString(),
    finished_at: null,
    output: "",
    error: null
  };
  jobs.set(job.id, job);

  const child = spawn(command, args, {
    cwd: process.cwd(),
    env: {
      ...process.env,
      BACKUP_DIR: backupDir,
      BACKUP_STATE_FILE: backupStateFile,
      RESTORE_STATE_FILE: restoreStateFile
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  child.stdout.on("data", (chunk) => appendJobOutput(job.id, String(chunk)));
  child.stderr.on("data", (chunk) => appendJobOutput(job.id, String(chunk)));
  child.on("error", (error) => finishJob(job.id, false, error.message));
  child.on("close", (code) => finishJob(job.id, code === 0, code === 0 ? null : `任务退出码：${code ?? "unknown"}`));

  pruneJobs();
  return job;
}

export async function deleteMysqlBackup(fileName: string) {
  const safeName = validateBackupFileName(fileName);
  const overview = await getMysqlBackupOverview();
  const target = overview.backups.find((backup) => backup.file_name === safeName);
  if (!target) throw new Error("备份文件不存在");
  if (target.is_latest) throw new Error("最近一次成功备份受保护，不能删除");
  if (overview.backups.length <= 1) throw new Error("至少需要保留一个可用备份");
  await fs.rm(path.join(backupDir, safeName), { force: true });
  return { file_name: safeName };
}

export function listMysqlBackupJobs() {
  return [...jobs.values()]
    .sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime())
    .slice(0, 10);
}

function appendJobOutput(jobId: string, chunk: string) {
  const job = jobs.get(jobId);
  if (!job || job.status !== "running") return;
  job.output = `${job.output}${chunk}`.slice(-12_000);
}

function finishJob(jobId: string, succeeded: boolean, error: string | null) {
  const job = jobs.get(jobId);
  if (!job || job.status !== "running") return;
  job.status = succeeded ? "succeeded" : "failed";
  job.finished_at = new Date().toISOString();
  job.error = error;
}

function pruneJobs() {
  const completed = [...jobs.values()]
    .filter((job) => job.status !== "running")
    .sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime());
  for (const job of completed.slice(20)) jobs.delete(job.id);
}

async function readBackupSchedule() {
  try {
    const { stdout } = await execFileAsync("crontab", ["-l"], { timeout: 5000 });
    const line = stdout.split(/\r?\n/).find((item) => item.includes("backup-mysql"))?.trim() ?? null;
    return { configured: Boolean(line), expression: line?.split(/\s+/).slice(0, 5).join(" ") ?? null };
  } catch {
    return { configured: false, expression: null };
  }
}

async function readJsonFile(filePath: string): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function sanitizeBackupState(state: Record<string, unknown>) {
  return {
    checked_at: String(state.checkedAt ?? ""),
    database: String(state.database ?? ""),
    file_name: path.basename(String(state.target ?? ""))
  };
}

function sanitizeRestoreState(state: Record<string, unknown>) {
  return {
    checked_at: String(state.checkedAt ?? ""),
    database: String(state.database ?? ""),
    file_name: path.basename(String(state.source ?? "")),
    mode: String(state.restoreMode ?? ""),
    artifacts_removed: state.restoreArtifactsRemoved === true,
    table_count: Number(state.tableCount ?? 0),
    total_rows: Number(state.totalRows ?? 0),
    row_count_mismatches: Number(state.rowCountMismatches ?? 0)
  };
}

function validateBackupFileName(fileName: string) {
  const safeName = path.basename(fileName.trim());
  if (safeName !== fileName.trim() || !/^[a-zA-Z0-9._-]+\.sql\.gz$/.test(safeName)) {
    throw new Error("备份文件名不合法");
  }
  return safeName;
}

async function assertBackupFileExists(filePath: string) {
  const stats = await fs.stat(filePath).catch(() => null);
  if (!stats?.isFile() || stats.size === 0) throw new Error("备份文件不存在或为空");
}

function readPositiveInt(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
