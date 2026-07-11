"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Database,
  Gauge,
  HardDrive,
  Loader2,
  RefreshCw,
  ServerCrash,
  ShieldCheck
} from "lucide-react";
import { ErrorRetry, PanelSkeleton, useToast } from "@/components/ui-feedback";
import { fetchWithRetry } from "@/lib/client-fetch";

type MonitorCheck = {
  type: "database" | "disk" | "endpoint";
  target: string;
  status: "ready" | "warning" | "failed";
  latency_ms: number;
  status_code: number | null;
  detail: string;
  metric_value: number | null;
  metric_unit: string | null;
  consecutive_failures: number;
  consecutive_slow: number;
  checked_at: string;
};

type MonitorSample = {
  target_type: string;
  target: string;
  status: string;
  latency_ms: number;
  checked_at: string;
};

type RuntimeAlert = {
  id: string;
  category: string;
  severity: "warning" | "critical";
  title: string;
  detail: string;
  status: "open" | "resolved";
  occurrence_count: number;
  first_seen_at: string;
  last_seen_at: string;
  resolved_at: string | null;
};

type MonitorOverview = {
  checked_at: string | null;
  thresholds: { failure_count: number; latency_ms: number; disk_warning_percent: number; disk_critical_percent: number };
  checks: MonitorCheck[];
  local_alerts: Array<{ fingerprint: string; severity: string; title: string; detail: string }>;
  samples: MonitorSample[];
  alerts: RuntimeAlert[];
  running: boolean;
};

export function RuntimeMonitorAdmin() {
  const { pushToast } = useToast();
  const [overview, setOverview] = useState<MonitorOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const response = await fetchWithRetry("/api/admin/runtime-monitor", { cache: "no-store" }, { timeoutMs: 20_000 });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "读取运行监控失败");
      setOverview(data.overview);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "读取运行监控失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const aggregates = useMemo(() => {
    const groups = new Map<string, MonitorSample[]>();
    for (const sample of overview?.samples ?? []) {
      const key = `${sample.target_type}:${sample.target}`;
      groups.set(key, [...(groups.get(key) ?? []), sample]);
    }
    return [...groups.entries()].map(([key, samples]) => ({
      key,
      target: samples[0]?.target ?? key,
      type: samples[0]?.target_type ?? "endpoint",
      samples: samples.length,
      average_latency: Math.round(samples.reduce((sum, item) => sum + Number(item.latency_ms ?? 0), 0) / Math.max(samples.length, 1)),
      max_latency: Math.max(...samples.map((item) => Number(item.latency_ms ?? 0))),
      success_rate: Math.round(samples.filter((item) => item.status === "ready").length / Math.max(samples.length, 1) * 100)
    }));
  }, [overview]);

  async function runMonitor() {
    setRunning(true);
    try {
      const response = await fetch("/api/admin/runtime-monitor", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "运行监控失败");
      setOverview(data.overview);
      pushToast({ tone: "success", title: "运行检查完成", description: `已检查 ${data.overview?.checks?.length ?? 0} 个目标。` });
    } catch (error) {
      pushToast({ tone: "error", title: "运行检查失败", description: error instanceof Error ? error.message : "运行监控失败" });
    } finally {
      setRunning(false);
    }
  }

  async function resolveAlert(id: string) {
    setResolvingId(id);
    try {
      const response = await fetch("/api/admin/runtime-monitor", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "处理告警失败");
      setOverview(data.overview);
      pushToast({ tone: "success", title: "告警已解除", description: "该记录已转入已解决状态。" });
    } catch (error) {
      pushToast({ tone: "error", title: "处理告警失败", description: error instanceof Error ? error.message : "处理失败" });
    } finally {
      setResolvingId(null);
    }
  }

  if (loading && !overview) return <PanelSkeleton rows={4} />;
  if (loadError && !overview) return <ErrorRetry title="运行监控加载失败" message={loadError} onRetry={() => void load()} />;

  const openAlerts = overview?.alerts.filter((alert) => alert.status === "open") ?? [];
  const localAlerts = overview?.local_alerts ?? [];

  return (
    <>
      <section className="ui-card p-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-cyan/10 text-brand"><Activity size={20} /></span>
            <div>
              <h2 className="text-lg font-semibold text-ink">运行监控</h2>
              <p className="mt-1 text-sm text-slate-500">{overview?.checked_at ? `最近检查 ${formatDate(overview.checked_at)}` : "尚无监控采样"}</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => void runMonitor()} disabled={running} className="ui-button-primary h-10">
              {running ? <Loader2 size={16} className="animate-spin" /> : <ShieldCheck size={16} />}
              立即检查
            </button>
            <button type="button" onClick={() => void load()} disabled={loading} className="ui-button-secondary h-10">
              {loading ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
              刷新
            </button>
          </div>
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {(overview?.checks ?? []).map((check) => <CheckCard key={`${check.type}:${check.target}`} check={check} threshold={overview!.thresholds.latency_ms} />)}
        {(overview?.checks.length ?? 0) === 0 && <div className="ui-card p-5 text-sm text-slate-500 md:col-span-2 xl:col-span-4">暂无监控采样</div>}
      </section>

      {(openAlerts.length > 0 || localAlerts.length > 0) && (
        <section className="rounded-lg border border-red-200 bg-red-50 p-5">
          <div className="flex items-center gap-2 text-red-800"><AlertTriangle size={18} /><h2 className="text-base font-semibold">当前告警</h2></div>
          <div className="mt-4 divide-y divide-red-200">
            {openAlerts.map((alert) => (
              <div key={alert.id} className="flex flex-col gap-3 py-3 first:pt-0 last:pb-0 md:flex-row md:items-start md:justify-between">
                <div><p className="text-sm font-semibold text-red-900">{alert.title}</p><p className="mt-1 text-xs leading-5 text-red-700">{alert.detail}</p></div>
                <button type="button" onClick={() => void resolveAlert(alert.id)} disabled={resolvingId === alert.id} className="ui-button-secondary h-9 shrink-0">
                  {resolvingId === alert.id ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}解除
                </button>
              </div>
            ))}
            {localAlerts.filter((item) => !openAlerts.some((alert) => alert.title === item.title)).map((alert) => (
              <div key={alert.fingerprint} className="py-3 first:pt-0 last:pb-0"><p className="text-sm font-semibold text-red-900">{alert.title}</p><p className="mt-1 text-xs text-red-700">{alert.detail}</p></div>
            ))}
          </div>
        </section>
      )}

      <section className="ui-card overflow-hidden">
        <div className="border-b border-line px-5 py-4">
          <h2 className="text-base font-semibold text-ink">最近采样</h2>
          <p className="mt-1 text-xs text-slate-500">最近 30 天保留</p>
        </div>
        {aggregates.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="px-5 py-3 font-medium">目标</th><th className="px-5 py-3 font-medium">样本</th><th className="px-5 py-3 font-medium">成功率</th><th className="px-5 py-3 font-medium">平均延迟</th><th className="px-5 py-3 font-medium">最高延迟</th></tr></thead>
              <tbody className="divide-y divide-line">
                {aggregates.map((item) => <tr key={item.key}><td className="px-5 py-4 font-medium text-ink">{item.target}</td><td className="px-5 py-4 text-slate-600">{item.samples}</td><td className="px-5 py-4 text-slate-600">{item.success_rate}%</td><td className="px-5 py-4 text-slate-600">{item.average_latency}ms</td><td className="px-5 py-4 text-slate-600">{item.max_latency}ms</td></tr>)}
              </tbody>
            </table>
          </div>
        ) : <div className="px-5 py-10 text-center text-sm text-slate-500">暂无历史采样</div>}
      </section>
    </>
  );
}

