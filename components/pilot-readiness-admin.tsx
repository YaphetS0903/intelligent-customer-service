"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ChevronDown,
  CheckCircle2,
  ClipboardList,
  Download,
  FileSearch,
  Loader2,
  Plus,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  XCircle
} from "lucide-react";
import { ErrorRetry, PanelSkeleton, useToast } from "@/components/ui-feedback";
import { fetchWithRetry } from "@/lib/client-fetch";
import type { PilotCheck, PilotCheckStatus, PilotReadiness } from "@/lib/pilot-readiness";

const groupLabel: Record<PilotCheck["group"], string> = {
  knowledge: "知识资料",
  permission: "账号权限",
  qa: "问答质量",
  training: "培训讲解",
  operation: "运营闭环"
};

const statusLabel: Record<PilotCheckStatus, string> = {
  ready: "已就绪",
  warning: "待完善",
  error: "需处理"
};

const statusClass: Record<PilotCheckStatus, string> = {
  ready: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  warning: "bg-amber-50 text-amber-700 ring-amber-200",
  error: "bg-red-50 text-red-700 ring-red-200"
};

export function PilotReadinessAdmin() {
  const { pushToast } = useToast();
  const [readiness, setReadiness] = useState<PilotReadiness | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<"checks" | "guidance">("checks");

  useEffect(() => {
    void loadReadiness();
  }, []);

  const groupedChecks = useMemo(() => {
    const groups: Record<PilotCheck["group"], PilotCheck[]> = {
      knowledge: [],
      permission: [],
      qa: [],
      training: [],
      operation: []
    };

    for (const check of readiness?.checks ?? []) {
      groups[check.group].push(check);
    }

    return groups;
  }, [readiness]);

  async function loadReadiness() {
    setLoading(true);
    setLoadError(null);

    try {
      const response = await fetchWithRetry("/api/admin/pilot-readiness", { cache: "no-store" }, { timeoutMs: 20000 });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "读取试运行验收数据失败");
      }

      setReadiness(data.readiness);
    } catch (error) {
      const message = error instanceof Error ? error.message : "读取试运行验收数据失败";
      setLoadError(message);
      if (readiness) {
        pushToast({
          tone: "error",
          title: "刷新失败",
          description: message
        });
      }
    } finally {
      setLoading(false);
    }
  }

  async function generateQaTemplate() {
    setGenerating(true);

    try {
      const response = await fetch("/api/admin/qa-tests/generate-template", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ limit: 30 })
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "生成测试模板失败");
      }

      await loadReadiness();
      pushToast({
        tone: "success",
        title: "测试问题已生成",
        description: `已生成 ${data.count ?? 0} 条试运行测试问题${data.skipped?.length ? `，跳过 ${data.skipped.length} 条重复问题` : ""}。`
      });
    } catch (error) {
      pushToast({
        tone: "error",
        title: "生成测试模板失败",
        description: error instanceof Error ? error.message : "生成测试模板失败"
      });
    } finally {
      setGenerating(false);
    }
  }

  function notifyExport() {
    pushToast({
      tone: "info",
      title: "开始导出",
      description: "试运行验收报告正在下载，请留意浏览器下载栏。",
      durationMs: 2600
    });
  }

  return (
    <div className="space-y-3 pb-6">
      <header className="flex flex-col gap-3 border-b border-line pb-3 lg:flex-row lg:items-center lg:justify-between" data-testid="pilot-header">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-cyan/10 text-brand">
              <ClipboardList size={18} />
            </span>
            <div className="min-w-0">
              <h1 className="text-xl font-semibold text-ink">试运行验收</h1>
              <p className="truncate text-sm text-slate-500">资料、权限、问答、培训与运营闭环验收</p>
            </div>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <a
              href="/api/admin/pilot-readiness/export"
              onClick={notifyExport}
              className="ui-button-primary h-10"
            >
              <Download size={16} />
              导出报告
            </a>
            <button
              type="button"
              onClick={() => void loadReadiness()}
              disabled={loading}
              className="ui-button-secondary h-10"
            >
              {loading ? <Loader2 className="animate-spin" size={16} /> : <RefreshCw size={16} />}
              刷新
            </button>
          </div>
      </header>

      {loading && !readiness && <PilotReadinessSkeleton />}

      {!loading && loadError && !readiness && (
        <ErrorRetry
          title="试运行验收加载失败"
          message={loadError}
          retrying={loading}
          onRetry={() => void loadReadiness()}
        />
      )}

      {readiness && (
        <>
          <section className="grid grid-cols-2 gap-3 xl:grid-cols-4" data-testid="pilot-primary-metrics">
            <Metric label="验收得分" value={`${readiness.summary.score}%`} highlight />
            <Metric label="已就绪" value={readiness.summary.ready} />
            <Metric label="待完善" value={readiness.summary.warning} />
            <Metric label="需处理" value={readiness.summary.error} />
          </section>

          <details className="ui-card group overflow-hidden" data-testid="pilot-metrics-details">
            <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between gap-3 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 [&::-webkit-details-marker]:hidden">
              <span>查看全部验收指标 · {readiness.summary.total} 项检查</span>
              <ChevronDown className="size-4 text-slate-400 transition group-open:rotate-180" />
            </summary>
            <div className="grid gap-3 border-t border-line p-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
              <Metric label="可用资料" value={readiness.metrics.readyDocuments} compact />
              <Metric label="知识片段" value={readiness.metrics.chunks} compact />
              <Metric label="员工账号" value={readiness.metrics.employeeUsers} compact />
              <Metric label="部门数" value={readiness.metrics.departments} compact />
              <Metric label="测试问题" value={readiness.metrics.qaTests} compact />
              <Metric label="已运行" value={readiness.metrics.qaRun} compact />
              <Metric label="通过率" value={`${readiness.metrics.qaPassRate}%`} compact />
              <Metric label="无引用率" value={`${readiness.metrics.qaNoCitationRate}%`} compact />
            </div>
          </details>

          <section className="ui-card grid grid-cols-2 gap-1 p-1.5" aria-label="试运行验收视图">
            <PilotViewButton active={activeView === "checks"} onClick={() => setActiveView("checks")}>验收检查</PilotViewButton>
            <PilotViewButton active={activeView === "guidance"} onClick={() => setActiveView("guidance")}>解析与试运行建议</PilotViewButton>
          </section>

          {activeView === "guidance" && (
          <section className="grid gap-3 xl:grid-cols-2">
              <section className="ui-card p-5">
                <div className="flex items-center gap-2">
                  <FileSearch size={18} className="text-brand" />
                  <h2 className="text-base font-semibold text-ink">解析覆盖</h2>
                </div>
                <div className="mt-4 space-y-3">
                  {readiness.parserCoverage.length > 0 ? (
                    readiness.parserCoverage.map((item) => (
                      <div key={item.parser} className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2 text-sm">
                        <span className="font-medium text-slate-700">{parserLabel(item.parser)}</span>
                        <span className="text-slate-500">{item.chunks} 个片段</span>
                      </div>
                    ))
                  ) : (
                    <p className="text-sm text-slate-500">暂无解析统计。</p>
                  )}
                </div>
              </section>

              <section className="ui-card p-5">
                <div className="flex items-center gap-2">
                  <Sparkles size={18} className="text-brand" />
                  <h2 className="text-base font-semibold text-ink">建议试运行步骤</h2>
                </div>
                <div className="mt-4 rounded-lg border border-cyan/20 bg-cyan/10 px-3 py-2 text-sm leading-6 text-steel">
                  导出报告会包含验收得分、检查项、资料版本、QA 指标、整改任务和反馈闭环，适合评审留档。
                </div>
                <ol className="mt-4 space-y-3 text-sm leading-6 text-slate-600">
                  <li>1. 上传 3-5 份真实制度、质量、安全或生产培训资料。</li>
                  <li>2. 创建至少 2 个不同部门员工账号。</li>
                  <li>3. 配置一个部门可见知识库并验证越权隔离。</li>
                  <li>4. 导入 30 条高频问题，批量运行问答测试。</li>
                  <li>5. 处理无引用、低覆盖和不通过问题后再开放试用。</li>
                </ol>
                <button
                  type="button"
                  onClick={() => void generateQaTemplate()}
                  disabled={generating}
                  className="ui-button-primary mt-5 h-10 w-full"
                >
                  {generating ? <Loader2 className="animate-spin" size={16} /> : <Plus size={16} />}
                  生成 30 条测试问题
                </button>
                <p className="mt-2 text-xs leading-5 text-slate-500">
                  生成后可到“问答测试”页批量运行，并按真实资料修改期望答案。
                </p>
              </section>

          </section>
          )}

          {activeView === "checks" && (
            <section className="grid gap-3 xl:grid-cols-2">
              {(Object.keys(groupedChecks) as Array<PilotCheck["group"]>).map((group) => (
                <CheckGroup key={group} title={groupLabel[group]} checks={groupedChecks[group]} />
              ))}
            </section>
          )}
        </>
      )}
    </div>
  );
}

