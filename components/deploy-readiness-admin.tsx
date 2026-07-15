"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowUpRight,
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  Database,
  Download,
  ExternalLink,
  FolderPlus,
  Loader2,
  MoreHorizontal,
  RefreshCw,
  Server,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Volume2,
  XCircle
} from "lucide-react";
import { ErrorRetry, PanelSkeleton, useToast } from "@/components/ui-feedback";
import { fetchWithRetry } from "@/lib/client-fetch";
import type { DeployCheck, DeployCheckStatus, DeployIntegrationCheck, DeployReadiness } from "@/lib/deploy-readiness";

type ModelTestResult = {
  ok: boolean;
  provider: string;
  model: string;
  modelLabel: string | null;
  latency_ms: number;
  answer: string | null;
  error: string | null;
};

type TtsTestResult = {
  ok: boolean;
  latency_ms: number;
  content_type: string | null;
  bytes: number;
  error: string | null;
};

type CheckFilter = "all" | "attention" | "ready";
type CheckGroupKey = DeployCheck["group"];

const groupLabel: Record<CheckGroupKey, string> = {
  environment: "环境变量",
  database: "数据库",
  model: "模型服务",
  runtime: "运行环境",
  backup: "备份运维",
  pilot: "试运行"
};

const groupOrder: CheckGroupKey[] = ["runtime", "environment", "database", "model", "pilot", "backup"];

const statusLabel: Record<DeployCheckStatus, string> = {
  ready: "已就绪",
  warning: "待确认",
  error: "需处理"
};

const statusClass: Record<DeployCheckStatus, string> = {
  ready: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  warning: "bg-amber-50 text-amber-700 ring-amber-200",
  error: "bg-red-50 text-red-700 ring-red-200"
};

const defaultExpandedGroups: Record<CheckGroupKey, boolean> = {
  runtime: false,
  environment: true,
  database: false,
  model: true,
  pilot: true,
  backup: false
};