function CheckCard({ check, threshold }: { check: MonitorCheck; threshold: number }) {
  const healthy = check.status === "ready";
  const slow = (healthy && check.type !== "disk" && check.latency_ms >= threshold) || check.status === "warning";
  const Icon = check.type === "database" ? Database : check.type === "disk" ? HardDrive : check.status === "failed" ? ServerCrash : Gauge;
  return (
    <article className={`rounded-lg border bg-white p-4 ${healthy && !slow ? "border-line" : slow ? "border-amber-200" : "border-red-200"}`}>
      <div className="flex items-start justify-between gap-3">
        <span className={`grid size-9 place-items-center rounded-lg ${healthy && !slow ? "bg-emerald-50 text-emerald-700" : slow ? "bg-amber-50 text-amber-700" : "bg-red-50 text-red-700"}`}><Icon size={18} /></span>
        <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${healthy && !slow ? "bg-emerald-50 text-emerald-700" : slow ? "bg-amber-50 text-amber-700" : "bg-red-50 text-red-700"}`}>{healthy && !slow ? "正常" : slow ? "缓慢" : "异常"}</span>
      </div>
      <p className="mt-3 break-all text-sm font-semibold text-ink">{check.target}</p>
      <p className="mt-1 text-2xl font-semibold text-ink">{check.type === "disk" ? `${Number(check.metric_value ?? 0).toFixed(1)}%` : `${check.latency_ms}ms`}</p>
      <p className="mt-1 text-xs text-slate-500">{check.detail}{check.consecutive_failures > 0 ? ` / 连续失败 ${check.consecutive_failures}` : ""}</p>
    </article>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(new Date(value));
}