function Metric({ label, value, highlight = false, compact = false }: { label: string; value: string | number; highlight?: boolean; compact?: boolean }) {
  return (
    <div className={`rounded-lg border ${compact ? "px-3 py-2.5" : "p-4"} ${highlight ? "border-cyan/30 bg-cyan/10" : "border-line bg-white"}`}>
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className={`${compact ? "mt-1 text-lg" : "mt-2 text-2xl"} font-semibold tabular-nums ${highlight ? "text-brand" : "text-ink"}`}>{value}</p>
    </div>
  );
}

function PilotViewButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active} className={`min-h-11 rounded-md px-3 py-2 text-sm font-semibold transition ${active ? "bg-brand text-white" : "text-slate-600 hover:bg-slate-100"}`}>
      {children}
    </button>
  );
}

function CheckGroup({ title, checks }: { title: string; checks: PilotCheck[] }) {
  return (
    <section className="ui-card min-w-0 p-5">
      <div className="flex items-center gap-2">
        <ShieldCheck size={18} className="text-brand" />
        <h2 className="text-base font-semibold text-ink">{title}</h2>
      </div>
      {checks.length > 0 ? (
        <div className="mt-4 grid gap-3">
          {checks.map((check) => (
            <CheckCard key={check.id} check={check} />
          ))}
        </div>
      ) : (
        <EmptyState text="暂无验收项。该分组暂无需要处理的试运行检查。" />
      )}
    </section>
  );
}

