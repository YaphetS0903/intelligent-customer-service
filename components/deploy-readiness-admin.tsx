"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  ClipboardCheck,
  Database,
  Download,
  FolderPlus,
  Loader2,
  RefreshCw,
  Server,
  Settings,
  ShieldCheck,
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

const groupLabel: Record<DeployCheck["group"], string> = {
  environment: "环境变量",
  database: "数据库",
  model: "模型服务",
  runtime: "运行环境",
  backup: "备份运维",
  pilot: "试运行"
};

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

  useEffect(() => {
    void loadReadiness();
  }, []);

  const groupedChecks = useMemo(() => {
    const groups: Record<DeployCheck["group"], DeployCheck[]> = {
      runtime: [],
      environment: [],
      database: [],
      model: [],
      pilot: [],
      backup: []
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
      const response = await fetchWithRetry("/api/admin/deploy-readiness", { cache: "no-store" }, { timeoutMs: 20000 });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "读取生产部署检查失败");
      }

      setReadiness(data.readiness);
    } catch (error) {
      const message = error instanceof Error ? error.message : "读取生产部署检查失败";
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

  async function testModel() {
    setTestingModel(true);

    try {
      const response = await fetch("/api/system/model-test", { method: "POST" });
      const data = await response.json();
      setModelTest(data.result ?? null);

      if (!response.ok) {
        throw new Error(data.result?.error ?? data.error ?? "模型连通性测试失败");
      }
      pushToast({
        tone: "success",
        title: "模型测试通过",
        description: `${data.result?.modelLabel ?? data.result?.model ?? "当前模型"} · ${data.result?.latency_ms ?? "-"}ms`
      });
    } catch (error) {
      pushToast({
        tone: "error",
        title: "模型测试失败",
        description: error instanceof Error ? error.message : "模型连通性测试失败"
      });
    } finally {
      setTestingModel(false);
    }
  }

  async function testTts() {
    setTestingTts(true);

    try {
      const response = await fetch("/api/system/tts-test", { method: "POST" });
      const data = await response.json();
      setTtsTest(data.result ?? null);

      if (!response.ok) {
        throw new Error(data.result?.error ?? data.error ?? "语音连通性测试失败");
      }
      pushToast({
        tone: "success",
        title: "语音测试通过",
        description: `${data.result?.content_type ?? "audio"} · ${data.result?.bytes ?? 0} bytes · ${data.result?.latency_ms ?? "-"}ms`
      });
    } catch (error) {
      pushToast({
        tone: "error",
        title: "语音测试失败",
        description: error instanceof Error ? error.message : "语音连通性测试失败"
      });
    } finally {
      setTestingTts(false);
    }
  }

  async function seedDemoData() {
    setSeedingDemo(true);

    try {
      const response = await fetch("/api/admin/demo-seed", { method: "POST" });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "整理演示数据失败");
      }

      const created = data.result?.created ?? {};
      await loadReadiness();
      pushToast({
        tone: "success",
        title: "演示数据已整理",
        description: `新增资料 ${created.documents ?? 0} 份、知识片段 ${created.chunks ?? 0} 个、QA ${created.qaTests ?? 0} 条、培训课程 ${created.trainingJobs ?? 0} 个。`
      });
    } catch (error) {
      pushToast({
        tone: "error",
        title: "整理演示数据失败",
        description: error instanceof Error ? error.message : "整理演示数据失败"
      });
    } finally {
      setSeedingDemo(false);
    }
  }

  function notifyExport(label: string) {
    pushToast({
      tone: "info",
      title: "开始导出",
      description: `${label} 正在下载，请留意浏览器下载栏。`,
      durationMs: 2600
    });
  }

  return (
    <div className="space-y-5">
      <section className="ui-card p-5 shadow-soft">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-3">
            <span className="grid size-11 shrink-0 place-items-center rounded-lg bg-cyan/10 text-brand">
              <Server size={22} />
            </span>
            <div>
              <h1 className="text-xl font-semibold text-ink">生产部署检查</h1>
              <p className="mt-1 text-sm text-slate-500">
                上线前检查运行环境、数据库、模型、试运行指标和备份运维准备情况。
              </p>
            </div>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <button
              type="button"
              onClick={() => void seedDemoData()}
              disabled={seedingDemo}
              className="ui-button-warning h-10"
            >
              {seedingDemo ? <Loader2 className="animate-spin" size={16} /> : <FolderPlus size={16} />}
              整理演示数据
            </button>
            <button
              type="button"
              onClick={() => void testModel()}
              disabled={testingModel}
              className="ui-button-secondary h-10"
            >
              {testingModel ? <Loader2 className="animate-spin" size={16} /> : <Bot size={16} />}
              测试模型
            </button>
            <button
              type="button"
              onClick={() => void testTts()}
              disabled={testingTts}
              className="ui-button-secondary h-10"
            >
              {testingTts ? <Loader2 className="animate-spin" size={16} /> : <Volume2 size={16} />}
              测试语音
            </button>
            <a
              href="/api/admin/deploy-readiness/export"
              onClick={() => notifyExport("上线报告")}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-mint px-4 text-sm font-semibold text-white hover:bg-teal-800"
            >
              <Download size={16} />
              上线报告
            </a>
            <a
              href="/api/admin/deploy-readiness/export?format=csv"
              onClick={() => notifyExport("指标 CSV")}
              className="ui-button-secondary h-10"
            >
              <Download size={16} />
              指标 CSV
            </a>
            <a
              href="/api/admin/deploy-readiness/guide"
              onClick={() => notifyExport("运维手册")}
              className="ui-button-primary h-10"
            >
              <Download size={16} />
              运维手册
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
        </div>
      </section>

      {loading && !readiness && <DeployReadinessSkeleton />}

      {!loading && loadError && !readiness && (
        <ErrorRetry
          title="生产部署检查加载失败"
          message={loadError}
          retrying={loading}
          onRetry={() => void loadReadiness()}
        />
      )}

      {readiness && (
        <>
          {(modelTest || ttsTest) && (
            <section className="grid gap-3 lg:grid-cols-2">
              {modelTest && (
                <TestResultCard
                  title="对话模型连通"
                  ok={modelTest.ok}
                  detail={modelTest.ok
                    ? `${modelTest.modelLabel ?? modelTest.model} · ${modelTest.latency_ms}ms · ${modelTest.answer ?? "已返回"}`
                    : modelTest.error ?? "模型测试失败"}
                />
              )}
              {ttsTest && (
                <TestResultCard
                  title="语音服务连通"
                  ok={ttsTest.ok}
                  detail={ttsTest.ok
                    ? `${ttsTest.content_type ?? "audio"} · ${ttsTest.bytes} bytes · ${ttsTest.latency_ms}ms`
                    : ttsTest.error ?? "语音测试失败"}
                />
              )}
            </section>
          )}

          <section className="grid gap-3 md:grid-cols-5">
            <Metric label="部署得分" value={`${readiness.summary.score}%`} highlight />
            <Metric label="已就绪" value={readiness.summary.ready} />
            <Metric label="待确认" value={readiness.summary.warning} />
            <Metric label="需处理" value={readiness.summary.error} />
            <Metric label="检查项" value={readiness.summary.total} />
          </section>

          <section className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
            <RuntimeMetric label="运行模式" value={readiness.runtime.nodeEnv} />
            <RuntimeMetric label="访问地址" value={readiness.runtime.appBaseUrl} />
            <RuntimeMetric label="数据库" value={readiness.runtime.databaseProvider} />
            <RuntimeMetric label="RAG" value={readiness.runtime.ragProvider} />
            <RuntimeMetric label="对话模型" value={readiness.runtime.chatProvider} />
            <RuntimeMetric label="会话密钥" value={readiness.runtime.hasAuthSecret ? "已配置" : "未配置"} />
          </section>

          <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
            <LaunchMetric label="知识库" value={readiness.launchMetrics.knowledgeBases} detail={`${readiness.launchMetrics.readyDocuments} 份可用资料`} />
            <LaunchMetric label="知识片段" value={readiness.launchMetrics.chunks} detail={`${readiness.launchMetrics.parserTypes} 类解析来源`} />
            <LaunchMetric label="QA 通过率" value={`${readiness.launchMetrics.qaPassRate}%`} detail={`已运行 ${readiness.launchMetrics.qaRun}/${readiness.launchMetrics.qaTests}`} />
            <LaunchMetric label="待整改" value={readiness.launchMetrics.openKnowledgeTasks} detail={`待反馈 ${readiness.launchMetrics.openFeedback}`} />
            <LaunchMetric label="工单/安全" value={readiness.launchMetrics.openServiceTickets} detail={`超时 ${readiness.launchMetrics.overdueServiceTickets} / 安全 ${readiness.launchMetrics.openSecurityEvents}`} />
            <LaunchMetric label="培训课程" value={readiness.launchMetrics.readyTrainingJobs} detail={`${readiness.launchMetrics.completedTrainingLearners}/${readiness.launchMetrics.trainingLearners} 完课`} />
          </section>

          <IntegrationChecklist items={readiness.integrationChecklist} />

          <section className="ui-card p-5">
            <div className="flex items-center gap-2">
              <Database size={18} className="text-brand" />
              <h2 className="text-base font-semibold text-ink">资料解析覆盖</h2>
            </div>
            {readiness.parserCoverage.length > 0 ? (
              <div className="mt-4 flex flex-wrap gap-2">
                {readiness.parserCoverage.map((item) => (
                  <span
                    key={item.parser}
                    className="inline-flex items-center gap-2 rounded-full bg-slate-50 px-3 py-1.5 text-sm text-slate-700 ring-1 ring-line"
                  >
                    <span className="font-medium">{item.label}</span>
                    <span className="text-xs text-slate-500">{item.chunks} 片段</span>
                  </span>
                ))}
              </div>
            ) : (
              <EmptyState text="暂无资料解析统计。上传并解析资料后会在这里展示 PDF、PPT、OCR 等来源覆盖。" />
            )}
          </section>

          <section className="grid min-w-0 gap-5 xl:grid-cols-[320px_minmax(0,1fr)]">
            <aside className="min-w-0 space-y-5">
              <section className="ui-card min-w-0 p-5">
                <div className="flex items-center gap-2">
                  <ClipboardCheck size={18} className="text-brand" />
                  <h2 className="text-base font-semibold text-ink">上线顺序</h2>
                </div>
                <ol className="mt-4 space-y-3 break-words text-sm leading-6 text-slate-600">
                  <li>1. 在服务器配置 `.env.local`。</li>
                  <li>2. 执行 `npm install`、`npm run build`。</li>
                  <li>3. 使用 `npm run start` 或 PM2 启动。</li>
                  <li>4. 打开本页确认无红色检查项。</li>
                  <li>5. 打开“试运行验收”导出报告留档。</li>
                  <li>6. 配置 MySQL 定时备份。</li>
                </ol>
              </section>

              <section className="ui-card min-w-0 p-5">
                <div className="flex items-center gap-2">
                  <Settings size={18} className="text-brand" />
                  <h2 className="text-base font-semibold text-ink">快捷入口</h2>
                </div>
                <div className="mt-4 grid gap-2">
                  <QuickLink href="/admin/settings" label="系统配置" />
                  <QuickLink href="/admin/documents" label="知识管理" />
                  <QuickLink href="/admin/qa-tests" label="问答测试" />
                  <QuickLink href="/admin/pilot" label="试运行验收" />
                </div>
              </section>
            </aside>

            <section className="min-w-0 space-y-5">
              {(Object.keys(groupedChecks) as Array<DeployCheck["group"]>).map((group) => (
                <CheckGroup key={group} title={groupLabel[group]} checks={groupedChecks[group]} />
              ))}
            </section>
          </section>
        </>
      )}
    </div>
  );
}