export function DeployReadinessAdmin() {
  const { pushToast } = useToast();
  const [readiness, setReadiness] = useState<DeployReadiness | null>(null);
  const [loading, setLoading] = useState(true);
  const [seedingDemo, setSeedingDemo] = useState(false);
  const [testingModel, setTestingModel] = useState(false);
  const [testingTts, setTestingTts] = useState(false);
  const [modelTest, setModelTest] = useState<ModelTestResult | null>(null);
  const [ttsTest, setTtsTest] = useState<TtsTestResult | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState<CheckFilter>("attention");
  const [expandedGroups, setExpandedGroups] = useState(defaultExpandedGroups);

  useEffect(() => {
    void loadReadiness();
  }, []);

  const groupedChecks = useMemo(() => {
    const groups = Object.fromEntries(groupOrder.map((group) => [group, [] as DeployCheck[]])) as Record<CheckGroupKey, DeployCheck[]>;
    for (const check of readiness?.checks ?? []) groups[check.group].push(check);
    return groups;
  }, [readiness]);

  const visibleGroups = useMemo(() => {
    const matchesFilter = (check: DeployCheck) => {
      if (filter === "attention") return check.status !== "ready";
      if (filter === "ready") return check.status === "ready";
      return true;
    };
    return Object.fromEntries(
      groupOrder.map((group) => [group, groupedChecks[group].filter(matchesFilter)])
    ) as Record<CheckGroupKey, DeployCheck[]>;
  }, [filter, groupedChecks]);

  const attentionCount = (readiness?.summary.warning ?? 0) + (readiness?.summary.error ?? 0);

  async function loadReadiness() {
    setLoading(true);
    setLoadError(null);
    try {
      const response = await fetchWithRetry("/api/admin/deploy-readiness", { cache: "no-store" }, { timeoutMs: 20000 });
      const data = await response.json() as { readiness?: DeployReadiness; error?: string };
      if (!response.ok || !data.readiness) throw new Error(data.error ?? "读取生产部署检查失败");
      setReadiness(data.readiness);
    } catch (error) {
      const message = error instanceof Error ? error.message : "读取生产部署检查失败";
      setLoadError(message);
      if (readiness) pushToast({ tone: "error", title: "刷新失败", description: message });
    } finally {
      setLoading(false);
    }
  }

  async function testModel() {
    setTestingModel(true);
    try {
      const response = await fetch("/api/system/model-test", { method: "POST" });
      const data = await response.json() as { result?: ModelTestResult; error?: string };
      setModelTest(data.result ?? null);
      if (!response.ok) throw new Error(data.result?.error ?? data.error ?? "模型连通性测试失败");
      pushToast({ tone: "success", title: "模型测试通过", description: `${data.result?.modelLabel ?? data.result?.model ?? "当前模型"} · ${data.result?.latency_ms ?? "-"}ms` });
    } catch (error) {
      pushToast({ tone: "error", title: "模型测试失败", description: error instanceof Error ? error.message : "模型连通性测试失败" });
    } finally {
      setTestingModel(false);
    }
  }

  async function testTts() {
    setTestingTts(true);
    try {
      const response = await fetch("/api/system/tts-test", { method: "POST" });
      const data = await response.json() as { result?: TtsTestResult; error?: string };
      setTtsTest(data.result ?? null);
      if (!response.ok) throw new Error(data.result?.error ?? data.error ?? "语音连通性测试失败");
      pushToast({ tone: "success", title: "语音测试通过", description: `${data.result?.content_type ?? "audio"} · ${data.result?.bytes ?? 0} bytes · ${data.result?.latency_ms ?? "-"}ms` });
    } catch (error) {
      pushToast({ tone: "error", title: "语音测试失败", description: error instanceof Error ? error.message : "语音连通性测试失败" });
    } finally {
      setTestingTts(false);
    }
  }

  async function seedDemoData() {
    setSeedingDemo(true);
    try {
      const response = await fetch("/api/admin/demo-seed", { method: "POST" });
      const data = await response.json() as { result?: { created?: Record<string, number> }; error?: string };
      if (!response.ok) throw new Error(data.error ?? "整理演示数据失败");
      const created = data.result?.created ?? {};
      await loadReadiness();
      pushToast({ tone: "success", title: "演示数据已整理", description: `新增资料 ${created.documents ?? 0} 份、知识片段 ${created.chunks ?? 0} 个、QA ${created.qaTests ?? 0} 条、培训课程 ${created.trainingJobs ?? 0} 个。` });
    } catch (error) {
      pushToast({ tone: "error", title: "整理演示数据失败", description: error instanceof Error ? error.message : "整理演示数据失败" });
    } finally {
      setSeedingDemo(false);
    }
  }

  function notifyExport(label: string) {
    pushToast({ tone: "info", title: "开始导出", description: `${label} 正在下载，请留意浏览器下载栏。`, durationMs: 2600 });
  }

  function toggleGroup(group: CheckGroupKey) {
    setExpandedGroups((current) => ({ ...current, [group]: !current[group] }));
  }

  return (
    <div className="min-w-0 space-y-4" data-testid="deploy-readiness">
      <header className="ui-card overflow-visible">
        <div className="flex flex-col gap-4 px-5 py-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-cyan/10 text-brand"><Server size={20} /></span>
            <div className="min-w-0">
              <h1 className="text-lg font-semibold text-ink">部署检查</h1>
              <p className="mt-0.5 text-sm text-slate-500">集中查看生产环境是否可以稳定运行。</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => void testModel()} disabled={testingModel} className="ui-button-secondary h-10">
              {testingModel ? <Loader2 size={16} className="animate-spin" /> : <Bot size={16} />}测试模型
            </button>
            <button type="button" onClick={() => void testTts()} disabled={testingTts} className="ui-button-secondary h-10">
              {testingTts ? <Loader2 size={16} className="animate-spin" /> : <Volume2 size={16} />}测试语音
            </button>
            <button type="button" onClick={() => void loadReadiness()} disabled={loading} className="ui-button-primary h-10">
              {loading ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}刷新检查
            </button>
            <details className="relative">
              <summary role="button" aria-label="更多操作" className="ui-button-secondary flex h-10 cursor-pointer list-none items-center gap-2 [&::-webkit-details-marker]:hidden">
                <MoreHorizontal size={17} />更多操作<ChevronDown size={14} />
              </summary>
              <div className="absolute right-0 top-12 z-20 grid min-w-48 gap-1 rounded-lg border border-line bg-white p-2 shadow-soft">
                <button type="button" onClick={() => { if (window.confirm("确认在当前环境整理演示数据吗？该操作可能新增演示资料、QA 和课程。")) void seedDemoData(); }} disabled={seedingDemo} className="flex min-h-10 items-center gap-2 rounded-md px-3 text-left text-sm text-slate-700 hover:bg-slate-50">
                  {seedingDemo ? <Loader2 size={16} className="animate-spin" /> : <FolderPlus size={16} />}整理演示数据
                </button>
                <a href="/api/admin/deploy-readiness/export" onClick={() => notifyExport("上线报告")} className="flex min-h-10 items-center gap-2 rounded-md px-3 text-sm text-slate-700 hover:bg-slate-50"><Download size={16} />上线报告</a>
                <a href="/api/admin/deploy-readiness/export?format=csv" onClick={() => notifyExport("指标 CSV")} className="flex min-h-10 items-center gap-2 rounded-md px-3 text-sm text-slate-700 hover:bg-slate-50"><Download size={16} />指标 CSV</a>
                <a href="/api/admin/deploy-readiness/guide" onClick={() => notifyExport("运维手册")} className="flex min-h-10 items-center gap-2 rounded-md px-3 text-sm text-slate-700 hover:bg-slate-50"><Download size={16} />运维手册</a>
              </div>
            </details>
          </div>
        </div>
        <div className="flex flex-col gap-3 border-t border-line px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="grid max-w-md grid-cols-3 rounded-lg bg-slate-100 p-1" role="tablist" aria-label="检查项筛选">
            <FilterTab active={filter === "all"} onClick={() => setFilter("all")}>全部 {readiness?.summary.total ?? "-"}</FilterTab>
            <FilterTab active={filter === "attention"} onClick={() => setFilter("attention")} tone="warning">待处理 {readiness ? attentionCount : "-"}</FilterTab>
            <FilterTab active={filter === "ready"} onClick={() => setFilter("ready")} tone="success">已就绪 {readiness?.summary.ready ?? "-"}</FilterTab>
          </div>
          <p className="text-xs text-slate-500">最后检查：{formatCheckedAt(readiness?.checkedAt)}</p>
        </div>
      </header>

      {loading && !readiness && <DeployReadinessSkeleton />}
      {!loading && loadError && !readiness && <ErrorRetry title="部署检查加载失败" message={loadError} retrying={loading} onRetry={() => void loadReadiness()} />}

      {readiness && (
        <>
          {(modelTest || ttsTest) && (
            <section className="grid gap-3 md:grid-cols-2">
              {modelTest && <TestResultCard title="对话模型连通" ok={modelTest.ok} detail={modelTest.ok ? `${modelTest.modelLabel ?? modelTest.model} · ${modelTest.latency_ms}ms · ${modelTest.answer ?? "已返回"}` : modelTest.error ?? "模型测试失败"} />}
              {ttsTest && <TestResultCard title="语音服务连通" ok={ttsTest.ok} detail={ttsTest.ok ? `${ttsTest.content_type ?? "audio"} · ${ttsTest.bytes} bytes · ${ttsTest.latency_ms}ms` : ttsTest.error ?? "语音测试失败"} />}
            </section>
          )}

          <section className="ui-card grid gap-5 p-5 lg:grid-cols-[minmax(240px,0.9fr)_minmax(0,1.1fr)] lg:items-center">
            <div>
              <div className="flex items-end justify-between gap-3">
                <div><p className="text-sm font-semibold text-ink">部署准备度</p><p className="mt-1 text-xs text-slate-500">根据当前检查项自动计算</p></div>
                <p className="text-3xl font-semibold tabular-nums text-brand">{readiness.summary.score}%</p>
              </div>
              <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-brand transition-[width] duration-300" style={{ width: `${Math.max(0, Math.min(100, readiness.summary.score))}%` }} /></div>
            </div>
            <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
              <SummaryCount label="已就绪" value={readiness.summary.ready} tone="ready" />
              <SummaryCount label="待确认" value={readiness.summary.warning} tone="warning" />
              <SummaryCount label="需处理" value={readiness.summary.error} tone="error" />
              <SummaryCount label="检查项" value={readiness.summary.total} />
            </div>
          </section>

          <section className="ui-card overflow-hidden">
            <SectionHeading icon={SlidersHorizontal} title="运行快照" detail="当前服务、数据库和业务数据的关键状态" />
            <div className="grid divide-y divide-line sm:grid-cols-3 sm:divide-x sm:divide-y-0 xl:grid-cols-6">
              <SnapshotItem label="运行模式" value={readiness.runtime.nodeEnv} />
              <SnapshotItem label="访问地址" value={readiness.runtime.appBaseUrl} title={readiness.runtime.appBaseUrl} />
              <SnapshotItem label="数据库" value={readiness.runtime.databaseProvider} />
              <SnapshotItem label="RAG" value={readiness.runtime.ragProvider} />
              <SnapshotItem label="对话模型" value={readiness.runtime.chatProvider} />
              <SnapshotItem label="会话密钥" value={readiness.runtime.hasAuthSecret ? "已配置" : "未配置"} tone={readiness.runtime.hasAuthSecret ? "ready" : "error"} />
            </div>
            <div className="border-t border-line px-5 py-3">
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-slate-600">
                <span className="font-semibold text-ink">业务准备</span>
                <BusinessStat label="知识库" value={readiness.launchMetrics.knowledgeBases} detail={`${readiness.launchMetrics.readyDocuments} 份资料`} />
                <BusinessStat label="知识片段" value={readiness.launchMetrics.chunks} detail={`${readiness.launchMetrics.parserTypes} 类来源`} />
                <BusinessStat label="QA" value={`${readiness.launchMetrics.qaPassRate}%`} detail={`${readiness.launchMetrics.qaRun}/${readiness.launchMetrics.qaTests} 已运行`} />
                <BusinessStat label="待整改" value={readiness.launchMetrics.openKnowledgeTasks} detail={`反馈 ${readiness.launchMetrics.openFeedback}`} />
                <BusinessStat label="工单" value={readiness.launchMetrics.openServiceTickets} detail={`超时 ${readiness.launchMetrics.overdueServiceTickets}`} />
                <BusinessStat label="培训" value={readiness.launchMetrics.readyTrainingJobs} detail={`${readiness.launchMetrics.completedTrainingLearners}/${readiness.launchMetrics.trainingLearners} 完课`} />
              </div>
            </div>
          </section>

          <IntegrationChecklist items={readiness.integrationChecklist} />

          <section className="ui-card overflow-hidden">
            <SectionHeading icon={Database} title="资料解析覆盖" detail="已入库资料的解析来源" />
            <div className="flex flex-wrap gap-2 px-5 py-4">
              {readiness.parserCoverage.length > 0 ? readiness.parserCoverage.map((item) => (
                <span key={item.parser} className="inline-flex items-center gap-2 rounded-full bg-slate-50 px-3 py-1.5 text-sm text-slate-700 ring-1 ring-line">
                  <span className="font-medium">{item.label}</span><span className="text-xs text-slate-500">{item.chunks} 片段</span>
                </span>
              )) : <EmptyState text="暂无资料解析统计。" />}
            </div>
          </section>

          <section className="ui-card overflow-hidden">
            <div className="flex flex-col gap-3 border-b border-line px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div><div className="flex items-center gap-2"><ShieldCheck size={18} className="text-brand" /><h2 className="text-base font-semibold text-ink">检查项</h2></div><p className="mt-1 text-xs text-slate-500">点击分组展开详情，正常项默认收起以减少页面长度。</p></div>
              <span className="text-xs text-slate-500">显示 {Object.values(visibleGroups).reduce((total, items) => total + items.length, 0)} 项</span>
            </div>
            <div>
              {groupOrder.map((group) => visibleGroups[group].length > 0 ? (
                <CheckGroup key={group} title={groupLabel[group]} checks={visibleGroups[group]} total={groupedChecks[group].length} expanded={expandedGroups[group]} onToggle={() => toggleGroup(group)} />
              ) : null)}
              {Object.values(visibleGroups).every((items) => items.length === 0) && <EmptyState text="当前筛选没有对应检查项。" />}
            </div>
          </section>

          <div className="grid gap-3 md:grid-cols-2">
            <details className="ui-card group overflow-hidden">
              <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-5 text-sm font-semibold text-ink [&::-webkit-details-marker]:hidden"><span className="flex items-center gap-2"><ClipboardCheck size={17} className="text-brand" />上线顺序</span><ChevronDown size={16} className="text-slate-400 transition group-open:rotate-180" /></summary>
              <ol className="border-t border-line px-5 py-4 text-sm leading-6 text-slate-600"><li>1. 核对正式环境 `.env.local`。</li><li>2. 执行类型检查和生产构建。</li><li>3. 构建 Docker 镜像并保留回退版本。</li><li>4. 启动容器并执行部署预检。</li><li>5. 确认本页无红色检查项。</li><li>6. 导出报告并检查 MySQL 备份。</li></ol>
            </details>
            <section className="ui-card overflow-hidden">
              <div className="flex min-h-12 items-center gap-2 px-5 text-sm font-semibold text-ink"><Settings size={17} className="text-brand" />快捷入口</div>
              <div className="grid grid-cols-2 gap-2 border-t border-line p-3 sm:grid-cols-4"><QuickLink href="/admin/settings" label="系统配置" /><QuickLink href="/admin/documents" label="知识管理" /><QuickLink href="/admin/qa-tests" label="问答测试" /><QuickLink href="/admin/pilot" label="试运行验收" /></div>
            </section>
          </div>
        </>
      )}
    </div>
  );
}

