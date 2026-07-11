"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArchiveRestore,
  CheckCircle2,
  Clock3,
  DatabaseBackup,
  HardDrive,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Trash2,
  XCircle
} from "lucide-react";
import { ErrorRetry, PanelSkeleton, useToast } from "@/components/ui-feedback";
import { fetchWithRetry } from "@/lib/client-fetch";

type BackupRecord = {
  file_name: string;
  size_bytes: number;
  created_at: string;
  is_latest: boolean;
  restore_verified: boolean;
};

type BackupJob = {
  id: string;
  action: "backup" | "verify_restore";
  status: "running" | "succeeded" | "failed";
  file_name: string | null;
  started_at: string;
  finished_at: string | null;
  output: string;
  error: string | null;
};

type BackupOverview = {
  keep_days: number;
  schedule: { configured: boolean; expression: string | null };
  last_backup: { checked_at: string; database: string; file_name: string } | null;
  last_restore_verification: {
    checked_at: string;
    file_name: string;
    mode: string;
    artifacts_removed: boolean;
    table_count: number;
    total_rows: number;
    row_count_mismatches: number;
  } | null;
  backups: BackupRecord[];
  jobs: BackupJob[];
};

export function BackupOperationsAdmin() {
  const { pushToast } = useToast();
  const [overview, setOverview] = useState<BackupOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<string | null>(null);
  const hasRunningJob = useMemo(() => overview?.jobs.some((job) => job.status === "running") ?? false, [overview]);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    setLoadError(null);
    try {
      const response = await fetchWithRetry("/api/admin/backups", { cache: "no-store" }, { timeoutMs: 20_000 });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "读取备份状态失败");
      setOverview(data.overview);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "读取备份状态失败");
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!hasRunningJob) return;
    const timer = window.setInterval(() => void load(true), 2500);
    return () => window.clearInterval(timer);
  }, [hasRunningJob, load]);

  async function runAction(action: "backup" | "verify_restore", fileName?: string) {
    const key = `${action}:${fileName ?? "latest"}`;
    setSubmitting(key);
    try {
      const response = await fetch("/api/admin/backups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, file_name: fileName })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "任务启动失败");
      await load(true);
      pushToast({
        tone: "success",
        title: action === "backup" ? "备份任务已启动" : "恢复验证已启动",
        description: action === "backup" ? "后台正在生成 MySQL 逻辑备份。" : `正在验证 ${fileName ?? "最近一次备份"}。`
      });
    } catch (error) {
      pushToast({ tone: "error", title: "任务启动失败", description: error instanceof Error ? error.message : "操作失败" });
    } finally {
      setSubmitting(null);
    }
  }

  async function deleteBackup(fileName: string) {
    if (!window.confirm(`确认删除历史备份 ${fileName}？`)) return;
    setSubmitting(`delete:${fileName}`);
    try {
      const response = await fetch("/api/admin/backups", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file_name: fileName })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "删除备份失败");
      await load(true);
      pushToast({ tone: "success", title: "历史备份已删除", description: fileName });
    } catch (error) {
      pushToast({ tone: "error", title: "删除失败", description: error instanceof Error ? error.message : "删除备份失败" });
    } finally {
      setSubmitting(null);
    }
  }

  return (
    <div className="space-y-5">
      <section className="ui-card p-5 shadow-soft">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-3">
            <span className="grid size-11 shrink-0 place-items-center rounded-lg bg-emerald-50 text-emerald-700">
              <HardDrive size={22} />
            </span>
            <div>
              <h2 className="text-lg font-semibold text-ink">备份与恢复</h2>
              <p className="mt-1 text-sm text-slate-500">MySQL 逻辑备份、恢复验证和保留记录</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void runAction("backup")}
              disabled={hasRunningJob || submitting !== null}
              className="ui-button-primary h-10"
            >
              {submitting === "backup:latest" ? <Loader2 size={16} className="animate-spin" /> : <DatabaseBackup size={16} />}
              立即备份
            </button>
            <button type="button" onClick={() => void load()} disabled={loading} className="ui-button-secondary h-10">
              {loading ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
              刷新
            </button>
          </div>
        </div>
      </section>

      {loading && !overview && <PanelSkeleton rows={5} />}
      {!loading && loadError && !overview && (
        <ErrorRetry title="备份状态加载失败" message={loadError} retrying={loading} onRetry={() => void load()} />
      )}

      {overview && (
        <>
          <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <StatusMetric
              icon={<Clock3 size={18} />}
              label="自动备份"
              value={overview.schedule.configured ? "已启用" : "未启用"}
              detail={overview.schedule.expression ?? "未检测到定时任务"}
              ok={overview.schedule.configured}
            />
            <StatusMetric
              icon={<DatabaseBackup size={18} />}
              label="最近备份"
              value={overview.last_backup ? formatDate(overview.last_backup.checked_at) : "暂无记录"}
              detail={overview.last_backup?.file_name ?? `保留 ${overview.keep_days} 天`}
              ok={Boolean(overview.last_backup)}
            />
            <StatusMetric
              icon={<ShieldCheck size={18} />}
              label="恢复验证"
              value={overview.last_restore_verification ? formatDate(overview.last_restore_verification.checked_at) : "尚未验证"}
              detail={overview.last_restore_verification
                ? `${overview.last_restore_verification.table_count} 张表 / ${overview.last_restore_verification.total_rows} 行`
                : "暂无演练记录"}
              ok={Boolean(overview.last_restore_verification?.artifacts_removed && overview.last_restore_verification.row_count_mismatches === 0)}
            />
            <StatusMetric
              icon={<HardDrive size={18} />}
              label="可用备份"
              value={`${overview.backups.length} 份`}
              detail={`自动保留 ${overview.keep_days} 天`}
              ok={overview.backups.length > 0}
            />
          </section>

          {overview.jobs.length > 0 && <JobList jobs={overview.jobs} />}

          <section className="ui-card overflow-hidden">
            <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
              <div>
                <h2 className="text-base font-semibold text-ink">备份记录</h2>
                <p className="mt-1 text-xs text-slate-500">{overview.backups.length} 个压缩逻辑备份</p>
              </div>
            </div>
            {overview.backups.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="bg-slate-50 text-xs text-slate-500">
                    <tr>
                      <th className="px-5 py-3 font-medium">文件</th>
                      <th className="px-5 py-3 font-medium">生成时间</th>
                      <th className="px-5 py-3 font-medium">大小</th>
                      <th className="px-5 py-3 font-medium">状态</th>
                      <th className="px-5 py-3 text-right font-medium">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {overview.backups.map((backup) => (
                      <tr key={backup.file_name} className="bg-white">
                        <td className="max-w-[360px] px-5 py-4 font-medium text-ink"><span className="break-all">{backup.file_name}</span></td>
                        <td className="whitespace-nowrap px-5 py-4 text-slate-600">{formatDate(backup.created_at)}</td>
                        <td className="whitespace-nowrap px-5 py-4 text-slate-600">{formatBytes(backup.size_bytes)}</td>
                        <td className="px-5 py-4">
                          <div className="flex flex-wrap gap-2">
                            {backup.is_latest && <StatusBadge label="最新" tone="info" />}
                            {backup.restore_verified && <StatusBadge label="已验证恢复" tone="success" />}
                          </div>
                        </td>
                        <td className="px-5 py-4">
                          <div className="flex justify-end gap-2">
                            <button
                              type="button"
                              title="验证恢复"
                              aria-label={`验证恢复 ${backup.file_name}`}
                              onClick={() => void runAction("verify_restore", backup.file_name)}
                              disabled={hasRunningJob || submitting !== null}
                              className="inline-flex size-9 items-center justify-center rounded-lg border border-line text-slate-600 hover:bg-slate-50 disabled:text-slate-300"
                            >
                              {submitting === `verify_restore:${backup.file_name}`
                                ? <Loader2 size={16} className="animate-spin" />
                                : <ArchiveRestore size={16} />}
                            </button>
                            <button
                              type="button"
                              title={backup.is_latest ? "最新备份受保护" : "删除历史备份"}
                              aria-label={backup.is_latest ? `最新备份受保护 ${backup.file_name}` : `删除历史备份 ${backup.file_name}`}
                              onClick={() => void deleteBackup(backup.file_name)}
                              disabled={backup.is_latest || submitting !== null}
                              className="inline-flex size-9 items-center justify-center rounded-lg border border-red-200 text-red-700 hover:bg-red-50 disabled:border-line disabled:text-slate-300"
                            >
                              {submitting === `delete:${backup.file_name}`
                                ? <Loader2 size={16} className="animate-spin" />
                                : <Trash2 size={16} />}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="px-5 py-12 text-center text-sm text-slate-500">暂无备份记录</div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function StatusMetric({ icon, label, value, detail, ok }: { icon: React.ReactNode; label: string; value: string; detail: string; ok: boolean }) {
  return (
    <article className="ui-card p-4">
      <div className={`flex items-center gap-2 text-sm font-medium ${ok ? "text-emerald-700" : "text-amber-700"}`}>{icon}{label}</div>
      <p className="mt-3 text-lg font-semibold text-ink">{value}</p>
      <p className="mt-1 break-all text-xs text-slate-500">{detail}</p>
    </article>
  );
}

function JobList({ jobs }: { jobs: BackupJob[] }) {
  return (
    <section className="ui-card overflow-hidden">
      <div className="border-b border-line px-5 py-4"><h2 className="text-base font-semibold text-ink">任务记录</h2></div>
      <div className="divide-y divide-line">
        {jobs.slice(0, 5).map((job) => (
          <div key={job.id} className="flex flex-col gap-3 px-5 py-4 md:flex-row md:items-start md:justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-sm font-medium text-ink">
                {job.status === "running" ? <Loader2 size={16} className="animate-spin text-brand" /> : job.status === "succeeded" ? <CheckCircle2 size={16} className="text-emerald-600" /> : <XCircle size={16} className="text-red-600" />}
                {job.action === "backup" ? "MySQL 逻辑备份" : "隔离恢复验证"}
              </div>
              <p className="mt-1 text-xs text-slate-500">{formatDate(job.started_at)}{job.file_name ? ` / ${job.file_name}` : ""}</p>
              {job.error && <p className="mt-2 text-xs text-red-600">{job.error}</p>}
            </div>
            <StatusBadge label={job.status === "running" ? "运行中" : job.status === "succeeded" ? "成功" : "失败"} tone={job.status === "succeeded" ? "success" : job.status === "failed" ? "danger" : "info"} />
          </div>
        ))}
      </div>
    </section>
  );
}

function StatusBadge({ label, tone }: { label: string; tone: "success" | "danger" | "info" }) {
  const classes = tone === "success" ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : tone === "danger" ? "bg-red-50 text-red-700 ring-red-200" : "bg-cyan/10 text-brand ring-cyan/25";
  return <span className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${classes}`}>{label}</span>;
}

function formatDate(value: string) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
