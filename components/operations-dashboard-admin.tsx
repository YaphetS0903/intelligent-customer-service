"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  BookOpenCheck,
  CheckCircle2,
  CircleHelp,
  Clock3,
  Download,
  FileQuestion,
  GraduationCap,
  ListChecks,
  Loader2,
  MessageSquareText,
  SearchX,
  SlidersHorizontal,
  Sparkles,
  TicketCheck,
  Users,
  X
} from "lucide-react";
import { ErrorRetry, PanelSkeleton } from "@/components/ui-feedback";
import { fetchWithRetry } from "@/lib/client-fetch";
import type { OperationsDashboardReport } from "@/lib/operations-dashboard";

type FilterDraft = {
  days: string;
  from: string;
  to: string;
  department: string;
  position: string;
};

const emptyDraft: FilterDraft = { days: "30", from: "", to: "", department: "", position: "" };

export function OperationsDashboardAdmin() {
  const [report, setReport] = useState<OperationsDashboardReport | null>(null);
  const [draft, setDraft] = useState<FilterDraft>(emptyDraft);
  const [query, setQuery] = useState("days=30");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async (nextQuery: string) => {
    setLoading(true);
    setLoadError(null);
    try {
      const response = await fetchWithRetry(`/api/admin/operations-dashboard?${nextQuery}`, { cache: "no-store" }, { timeoutMs: 60_000 });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "读取运营看板失败");
      const nextReport = data.report as OperationsDashboardReport;
      setReport(nextReport);
      setDraft((current) => ({
        ...current,
        days: String(nextReport.filters.days),
        from: nextReport.filters.from_date,
        to: nextReport.filters.to_date,
        department: nextReport.filters.department,
        position: nextReport.filters.position
      }));
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "读取运营看板失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(query); }, [load, query]);

  function applyQuery(params: URLSearchParams) {
    const nextQuery = params.toString();
    setQuery(nextQuery);
    window.history.replaceState(null, "", `/admin/analytics${nextQuery ? `?${nextQuery}` : ""}`);
  }

  function selectRange(days: string) {
    const params = new URLSearchParams({ days });
    if (draft.department) params.set("department", draft.department);
    if (draft.position) params.set("position", draft.position);
    setDraft((current) => ({ ...current, days, from: "", to: "" }));
    applyQuery(params);
  }

  function applyFilters() {
    const params = new URLSearchParams();
    if (draft.from) params.set("from", draft.from);
    if (draft.to) params.set("to", draft.to);
    if (!draft.from && !draft.to) params.set("days", draft.days || "30");
    if (draft.department) params.set("department", draft.department);
    if (draft.position) params.set("position", draft.position);
    applyQuery(params);
  }

  function resetFilters() {
    setDraft(emptyDraft);
    applyQuery(new URLSearchParams({ days: "30" }));
  }

  if (loading && !report) return <PanelSkeleton rows={7} className="min-h-[560px]" />;
  if (loadError && !report) return <ErrorRetry title="运营看板加载失败" message={loadError} retrying={loading} onRetry={() => void load(query)} />;
  if (!report) return null;

  const summary = report.summary;
  const exportHref = `/api/admin/operations-dashboard/export?${query}`;

  return (
    <div className="space-y-7 pb-8">
      <header className="flex flex-col gap-4 border-b border-line pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="ui-page-kicker">TRIAL OPERATIONS</p>
          <h1 className="ui-page-title mt-1">试运行运营看板</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
            聚合员工使用、问答质量、审批、培训与工单数据，所有指标随筛选条件同步更新。
          </p>
        </div>
        <a href={exportHref} className="ui-button-primary h-11 shrink-0" download>
          <Download size={17} />
          导出 CSV
        </a>
      </header>

      {report.data_status.source === "snapshot" && (
        <section className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900" role="status">
          <p className="font-semibold">当前展示最近成功快照</p>
          <p className="mt-1 leading-6">数据更新时间：{formatDateTime(report.data_status.updated_at)}。数据库连接恢复后会自动切回实时数据。</p>
        </section>
      )}

      <section className="border-y border-line bg-white py-4" aria-labelledby="dashboard-filters">
        <div className="flex items-center gap-2">
          <SlidersHorizontal size={17} className="text-brand" />
          <h2 id="dashboard-filters" className="text-sm font-semibold text-ink">数据筛选</h2>
          {loading && <Loader2 size={15} className="animate-spin text-brand" aria-label="正在更新" />}
        </div>
        <div className="mt-3 grid gap-3 xl:grid-cols-[auto_minmax(140px,1fr)_minmax(140px,1fr)_minmax(140px,1fr)_minmax(140px,1fr)_auto]">
          <div className="grid grid-cols-3 gap-1 rounded-lg bg-slate-100 p-1" aria-label="快捷时间范围">
            {["7", "30", "90"].map((days) => (
              <button
                key={days}
                type="button"
                onClick={() => selectRange(days)}
                className={`h-10 min-w-14 rounded-md px-3 text-sm font-semibold transition ${draft.days === days && report.filters.days === Number(days) ? "bg-white text-brand shadow-sm" : "text-slate-600 hover:bg-white/70"}`}
              >
                {days} 天
              </button>
            ))}
          </div>
          <FilterField label="开始日期">
            <input type="date" value={draft.from} onChange={(event) => setDraft((current) => ({ ...current, from: event.target.value }))} className="ui-input h-11 w-full" />
          </FilterField>
          <FilterField label="结束日期">
            <input type="date" value={draft.to} onChange={(event) => setDraft((current) => ({ ...current, to: event.target.value }))} className="ui-input h-11 w-full" />
          </FilterField>
          <FilterField label="部门">
            <select value={draft.department} onChange={(event) => setDraft((current) => ({ ...current, department: event.target.value }))} className="ui-input h-11 w-full">
              <option value="">全部部门</option>
              {report.options.departments.map((department) => <option key={department} value={department}>{department}</option>)}
            </select>
          </FilterField>
          <FilterField label="岗位">
            <select value={draft.position} onChange={(event) => setDraft((current) => ({ ...current, position: event.target.value }))} className="ui-input h-11 w-full">
              <option value="">全部岗位</option>
              {report.options.positions.map((position) => <option key={position} value={position}>{position}</option>)}
            </select>
          </FilterField>
          <div className="flex items-end gap-2">
            <button type="button" onClick={applyFilters} disabled={loading} className="ui-button-primary h-11 flex-1 px-5 xl:flex-none">应用</button>
            <button type="button" onClick={resetFilters} disabled={loading} className="grid size-11 shrink-0 place-items-center rounded-lg border border-line bg-white text-slate-500 transition hover:border-slate-300 hover:text-ink" aria-label="清除筛选" title="清除筛选">
              <X size={17} />
            </button>
          </div>
        </div>
        <p className="mt-3 text-xs text-slate-500">
          当前范围：{report.filters.from_date} 至 {report.filters.to_date} · {report.filters.department || "全部部门"} · {report.filters.position || "全部岗位"} · 数据更新 {formatDateTime(report.data_status.updated_at)}
        </p>
      </section>

      {loadError && <ErrorRetry title="数据更新失败" message={loadError} retrying={loading} onRetry={() => void load(query)} />}

      <section aria-labelledby="usage-heading">
        <SectionHeading id="usage-heading" icon={Activity} title="员工使用与问答" detail="使用规模和回答有效性" />
        <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard icon={Users} label="活跃员工" value={summary.active_employees.value} suffix="人" detail={`${summary.active_employees.rate}% 覆盖 · 共 ${summary.active_employees.eligible} 人`} tone="blue" />
          <MetricCard icon={MessageSquareText} label="问答量" value={summary.questions.value} suffix="次" detail={`${summary.questions.conversations} 个会话`} tone="cyan" />
          <MetricCard icon={Sparkles} label="满意度" value={formatPercent(summary.satisfaction.rate)} detail={`${summary.satisfaction.positive}/${summary.satisfaction.rated} 条评价`} tone="green" />
          <MetricCard icon={SearchX} label="无引用率" value={formatPercent(summary.no_citation.rate)} detail={`${summary.no_citation.value}/${summary.no_citation.answers} 次回答`} tone={summary.no_citation.rate > 20 ? "amber" : "green"} />
        </div>
      </section>

      <section aria-labelledby="quality-heading">
        <SectionHeading id="quality-heading" icon={BookOpenCheck} title="质量与知识治理" detail="测试、缺口和整改闭环" />
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          <MetricCard icon={CheckCircle2} label="QA 通过率" value={formatPercent(summary.qa.rate)} detail={`${summary.qa.passed}/${summary.qa.tested} 个已执行测试`} tone="green" />
          <MetricCard icon={FileQuestion} label="知识缺口" value={summary.knowledge_gaps.value} suffix="项" detail={`${summary.knowledge_gaps.open} 项整改待处理`} tone="amber" />
          <MetricCard icon={ListChecks} label="整改完成率" value={formatPercent(summary.remediation.rate)} detail={`${summary.remediation.completed}/${summary.remediation.total} 项任务`} tone="blue" />
        </div>
      </section>

      <section aria-labelledby="process-heading">
        <SectionHeading id="process-heading" icon={Clock3} title="流程效率" detail="审批、培训和服务工单" />
        <div className="mt-3 grid gap-3 xl:grid-cols-3">
          <ProcessPanel
            icon={Clock3}
            title="资料审批"
            primaryLabel="平均审批耗时"
            primaryValue={formatHours(summary.approvals.average_hours)}
            rows={[
              ["完成审批", `${summary.approvals.reviewed} 项`],
              ["待审批积压", `${summary.approvals.pending_backlog} 项`]
            ]}
          />
          <ProcessPanel
            icon={GraduationCap}
            title="员工培训"
            primaryLabel="参与率"
            primaryValue={formatPercent(summary.training.participation_rate)}
            rows={[
              ["完课率", formatPercent(summary.training.completion_rate)],
              ["测验通过率", formatPercent(summary.training.quiz_pass_rate)]
            ]}
          />
          <ProcessPanel
            icon={TicketCheck}
            title="人工工单"
            primaryLabel="工单数量"
            primaryValue={`${summary.tickets.value} 单`}
            rows={[
              ["平均响应", formatHours(summary.tickets.average_response_hours)],
              ["关闭率", formatPercent(summary.tickets.close_rate)]
            ]}
          />
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <TrendPanel daily={report.daily} />
        <DepartmentPanel departments={report.departments} />
      </div>

      <details className="border-y border-line bg-white py-4">
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 text-sm font-semibold text-ink [&::-webkit-details-marker]:hidden">
          <CircleHelp size={17} className="text-brand" />
          指标口径
        </summary>
        <div className="mt-3 grid gap-x-8 gap-y-4 md:grid-cols-2">
          {report.definitions.map((definition) => (
            <div key={definition.key}>
              <h3 className="text-sm font-semibold text-ink">{definition.label}</h3>
              <p className="mt-1 text-sm leading-6 text-slate-600">{definition.description}</p>
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}

function FilterField({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-1 block text-xs font-medium text-slate-500">{label}</span>{children}</label>;
}

function SectionHeading({ id, icon: Icon, title, detail }: { id: string; icon: typeof Activity; title: string; detail: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="grid size-9 place-items-center rounded-lg bg-slate-900 text-white"><Icon size={17} /></span>
      <div><h2 id={id} className="text-base font-semibold text-ink">{title}</h2><p className="text-xs text-slate-500">{detail}</p></div>
    </div>
  );
}

const toneClasses = {
  blue: "bg-blue-50 text-blue-700 ring-blue-100",
  cyan: "bg-cyan-50 text-cyan-700 ring-cyan-100",
  green: "bg-emerald-50 text-emerald-700 ring-emerald-100",
  amber: "bg-amber-50 text-amber-700 ring-amber-100"
};

function MetricCard({ icon: Icon, label, value, suffix, detail, tone }: { icon: typeof Activity; label: string; value: string | number; suffix?: string; detail: string; tone: keyof typeof toneClasses }) {
  return (
    <article className="ui-card min-h-36 p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium text-slate-600">{label}</p>
        <span className={`grid size-9 place-items-center rounded-lg ring-1 ${toneClasses[tone]}`}><Icon size={17} /></span>
      </div>
      <p className="mt-4 tabular-nums text-3xl font-semibold text-ink">{value}{suffix && <span className="ml-1 text-base font-medium text-slate-500">{suffix}</span>}</p>
      <p className="mt-2 text-xs text-slate-500">{detail}</p>
    </article>
  );
}

function ProcessPanel({ icon: Icon, title, primaryLabel, primaryValue, rows }: { icon: typeof Activity; title: string; primaryLabel: string; primaryValue: string; rows: Array<[string, string]> }) {
  return (
    <article className="ui-card p-5">
      <div className="flex items-center gap-3"><span className="grid size-9 place-items-center rounded-lg bg-slate-100 text-slate-700"><Icon size={17} /></span><h3 className="font-semibold text-ink">{title}</h3></div>
      <p className="mt-5 text-xs font-medium text-slate-500">{primaryLabel}</p>
      <p className="mt-1 tabular-nums text-2xl font-semibold text-ink">{primaryValue}</p>
      <dl className="mt-4 divide-y divide-line border-t border-line">
        {rows.map(([label, value]) => <div key={label} className="flex items-center justify-between gap-3 py-3 text-sm"><dt className="text-slate-500">{label}</dt><dd className="tabular-nums font-semibold text-ink">{value}</dd></div>)}
      </dl>
    </article>
  );
}

function TrendPanel({ daily }: { daily: OperationsDashboardReport["daily"] }) {
  const buckets = useMemo(() => bucketTrend(daily), [daily]);
  const maximum = Math.max(1, ...buckets.map((item) => item.questions));
  return (
    <section className="ui-card p-5" aria-labelledby="trend-heading">
      <div className="flex items-start justify-between gap-4"><div><h2 id="trend-heading" className="font-semibold text-ink">问答趋势</h2><p className="mt-1 text-xs text-slate-500">按所选周期自动汇总</p></div><span className="text-xs font-medium text-slate-500">共 {daily.reduce((sum, row) => sum + row.questions, 0)} 次</span></div>
      <div className="mt-6 grid h-52 items-end gap-1.5" style={{ gridTemplateColumns: `repeat(${Math.max(buckets.length, 1)}, minmax(0, 1fr))` }}>
        {buckets.map((item, index) => (
          <div key={`${item.label}-${index}`} className="group flex h-full min-w-0 flex-col justify-end" title={`${item.label}：${item.questions} 次问答，${item.active} 人活跃`}>
            <div className="relative flex flex-1 items-end"><div className="w-full rounded-t bg-brand/80 transition group-hover:bg-brand" style={{ height: `${Math.max(4, item.questions / maximum * 100)}%` }} /></div>
            <span className="mt-2 hidden truncate text-center text-[10px] text-slate-500 sm:block">{index % Math.max(1, Math.ceil(buckets.length / 6)) === 0 || index === buckets.length - 1 ? item.label : ""}</span>
          </div>
        ))}
      </div>
      <div className="mt-2 flex justify-between text-[10px] text-slate-500 sm:hidden">
        <span>{buckets[0]?.label ?? ""}</span>
        <span>{buckets.at(-1)?.label ?? ""}</span>
      </div>
      <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 border-t border-line pt-3 text-xs text-slate-500">
        <span>峰值 {Math.max(0, ...buckets.map((item) => item.questions))} 次</span>
        <span>活跃员工日均 {formatNumber(average(buckets.map((item) => item.active)))} 人</span>
      </div>
    </section>
  );
}

function DepartmentPanel({ departments }: { departments: OperationsDashboardReport["departments"] }) {
  const visible = [...departments].sort((a, b) => b.questions - a.questions || b.active_employees - a.active_employees).slice(0, 8);
  return (
    <section className="ui-card p-5" aria-labelledby="department-heading">
      <div><h2 id="department-heading" className="font-semibold text-ink">部门使用情况</h2><p className="mt-1 text-xs text-slate-500">按问答量排序，最多展示 8 个部门</p></div>
      {visible.length === 0 ? <p className="mt-8 rounded-lg bg-slate-50 p-5 text-center text-sm text-slate-500">当前筛选范围暂无部门数据</p> : (
        <div className="mt-4 space-y-1">
          {visible.map((department) => (
            <div key={department.department} className="grid grid-cols-[minmax(0,1fr)_64px_64px] items-center gap-3 border-b border-line py-3 last:border-0">
              <div className="min-w-0"><p className="truncate text-sm font-semibold text-ink" title={department.department}>{department.department}</p><p className="mt-0.5 text-xs text-slate-500">满意 {formatPercent(department.satisfaction_rate)} · 无引用 {formatPercent(department.no_citation_rate)}</p></div>
              <div className="text-right"><p className="tabular-nums text-sm font-semibold text-ink">{department.active_employees}</p><p className="text-[10px] text-slate-500">活跃</p></div>
              <div className="text-right"><p className="tabular-nums text-sm font-semibold text-brand">{department.questions}</p><p className="text-[10px] text-slate-500">问答</p></div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function bucketTrend(daily: OperationsDashboardReport["daily"]) {
  const size = daily.length > 62 ? 7 : daily.length > 31 ? 3 : daily.length > 16 ? 2 : 1;
  const buckets: Array<{ label: string; questions: number; active: number }> = [];
  for (let index = 0; index < daily.length; index += size) {
    const rows = daily.slice(index, index + size);
    buckets.push({
      label: rows[0]?.date.slice(5).replace("-", "/") ?? "",
      questions: rows.reduce((sum, row) => sum + row.questions, 0),
      active: Math.round(rows.reduce((sum, row) => sum + row.active_employees, 0) / Math.max(rows.length, 1))
    });
  }
  return buckets;
}

function formatPercent(value: number) { return `${formatNumber(value)}%`; }
function formatHours(value: number | null) { return value === null ? "暂无数据" : value < 1 ? `${Math.round(value * 60)} 分钟` : `${formatNumber(value)} 小时`; }
function formatNumber(value: number) { return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 1 }).format(value); }
function average(values: number[]) { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0; }
function formatDateTime(value: string) { return new Date(value).toLocaleString("zh-CN", { hour12: false }); }