function IntegrationChecklist({ items }: { items: DeployIntegrationCheck[] }) {
  return (
    <section className="ui-card min-w-0 p-5">
      <div className="flex items-center gap-2">
        <ClipboardCheck size={18} className="text-brand" />
        <h2 className="text-base font-semibold text-ink">第三方联调清单</h2>
      </div>
      {items.length > 0 ? (
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          {items.map((item) => (
            <IntegrationChecklistCard key={item.id} item={item} />
          ))}
        </div>
      ) : (
        <EmptyState text="暂无第三方联调检查项。后续配置数字人、SSO、OCR 或 TTS 后会自动汇总。" />
      )}
    </section>
  );
}

function IntegrationChecklistCard({
  item
}: {
  item: DeployIntegrationCheck;
}) {
  return (
    <article className="min-w-0 rounded-lg border border-line p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-ink">{item.name}</h3>
          <span className={`mt-2 inline-flex rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${statusClass[item.status]}`}>
            {statusLabel[item.status]}
          </span>
        </div>
        <span className="shrink-0">{statusIcon(item.status)}</span>
      </div>
      <p className="mt-3 break-words text-xs leading-5 text-slate-500">{item.detail}</p>
      <p className="mt-2 break-words text-sm leading-6 text-slate-600">{item.acceptance}</p>
      <Link
        href={item.action.href}
        className="mt-3 inline-flex h-8 items-center justify-center rounded-lg border border-line px-3 text-xs font-medium text-slate-700 hover:bg-slate-50"
      >
        {item.action.label}
      </Link>
    </article>
  );
}