function SectionHeading({ icon: Icon, title, detail }: { icon: typeof Server; title: string; detail: string }) {
  return <div className="flex items-center gap-2 border-b border-line px-5 py-3"><Icon size={17} className="text-brand" /><div><h2 className="text-sm font-semibold text-ink">{title}</h2><p className="text-xs text-slate-500">{detail}</p></div></div>;
}

function FilterTab({ active, onClick, tone, children }: { active: boolean; onClick: () => void; tone?: "warning" | "success"; children: React.ReactNode }) {
  const color = tone === "warning" ? "text-amber-700" : tone === "success" ? "text-emerald-700" : "text-slate-600";
  return <button type="button" role="tab" aria-selected={active} onClick={onClick} className={`min-h-9 rounded-md px-3 text-xs font-semibold transition ${active ? "bg-white text-ink shadow-sm" : `${color} hover:text-ink`}`}>{children}</button>;
}

function SummaryCount({ label, value, tone }: { label: string; value: number; tone?: DeployCheckStatus }) {
  const color = tone === "ready" ? "text-emerald-700" : tone === "warning" ? "text-amber-700" : tone === "error" ? "text-red-700" : "text-ink";
  return <div><p className="text-xs text-slate-500">{label}</p><p className={`mt-1 text-xl font-semibold tabular-nums ${color}`}>{value}</p></div>;
}