function CheckCard({ check }: { check: PilotCheck }) {
  return (
    <article className="min-w-0 rounded-lg border border-line p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className="mt-0.5 shrink-0">{statusIcon(check.status)}</span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold text-ink">{check.name}</h3>
              <span className={`rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${statusClass[check.status]}`}>
                {statusLabel[check.status]}
              </span>
            </div>
            <p className="mt-2 break-words text-sm leading-6 text-slate-600">{check.detail}</p>
          </div>
        </div>
        {check.action && (
          <Link
            href={check.action.href}
            className="inline-flex h-9 w-full shrink-0 items-center justify-center rounded-lg border border-line px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 sm:w-auto"
          >
            {check.action.label}
          </Link>
        )}
      </div>
    </article>
  );
}

function statusIcon(status: PilotCheckStatus) {
  if (status === "ready") {
    return <CheckCircle2 size={18} className="text-emerald-600" />;
  }

  if (status === "error") {
    return <XCircle size={18} className="text-red-600" />;
  }

  return <AlertTriangle size={18} className="text-amber-600" />;
}

function parserLabel(parser: string) {
  const labels: Record<string, string> = {
    text: "TXT/Markdown",
    docx: "Word",
    pptx: "PPT",
    pdf_text: "PDF",
    excel: "Excel",
    ocr: "OCR",
    local_text: "本地文本"
  };

  return labels[parser] ?? parser;
}

function EmptyState({ text }: { text: string }) {
  return (
    <p className="mt-4 rounded-lg border border-dashed border-line px-3 py-4 text-sm leading-6 text-slate-500">
      {text}
    </p>
  );
}

function PilotReadinessSkeleton() {
  return (
    <div className="space-y-5" aria-label="正在加载试运行验收">
      <section className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {Array.from({ length: 5 }).map((_, index) => (
          <PanelSkeleton key={index} rows={1} className="shadow-none" />
        ))}
      </section>
      <section className="grid gap-3 md:grid-cols-4 xl:grid-cols-8">
        {Array.from({ length: 8 }).map((_, index) => (
          <PanelSkeleton key={index} rows={1} className="shadow-none" />
        ))}
      </section>
      <section className="grid gap-5 xl:grid-cols-[340px_1fr]">
        <div className="space-y-5">
          <PanelSkeleton rows={3} />
          <PanelSkeleton rows={5} />
        </div>
        <section className="space-y-5">
          <PanelSkeleton rows={4} />
          <PanelSkeleton rows={4} />
          <PanelSkeleton rows={4} />
        </section>
      </section>
    </div>
  );
}