function Metric({ label, value, highlight = false }: { label: string; value: string | number; highlight?: boolean }) {
  return (
    <div className={`rounded-lg border p-4 ${highlight ? "border-cyan/30 bg-cyan/10" : "border-line bg-white"}`}>
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className={`mt-2 text-2xl font-semibold ${highlight ? "text-brand" : "text-ink"}`}>{value}</p>
    </div>
  );
}

function LaunchMetric({
  label,
  value,
  detail
}: {
  label: string;
  value: string | number;
  detail: string;
}) {
  return (
    <div className="ui-card p-4">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-ink">{value}</p>
      <p className="mt-1 text-xs text-slate-500">{detail}</p>
    </div>
  );
}

function TestResultCard({
  title,
  ok,
  detail
}: {
  title: string;
  ok: boolean;
  detail: string;
}) {
  return (
    <section className={`rounded-lg border p-4 ${
      ok ? "border-emerald-200 bg-emerald-50" : "border-red-200 bg-red-50"
    }`}>
      <div className={`flex items-center gap-2 text-sm font-semibold ${
        ok ? "text-emerald-700" : "text-red-700"
      }`}>
        {ok ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
        {title}
      </div>
      <p className="mt-2 text-sm leading-6 text-slate-700">{detail}</p>
    </section>
  );
}

function RuntimeMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="ui-card p-4">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className="mt-2 truncate text-sm font-semibold text-ink" title={value}>{value}</p>
    </div>
  );
}

function QuickLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="inline-flex h-10 items-center justify-between rounded-lg border border-line px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
    >
      {label}
      <span className="text-slate-400">→</span>
    </Link>
  );
}

function CheckGroup({ title, checks }: { title: string; checks: DeployCheck[] }) {
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
        <EmptyState text="暂无检查项。该分组暂无需要处理的部署检查。" />
      )}
    </section>
  );
}

function CheckCard({ check }: { check: DeployCheck }) {
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

function statusIcon(status: DeployCheckStatus) {
  if (status === "ready") {
    return <CheckCircle2 size={18} className="text-emerald-600" />;
  }

  if (status === "error") {
    return <XCircle size={18} className="text-red-600" />;
  }

  return <AlertTriangle size={18} className="text-amber-600" />;
}

function EmptyState({ text }: { text: string }) {
  return (
    <p className="mt-4 rounded-lg border border-dashed border-line px-3 py-4 text-sm leading-6 text-slate-500">
      {text}
    </p>
  );
}

function DeployReadinessSkeleton() {
  return (
    <div className="space-y-5" aria-label="正在加载生产部署检查">
      <section className="grid gap-3 md:grid-cols-5">
        {Array.from({ length: 5 }).map((_, index) => (
          <PanelSkeleton key={index} rows={1} className="shadow-none" />
        ))}
      </section>
      <section className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, index) => (
          <PanelSkeleton key={index} rows={1} className="shadow-none" />
        ))}
      </section>
      <section className="grid min-w-0 gap-5 xl:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="space-y-5">
          <PanelSkeleton rows={4} />
          <PanelSkeleton rows={3} />
        </aside>
        <section className="space-y-5">
          <PanelSkeleton rows={4} />
          <PanelSkeleton rows={4} />
          <PanelSkeleton rows={4} />
        </section>
      </section>
    </div>
  );
}