function SnapshotItem({ label, value, tone, title }: { label: string; value: string; tone?: DeployCheckStatus; title?: string }) {
  const color = tone === "error" ? "text-red-700" : "text-ink";
  return <div className="min-w-0 px-5 py-3"><p className="text-xs text-slate-500">{label}</p><p className={`mt-1 truncate text-sm font-semibold ${color}`} title={title ?? value}>{value}</p></div>;
}

function BusinessStat({ label, value, detail }: { label: string; value: string | number; detail: string }) {
  return <span className="inline-flex items-baseline gap-1.5"><span className="text-xs text-slate-500">{label}</span><strong className="tabular-nums text-ink">{value}</strong><span className="text-xs text-slate-400">{detail}</span></span>;
}

function IntegrationChecklist({ items }: { items: DeployIntegrationCheck[] }) {
  return <section className="ui-card overflow-hidden"><SectionHeading icon={ClipboardCheck} title="第三方联调" detail="配置后的真实接口验证入口" />{items.length > 0 ? <div className="grid gap-x-6 px-5 md:grid-cols-2">{items.map((item) => <IntegrationRow key={item.id} item={item} />)}</div> : <div className="px-5 py-4"><EmptyState text="暂无第三方联调检查项。" /></div>}</section>;
}

function IntegrationRow({ item }: { item: DeployIntegrationCheck }) {
  return <article className="min-w-0 border-b border-line py-3 last:border-b-0"><div className="flex items-center justify-between gap-3"><div className="flex min-w-0 items-center gap-2"><span className="shrink-0">{statusIcon(item.status)}</span><h3 className="truncate text-sm font-semibold text-ink">{item.name}</h3><span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${statusClass[item.status]}`}>{statusLabel[item.status]}</span></div><Link href={item.action.href} className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-brand hover:underline">{item.action.label}<ArrowUpRight size={13} /></Link></div><p className="mt-1 truncate pl-6 text-xs text-slate-500" title={item.detail}>{item.detail}</p><details className="group mt-1 pl-6"><summary className="inline-flex cursor-pointer list-none items-center gap-1 text-xs font-medium text-slate-500 hover:text-ink [&::-webkit-details-marker]:hidden">验收要求<ChevronDown size={12} className="transition group-open:rotate-180" /></summary><p className="mt-1 text-xs leading-5 text-slate-600">{item.acceptance}</p></details></article>;
}

function CheckGroup({ title, checks, total, expanded, onToggle }: { title: string; checks: DeployCheck[]; total: number; expanded: boolean; onToggle: () => void }) {
  const counts = { ready: 0, warning: 0, error: 0 };
  for (const check of checks) counts[check.status] += 1;
  const groupStatus: DeployCheckStatus = counts.error > 0 ? "error" : counts.warning > 0 ? "warning" : "ready";
  return <div className="border-b border-line last:border-b-0"><button type="button" onClick={onToggle} aria-expanded={expanded} className="flex min-h-12 w-full items-center gap-3 px-5 text-left hover:bg-slate-50"><span className="shrink-0">{statusIcon(groupStatus)}</span><span className="min-w-0 flex-1"><span className="text-sm font-semibold text-ink">{title}</span><span className="ml-2 text-xs text-slate-400">{total} 项</span></span>{counts.error > 0 && <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">{counts.error} 需处理</span>}{counts.warning > 0 && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">{counts.warning} 待确认</span>}<ChevronRight size={16} className={`shrink-0 text-slate-400 transition-transform ${expanded ? "rotate-90" : ""}`} /></button>{expanded && <div className="border-t border-line bg-slate-50/40">{checks.map((check) => <CheckRow key={check.id} check={check} />)}</div>}</div>;
}

function CheckRow({ check }: { check: DeployCheck }) {
  return <article className="flex min-w-0 flex-col gap-2 border-b border-line px-5 py-3 last:border-b-0 sm:flex-row sm:items-start sm:justify-between"><div className="flex min-w-0 items-start gap-3"><span className="mt-0.5 shrink-0">{statusIcon(check.status)}</span><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="text-sm font-semibold text-ink">{check.name}</h3><span className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${statusClass[check.status]}`}>{statusLabel[check.status]}</span></div><p className="mt-1 break-words text-sm leading-6 text-slate-600">{check.detail}</p></div></div>{check.action && <Link href={check.action.href} className="inline-flex min-h-8 shrink-0 items-center gap-1 self-start pl-8 text-xs font-medium text-brand hover:underline sm:pl-4">{check.action.label}<ExternalLink size={13} /></Link>}</article>;
}

function TestResultCard({ title, ok, detail }: { title: string; ok: boolean; detail: string }) {
  return <section className={`rounded-lg border px-4 py-3 ${ok ? "border-emerald-200 bg-emerald-50" : "border-red-200 bg-red-50"}`}><div className={`flex items-center gap-2 text-sm font-semibold ${ok ? "text-emerald-700" : "text-red-700"}`}>{ok ? <CheckCircle2 size={16} /> : <XCircle size={16} />}{title}</div><p className="mt-1 text-sm leading-6 text-slate-700">{detail}</p></section>;
}

function QuickLink({ href, label }: { href: string; label: string }) {
  return <Link href={href} className="inline-flex min-h-9 items-center justify-between rounded-md border border-line px-3 text-xs font-medium text-slate-700 hover:bg-slate-50">{label}<ArrowUpRight size={13} className="text-slate-400" /></Link>;
}

function statusIcon(status: DeployCheckStatus) {
  if (status === "ready") return <CheckCircle2 size={17} className="text-emerald-600" />;
  if (status === "error") return <XCircle size={17} className="text-red-600" />;
  return <AlertTriangle size={17} className="text-amber-600" />;
}

function EmptyState({ text }: { text: string }) {
  return <p className="rounded-lg border border-dashed border-line px-3 py-3 text-sm text-slate-500">{text}</p>;
}

function formatCheckedAt(value?: string) {
  if (!value) return "读取中";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { hour12: false });
}

function DeployReadinessSkeleton() {
  return <div className="space-y-4" aria-label="正在加载部署检查"><PanelSkeleton rows={3} /><PanelSkeleton rows={4} /><PanelSkeleton rows={7} /></div>;
}
