"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, BarChart3, CalendarClock, CheckCircle2, ChevronDown, ClipboardCheck, FilePlus2, GitCompareArrows, ListTodo, Loader2, Pause, Play, RefreshCw, Save, Upload, XCircle } from "lucide-react";
import { ErrorRetry, PanelSkeleton, useToast } from "@/components/ui-feedback";
import type { QaRemediationRetestTrend, QaRemediationTaskSummary } from "@/lib/knowledge-task-summary";
import type { Citation, CitationDominantMatchSignal, CitationMatchSignalKey, KnowledgeBase, QaTestCase, QaTestStatus } from "@/lib/types";

const statusLabel: Record<QaTestStatus, string> = {
  untested: "待评审",
  passed: "通过",
  failed: "不通过"
};

const remediationStatusLabel: Record<QaRemediationTaskSummary["status"], string> = {
  pending: "待处理",
  processing: "处理中",
  resolved: "已通过",
  ignored: "已忽略"
};

type QaFilter = "all" | QaTestStatus | "no_citation" | "low_coverage" | "knowledge_miss";
type BatchRunMode = "unanswered" | "failed" | "no_citation" | "low_coverage" | "knowledge_miss" | "risky";
type QaAdminView = "tests" | "quality" | "automation" | "create";

const batchRunLabel: Record<BatchRunMode, string> = {
  unanswered: "未运行",
  failed: "不通过",
  no_citation: "无引用",
  low_coverage: "低覆盖",
  knowledge_miss: "未命中",
  risky: "风险问题"
};

type BatchProgress = {
  mode: "queued" | "running" | "stopped" | "done" | "failed";
  runMode: BatchRunMode;
  label: string;
  total: number;
  completed: number;
  ready: number;
  autoFailed: number;
  failed: number;
  currentQuestion: string;
  errors: string[];
};

type QaBatchJob = {
  id: string;
  mode: BatchRunMode;
  status: "queued" | "running" | "completed" | "failed" | "canceled";
  total: number;
  completed: number;
  ready: number;
  auto_failed: number;
  failed: number;
  current_question: string | null;
  errors: string[];
};

type KnowledgeTaskRetestBatchJob = {
  id: string;
  mode: "open" | "pending" | "processing" | "all";
  status: "queued" | "running" | "completed" | "failed" | "canceled";
  total: number;
  completed: number;
  resolved: number;
  processing: number;
  ignored: number;
  failed: number;
  current_question: string | null;
  errors: string[];
};

type KnowledgeTaskRetestSchedule = {
  enabled: boolean;
  mode: KnowledgeTaskRetestBatchJob["mode"];
  limit: number;
  interval_minutes: number;
  next_run_at: string | null;
  last_run_at: string | null;
  last_job_id: string | null;
  last_job_status: KnowledgeTaskRetestBatchJob["status"] | "expired" | null;
  last_error: string | null;
  run_count: number;
  updated_at: string;
};

type KnowledgeTaskRetestScheduleInput = Partial<Pick<KnowledgeTaskRetestSchedule, "enabled" | "mode" | "limit" | "interval_minutes">>;

type QaStrategyAnomalySchedule = {
  enabled: boolean;
  interval_minutes: number;
  window_days: number;
  limit: number;
  next_run_at: string | null;
  last_run_at: string | null;
  last_error: string | null;
  last_result: QaStrategyAnomalyRunResult | null;
  run_count: number;
  updated_by: string | null;
  updated_at: string;
};

type QaStrategyAnomalyRunResult = {
  trigger: "manual" | "schedule";
  event_count: number;
  qa_sample_count: number;
  candidate_count: number;
  created_count: number;
  skipped_count: number;
  candidate_test_ids: string[];
  created_task_ids: string[];
  skipped_test_ids: string[];
  window_days: number;
  limit: number;
  started_at: string;
  finished_at: string;
};

type QaStrategyAnomalyScheduleInput = Partial<Pick<QaStrategyAnomalySchedule, "enabled" | "interval_minutes" | "window_days" | "limit">>;

type RemediationRetestProgress = {
  mode: "queued" | "running" | "stopped" | "done" | "failed";
  label: string;
  total: number;
  completed: number;
  resolved: number;
  processing: number;
  ignored: number;
  failed: number;
  currentQuestion: string;
  errors: string[];
};

type QaSupplementInput = {
  knowledge_base_id: string;
  title: string;
  content: string;
};

type QaUsageByTest = Record<string, {
  run_count: number;
  last_input_tokens: number;
  last_output_tokens: number;
  last_total_tokens: number;
  last_cost_usd: number | null;
  last_estimated: boolean;
  last_model: string | null;
  last_provider: string | null;
  last_created_at: string | null;
  total_tokens: number;
  total_cost_usd: number | null;
}>;

type QaUsageSummary = {
  event_count: number;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  estimated_count: number;
  cost_usd: number | null;
};

type QaStrategyTrend = {
  generated_at: string;
  event_count: number;
  window: {
    days: QaStrategyTrendWindowDays;
    label: string;
    start_at: string | null;
    end_at: string | null;
    total_event_count: number;
    event_count: number;
  };
  current_strategy_id: string;
  current_strategy_label: string;
  strategy_count: number;
  anomaly_count: number;
  strategies: QaStrategyTrendRow[];
  rows: QaStrategyTrendRow[];
  by_knowledge_base: QaStrategyTrendBreakdownRow[];
  by_intent: QaStrategyTrendBreakdownRow[];
  by_department: QaStrategyTrendBreakdownRow[];
  by_position: QaStrategyTrendBreakdownRow[];
  anomalies: QaStrategyTrendAnomaly[];
  comparison: QaStrategyTrendComparison;
  latest: QaStrategyTrendRun[];
};

type QaStrategyTrendWindowDays = 0 | 7 | 30 | 90;

type QaStrategyTrendRow = {
  date: string | null;
  dimension_id: string | null;
  dimension_label: string | null;
  strategy_id: string;
  strategy_label: string;
  run_count: number;
  pass_count: number;
  failed_count: number;
  pass_rate: number;
  no_citation_count: number;
  no_citation_rate: number;
  average_citations: number;
  average_coverage: number | null;
  average_latency_ms: number | null;
  total_tokens: number;
  cost_usd: number | null;
  last_run_at: string | null;
  candidate_test_ids: string[];
};

type QaStrategyTrendBreakdownRow = QaStrategyTrendRow & {
  dimension_id: string;
  dimension_label: string;
  risk_score: number;
};

type QaStrategyTrendAnomaly = {
  level: "warning" | "critical";
  title: string;
  description: string;
  metric: string;
  action_hint: string;
  suggested_test_ids: string[];
};

type QaStrategyTrendComparison = {
  mode: "switch_detected" | "no_current_samples" | "no_previous_strategy";
  cutover_at: string | null;
  before: QaStrategyTrendRow | null;
  after: QaStrategyTrendRow | null;
  deltas: {
    run_count: number;
    pass_rate: number;
    no_citation_rate: number;
    average_coverage: number | null;
    average_latency_ms: number | null;
    average_citations: number;
    total_tokens: number;
  } | null;
  notes: string[];
};

type QaStrategyTrendRun = {
  id: string;
  test_id: string | null;
  question: string;
  strategy_id: string;
  strategy_label: string;
  status: QaTestStatus;
  citation_count: number | null;
  coverage: number | null;
  latency_ms: number | null;
  total_tokens: number;
  created_at: string;
};

type QaRemediationByTest = Record<string, QaRemediationTaskSummary>;

type RetrievalStrategyReport = {
  generated_at: string;
  sample_count: number;
  document_count: number;
  chunk_count: number;
  baseline_strategy_id: string;
  best_strategy_id: string;
  strategies: RetrievalStrategyRow[];
  comparison_rows: RetrievalStrategyComparisonRow[];
  notes: string[];
};

type RetrievalStrategyRow = {
  strategy_id: string;
  strategy_label: string;
  description: string;
  sample_count: number;
  hit_count: number;
  hit_rate: number;
  evidence_count: number;
  evidence_rate: number;
  pass_count: number;
  pass_rate: number;
  no_hit_count: number;
  low_coverage_count: number;
  false_positive_risk_count: number;
  average_coverage: number;
  average_top_score: number;
  dominant_signals: Array<{
    signal: string;
    label: string;
    count: number;
  }>;
};

type RetrievalStrategyComparisonRow = {
  test_id: string;
  question: string;
  knowledge_bases: string;
  expected_term_count: number;
  baseline_coverage: number;
  best_strategy_id: string;
  best_strategy_label: string;
  best_coverage: number;
  delta: number;
  top_source: string | null;
  top_score: number | null;
  missing_terms: string[];
};

type GovernanceImpactReport = {
  generated_at: string;
  mode: "pending_suggestion_preview" | "current_governance_effect";
  mode_label: string;
  strategy_id: string;
  sample_count: number;
  document_count: number;
  chunk_count: number;
  pending_suggestion_count: number;
  governed_chunk_count: number;
  before: GovernanceImpactSummary;
  after: GovernanceImpactSummary;
  delta: GovernanceImpactDelta;
  comparison_rows: GovernanceImpactComparisonRow[];
  notes: string[];
};

type GovernanceImpactSummary = {
  sample_count: number;
  hit_count: number;
  hit_rate: number;
  evidence_count: number;
  evidence_rate: number;
  pass_count: number;
  pass_rate: number;
  no_hit_count: number;
  low_coverage_count: number;
  false_positive_risk_count: number;
  average_coverage: number;
  average_top_score: number;
};

type GovernanceImpactDelta = {
  pass_rate: number;
  average_coverage: number;
  false_positive_risk_count: number;
  newly_passed_count: number;
  newly_risky_count: number;
  improved_count: number;
  regressed_count: number;
};

type GovernanceImpactComparisonRow = {
  test_id: string;
  question: string;
  knowledge_bases: string;
  expected_term_count: number;
  before_coverage: number;
  after_coverage: number;
  delta: number;
  before_top_source: string | null;
  after_top_source: string | null;
  before_top_score: number | null;
  after_top_score: number | null;
  before_false_positive_risk: boolean;
  after_false_positive_risk: boolean;
  risk_delta: number;
  source_changed: boolean;
  missing_terms: string[];
};

type GovernanceRecommendationReport = {
  generated_at: string;
  read_only: boolean;
  sample_count: number;
  document_count: number;
  chunk_count: number;
  recommendation_count: number;
  high_priority_count: number;
  strategy_summary: {
    baseline_strategy_id: string;
    best_strategy_id: string;
    strategies: GovernanceRecommendationStrategyRow[];
  };
  type_counts: Record<GovernanceRecommendationType, number>;
  priority_counts: Record<GovernanceRecommendationPriority, number>;
  recommendations: GovernanceRecommendation[];
  notes: string[];
};

type GovernanceRecommendationType =
  | "supplement_knowledge"
  | "improve_chunk_governance"
  | "adjust_retrieval_strategy"
  | "review_false_positive";

type GovernanceRecommendationPriority = "high" | "medium" | "low";

type GovernanceRecommendationStrategyRow = {
  strategy_id: string;
  strategy_label: string;
  sample_count: number;
  hit_rate: number;
  pass_rate: number;
  average_coverage: number;
  average_top_score: number;
};

type GovernanceRecommendation = {
  id: string;
  type: GovernanceRecommendationType;
  type_label: string;
  priority: GovernanceRecommendationPriority;
  title: string;
  description: string;
  reason: string;
  action_label: string;
  action_filter: QaFilter | null;
  action_href: string | null;
  test_id: string | null;
  question: string | null;
  knowledge_bases: string | null;
  target_document_id: string | null;
  target_chunk_id: string | null;
  target_source: string | null;
  current_coverage: number | null;
  expected_coverage: number | null;
  missing_terms: string[];
  affected_count: number;
  impact_score: number;
};

type MatchSignalBucketKey = "content" | "summary" | "keywords" | "synonyms" | "metadata" | "semantic";

type MatchSignalBucketDefinition = {
  key: MatchSignalBucketKey;
  label: string;
  signalKeys: CitationMatchSignalKey[];
};

type MatchSignalBadge = {
  key: MatchSignalBucketKey;
  label: string;
  score: number;
  percent: number;
};

const matchSignalBucketDefinitions: MatchSignalBucketDefinition[] = [
  { key: "content", label: "正文", signalKeys: ["content"] },
  { key: "summary", label: "摘要", signalKeys: ["summary"] },
  { key: "keywords", label: "关键词", signalKeys: ["keywords"] },
  { key: "synonyms", label: "同义词", signalKeys: ["synonyms"] },
  { key: "metadata", label: "元数据", signalKeys: ["title", "file_name", "section", "sheet", "structural", "recency"] },
  { key: "semantic", label: "语义", signalKeys: ["semantic", "proximity"] }
];

const dominantMatchSignalLabels: Record<CitationDominantMatchSignal, string> = {
  content: "正文",
  summary: "摘要",
  keywords: "关键词",
  synonyms: "同义词",
  metadata: "元数据",
  semantic: "语义",
  mixed: "混合"
};

export function QaTestAdmin() {
  const [tests, setTests] = useState<QaTestCase[]>([]);
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBase[]>([]);
  const [qaUsageByTestId, setQaUsageByTestId] = useState<QaUsageByTest>({});
  const [qaUsageSummary, setQaUsageSummary] = useState<QaUsageSummary | null>(null);
  const [strategyTrend, setStrategyTrend] = useState<QaStrategyTrend | null>(null);
  const [strategyTrendWindowDays, setStrategyTrendWindowDays] = useState<QaStrategyTrendWindowDays>(0);
  const [remediationByTestId, setRemediationByTestId] = useState<QaRemediationByTest>({});
  const [remediationTasksStatus, setRemediationTasksStatus] = useState<"ready" | "timeout">("ready");
  const [remediationRetestTrend, setRemediationRetestTrend] = useState<QaRemediationRetestTrend | null>(null);
  const [retrievalStrategyReport, setRetrievalStrategyReport] = useState<RetrievalStrategyReport | null>(null);
  const [governanceImpactReport, setGovernanceImpactReport] = useState<GovernanceImpactReport | null>(null);
  const [governanceRecommendationReport, setGovernanceRecommendationReport] = useState<GovernanceRecommendationReport | null>(null);
  const [question, setQuestion] = useState("");
  const [expectedAnswer, setExpectedAnswer] = useState("");
  const [bulkContent, setBulkContent] = useState("");
  const [filter, setFilter] = useState<QaFilter>("all");
  const [activeView, setActiveView] = useState<QaAdminView>("tests");
  const [showAllTests, setShowAllTests] = useState(false);
  const [selectedKbIds, setSelectedKbIds] = useState<string[]>([]);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [generatingTemplate, setGeneratingTemplate] = useState(false);
  const [batchRunning, setBatchRunning] = useState(false);
  const [remediationRetestRunning, setRemediationRetestRunning] = useState(false);
  const [strategyComparing, setStrategyComparing] = useState(false);
  const [governanceImpactLoading, setGovernanceImpactLoading] = useState(false);
  const [governanceRecommendationLoading, setGovernanceRecommendationLoading] = useState(false);
  const [governanceRecommendationRemediating, setGovernanceRecommendationRemediating] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [batchProgress, setBatchProgress] = useState<BatchProgress | null>(null);
  const [batchJobId, setBatchJobId] = useState<string | null>(null);
  const [remediationRetestProgress, setRemediationRetestProgress] = useState<RemediationRetestProgress | null>(null);
  const [remediationRetestJobId, setRemediationRetestJobId] = useState<string | null>(null);
  const [remediationRetestSchedule, setRemediationRetestSchedule] = useState<KnowledgeTaskRetestSchedule | null>(null);
  const [remediationRetestScheduleLoading, setRemediationRetestScheduleLoading] = useState(true);
  const [remediationRetestScheduleSaving, setRemediationRetestScheduleSaving] = useState(false);
  const [strategyAnomalySchedule, setStrategyAnomalySchedule] = useState<QaStrategyAnomalySchedule | null>(null);
  const [strategyAnomalyScheduleLoading, setStrategyAnomalyScheduleLoading] = useState(true);
  const [strategyAnomalyScheduleSaving, setStrategyAnomalyScheduleSaving] = useState(false);
  const [strategyAnomalyRunning, setStrategyAnomalyRunning] = useState(false);
  const [generatingRemediation, setGeneratingRemediation] = useState(false);
  const [generatingRemediationId, setGeneratingRemediationId] = useState<string | null>(null);
  const [strategyTrendRemediatingKey, setStrategyTrendRemediatingKey] = useState<string | null>(null);
  const [supplementingId, setSupplementingId] = useState<string | null>(null);
  const { pushToast } = useToast();
  const stopBatchRef = useRef(false);
  const batchPollRef = useRef<number | null>(null);
  const remediationRetestPollRef = useRef<number | null>(null);

  useEffect(() => {
    void loadTests({ notifyOnError: false });
    void loadRemediationRetestSchedule({ notifyOnError: false });
    void loadStrategyAnomalySchedule({ notifyOnError: false });

    function handleGovernanceLinksCopied(event: Event) {
      const detail = (event as CustomEvent<{ count?: number; error?: string }>).detail;
      if (detail?.error) {
        pushWarning("治理清单复制失败", detail.error);
        return;
      }

      pushSuccess("治理清单已复制", `已复制 ${detail?.count ?? 0} 个分片治理链接。`);
    }

    window.addEventListener("qa-governance-links-copied", handleGovernanceLinksCopied);

    return () => {
      window.removeEventListener("qa-governance-links-copied", handleGovernanceLinksCopied);
      clearBatchPoll();
      clearRemediationRetestPoll();
    };
  }, [pushToast]);

  const stats = useMemo(() => {
    const passed = tests.filter((item) => item.status === "passed").length;
    const failed = tests.filter((item) => item.status === "failed").length;
    const withAnswer = tests.filter((item) => item.answer).length;
    const noCitation = tests.filter((item) => item.answer && getCitationCount(item) === 0).length;
    const unanswered = tests.filter((item) => !item.answer).length;
    const lowCoverage = tests.filter((item) =>
      Boolean(item.answer && item.expected_answer && expectedCoverage(item.answer ?? "", item.expected_answer ?? "").coverage < 60)
    ).length;
    const knowledgeMiss = tests.filter((item) => item.answer?.includes("未在知识库中找到明确依据")).length;
    const coverageSamples = tests
      .filter((item) => item.answer && item.expected_answer)
      .map((item) => expectedCoverage(item.answer ?? "", item.expected_answer ?? "").coverage);
    const qualitySamples = tests
      .filter((item) => item.answer)
      .map((item) => qaDiagnostics(item).qualityScore);
    const riskyTests = tests
      .filter((item) => qaDiagnostics(item).risk !== "low")
      .slice(0, 5);
    const latencySamples = tests
      .map((item) => item.latency_ms)
      .filter((value): value is number => typeof value === "number");
    return {
      total: tests.length,
      withAnswer,
      unanswered,
      passed,
      failed,
      passRate: withAnswer > 0 ? Math.round((passed / withAnswer) * 100) : 0,
      noCitation,
      noCitationRate: withAnswer > 0 ? Math.round((noCitation / withAnswer) * 100) : 0,
      lowCoverage,
      knowledgeMiss,
      riskyCount: tests.filter((item) => qaDiagnostics(item).risk !== "low").length,
      averageCoverage: coverageSamples.length > 0
        ? Math.round(coverageSamples.reduce((total, value) => total + value, 0) / coverageSamples.length)
        : 0,
      averageQuality: qualitySamples.length > 0
        ? Math.round(qualitySamples.reduce((total, value) => total + value, 0) / qualitySamples.length)
        : 0,
      averageLatency: latencySamples.length > 0
        ? Math.round(latencySamples.reduce((total, value) => total + value, 0) / latencySamples.length)
        : 0,
      slowest: [...tests]
        .filter((item) => typeof item.latency_ms === "number")
        .sort((a, b) => (b.latency_ms ?? 0) - (a.latency_ms ?? 0))
        .slice(0, 5),
      failedTests: tests.filter((item) => item.status === "failed").slice(0, 5),
      riskyTests
    };
  }, [tests]);
  const retrievalOverview = useMemo(
    () => buildRetrievalEvaluation(tests, knowledgeBases),
    [knowledgeBases, tests]
  );
  const failureTraceOverview = useMemo(
    () => buildFailureTraceOverview(tests, knowledgeBases),
    [knowledgeBases, tests]
  );
  const remediationLoopStats = useMemo(
    () => buildRemediationLoopStats(remediationByTestId),
    [remediationByTestId]
  );

  const filteredTests = useMemo(() => {
    if (filter === "all") {
      return tests;
    }

    if (filter === "no_citation") {
      return tests.filter((item) => item.answer && getCitationCount(item) === 0);
    }

    if (filter === "low_coverage") {
      return tests.filter((item) =>
        Boolean(item.answer && item.expected_answer && expectedCoverage(item.answer ?? "", item.expected_answer ?? "").coverage < 60)
      );
    }

    if (filter === "knowledge_miss") {
      return tests.filter((item) => item.answer?.includes("未在知识库中找到明确依据"));
    }

    return tests.filter((item) => item.status === filter);
  }, [filter, tests]);
  const visibleTests = showAllTests ? filteredTests : filteredTests.slice(0, 8);

  function showTestsByFilter(nextFilter: QaFilter) {
    setFilter(nextFilter);
    setShowAllTests(false);
    setActiveView("tests");
  }

  async function loadTests(options: { notifyOnError?: boolean; strategyWindowDays?: QaStrategyTrendWindowDays } = {}, attempt = 0) {
    setLoading(true);

    try {
      const strategyWindowDays = options.strategyWindowDays ?? strategyTrendWindowDays;
      const query = strategyWindowDays > 0 ? `?strategy_window_days=${strategyWindowDays}` : "";
      const response = await fetch(`/api/admin/qa-tests${query}`, { cache: "no-store" });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "读取问答测试失败");
      }

      setTests(data.tests ?? []);
      setKnowledgeBases(data.knowledgeBases ?? []);
      setQaUsageByTestId(data.qaUsageByTestId ?? {});
      setQaUsageSummary(data.qaUsageSummary ?? null);
      setStrategyTrend(data.strategyTrend ?? null);
      setRemediationByTestId(data.remediationByTestId ?? {});
      setRemediationRetestTrend(data.remediationRetestTrend ?? null);
      setRemediationTasksStatus(data.remediationTasksStatus === "timeout" ? "timeout" : "ready");
      setLoadError(null);
      if (selectedKbIds.length === 0 && data.knowledgeBases?.[0]) {
        setSelectedKbIds([data.knowledgeBases[0].id]);
      }
    } catch (error) {
      const message = errorMessage(error, "读取问答测试失败");

      if (attempt === 0 && isTransientQaLoadError(message)) {
        await wait(1400);
        return loadTests(options, attempt + 1);
      }

      setLoadError(message);
      if (options.notifyOnError ?? true) {
        pushActionError(error, "读取问答测试失败");
      }
    } finally {
      setLoading(false);
    }
  }

  async function changeStrategyTrendWindow(days: QaStrategyTrendWindowDays) {
    setStrategyTrendWindowDays(days);
    await loadTests({ strategyWindowDays: days, notifyOnError: true });
  }

  async function loadRemediationRetestSchedule(options: { notifyOnError?: boolean } = {}) {
    setRemediationRetestScheduleLoading(true);

    try {
      const response = await fetch("/api/admin/knowledge-tasks/retest-schedule", { cache: "no-store" });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "读取整改复测计划失败");
      }

      setRemediationRetestSchedule(data.schedule ?? null);
    } catch (error) {
      if (options.notifyOnError ?? true) {
        pushActionError(error, "读取整改复测计划失败");
      }
    } finally {
      setRemediationRetestScheduleLoading(false);
    }
  }

  async function updateRemediationRetestSchedule(input: KnowledgeTaskRetestScheduleInput) {
    setRemediationRetestScheduleSaving(true);

    try {
      const response = await fetch("/api/admin/knowledge-tasks/retest-schedule", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input)
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "保存整改复测计划失败");
      }

      setRemediationRetestSchedule(data.schedule ?? null);
      pushSuccess(data.schedule?.enabled ? "自动复测计划已更新" : "自动复测计划已暂停");
    } catch (error) {
      pushActionError(error, "保存整改复测计划失败");
    } finally {
      setRemediationRetestScheduleSaving(false);
    }
  }

  async function loadStrategyAnomalySchedule(options: { notifyOnError?: boolean } = {}) {
    setStrategyAnomalyScheduleLoading(true);

    try {
      const response = await fetch("/api/admin/qa-tests/strategy-anomaly-schedule", { cache: "no-store" });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "读取策略异常巡检计划失败");
      }

      setStrategyAnomalySchedule(data.schedule ?? null);
    } catch (error) {
      if (options.notifyOnError ?? true) {
        pushActionError(error, "读取策略异常巡检计划失败");
      }
    } finally {
      setStrategyAnomalyScheduleLoading(false);
    }
  }

  async function updateStrategyAnomalySchedule(input: QaStrategyAnomalyScheduleInput) {
    setStrategyAnomalyScheduleSaving(true);

    try {
      const response = await fetch("/api/admin/qa-tests/strategy-anomaly-schedule", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input)
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "保存策略异常巡检计划失败");
      }

      setStrategyAnomalySchedule(data.schedule ?? null);
      pushSuccess(data.schedule?.enabled ? "策略异常巡检已更新" : "策略异常巡检已暂停");
    } catch (error) {
      pushActionError(error, "保存策略异常巡检计划失败");
    } finally {
      setStrategyAnomalyScheduleSaving(false);
    }
  }

  async function runStrategyAnomalyScheduleNow() {
    setStrategyAnomalyRunning(true);

    try {
      const response = await fetch("/api/admin/qa-tests/strategy-anomaly-schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "run_now" })
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "启动策略异常巡检失败");
      }

      setStrategyAnomalySchedule(data.schedule ?? null);
      await loadTests();
      const result = data.result as QaStrategyAnomalyRunResult | undefined;
      pushSuccess(
        "策略异常巡检完成",
        `发现 ${result?.candidate_count ?? 0} 条可整改 QA，新增 ${result?.created_count ?? 0} 条整改任务，跳过 ${result?.skipped_count ?? 0} 条已有任务。`
      );
    } catch (error) {
      pushActionError(error, "启动策略异常巡检失败");
    } finally {
      setStrategyAnomalyRunning(false);
    }
  }

  function pushSuccess(title: string, description?: string) {
    pushToast({
      tone: "success",
      title,
      description
    });
  }

  function pushWarning(title: string, description?: string) {
    pushToast({
      tone: "warning",
      title,
      description,
      durationMs: 5600
    });
  }

  function pushInfo(title: string, description?: string) {
    pushToast({
      tone: "info",
      title,
      description
    });
  }

  function pushActionError(error: unknown, fallback: string) {
    const message = errorMessage(error, fallback);
    pushToast({
      tone: "error",
      title: fallback,
      description: message === fallback ? undefined : message,
      durationMs: 6800
    });
  }

  function toggleKnowledgeBase(id: string) {
    setSelectedKbIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
    );
  }

  async function createTest() {
    setCreating(true);

    try {
      const response = await fetch("/api/admin/qa-tests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question,
          expected_answer: expectedAnswer,
          knowledge_base_ids: selectedKbIds
        })
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "创建问答测试失败");
      }

      setQuestion("");
      setExpectedAnswer("");
      await loadTests();
      pushSuccess("测试问题已创建");
    } catch (error) {
      pushActionError(error, "创建问答测试失败");
    } finally {
      setCreating(false);
    }
  }

  async function importTests() {
    setImporting(true);

    try {
      const response = await fetch("/api/admin/qa-tests/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: bulkContent,
          knowledge_base_ids: selectedKbIds
        })
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "批量导入失败");
      }

      setBulkContent("");
      await loadTests();
      pushSuccess(
        "批量导入完成",
        `已导入 ${data.count ?? 0} 条测试问题${data.skipped?.length ? `，跳过 ${data.skipped.length} 条` : ""}。`
      );
    } catch (error) {
      pushActionError(error, "批量导入失败");
    } finally {
      setImporting(false);
    }
  }

  async function generateKnowledgeTemplate() {
    setGeneratingTemplate(true);

    try {
      const response = await fetch("/api/admin/qa-tests/generate-template", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: "knowledge",
          knowledge_base_ids: selectedKbIds,
          limit: 20
        })
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "生成测试问题失败");
      }

      await loadTests();
      const skippedText = data.skipped?.length ? `，跳过 ${data.skipped.length} 条已存在问题` : "";
      pushSuccess("测试问题已生成", `已从资料分片生成 ${data.count ?? 0} 条测试问题${skippedText}。`);
    } catch (error) {
      pushActionError(error, "生成测试问题失败");
    } finally {
      setGeneratingTemplate(false);
    }
  }

  async function compareRetrievalStrategies() {
    setStrategyComparing(true);

    try {
      const response = await fetch("/api/admin/qa-tests/retrieval-strategies?limit=60", { cache: "no-store" });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "生成召回策略对比失败");
      }

      setRetrievalStrategyReport(data);
      const best = data.strategies?.find((row: RetrievalStrategyRow) => row.strategy_id === data.best_strategy_id);
      pushSuccess(
        "召回策略对比完成",
        best ? `当前样本最优：${best.strategy_label}，高覆盖 ${best.pass_rate}%，平均覆盖 ${best.average_coverage}%。` : undefined
      );
    } catch (error) {
      pushActionError(error, "生成召回策略对比失败");
    } finally {
      setStrategyComparing(false);
    }
  }

  async function compareGovernanceImpact() {
    setGovernanceImpactLoading(true);

    try {
      const response = await fetch("/api/admin/qa-tests/governance-impact?limit=60", { cache: "no-store" });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "生成治理前后效果对比失败");
      }

      setGovernanceImpactReport(data);
      pushSuccess(
        "治理效果对比完成",
        `高覆盖从 ${data.before?.pass_rate ?? 0}% 到 ${data.after?.pass_rate ?? 0}%，平均覆盖变化 ${formatSignedPercent(data.delta?.average_coverage ?? 0)}。`
      );
    } catch (error) {
      pushActionError(error, "生成治理前后效果对比失败");
    } finally {
      setGovernanceImpactLoading(false);
    }
  }

  async function generateGovernanceRecommendations() {
    setGovernanceRecommendationLoading(true);

    try {
      const response = await fetch("/api/admin/qa-tests/governance-recommendations?limit=60", { cache: "no-store" });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "生成治理动作建议失败");
      }

      setGovernanceRecommendationReport(data);
      pushSuccess(
        "治理动作建议已生成",
        `共 ${data.recommendation_count ?? 0} 条建议，高优先级 ${data.high_priority_count ?? 0} 条。`
      );
    } catch (error) {
      pushActionError(error, "生成治理动作建议失败");
    } finally {
      setGovernanceRecommendationLoading(false);
    }
  }

  function batchCandidates(mode: BatchRunMode) {
    return tests.filter((item) => {
      if (mode === "unanswered") {
        return !item.answer;
      }

      if (mode === "failed") {
        return item.status === "failed";
      }

      if (mode === "no_citation") {
        return Boolean(item.answer && getCitationCount(item) === 0);
      }

      if (mode === "low_coverage") {
        return Boolean(item.answer && item.expected_answer && expectedCoverage(item.answer ?? "", item.expected_answer ?? "").coverage < 60);
      }

      if (mode === "knowledge_miss") {
        return Boolean(item.answer?.includes("未在知识库中找到明确依据"));
      }

      return qaDiagnostics(item).risk !== "low";
    });
  }

  async function runBatch(mode: BatchRunMode = "unanswered") {
    const candidates = batchCandidates(mode);
    const label = batchRunLabel[mode];

    if (candidates.length === 0) {
      pushWarning("没有可运行问题", `当前没有需要运行的${label}测试问题。`);
      return;
    }

    setBatchRunning(true);
    stopBatchRef.current = false;
    setBatchProgress({
      mode: "queued",
      runMode: mode,
      label,
      total: candidates.length,
      completed: 0,
      ready: 0,
      autoFailed: 0,
      failed: 0,
      currentQuestion: "后台任务排队中",
      errors: []
    });

    try {
      const response = await fetch("/api/admin/qa-tests/run-batch-job", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          limit: Math.min(candidates.length, 50)
        })
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "创建批量运行任务失败");
      }

      const job = data.job as QaBatchJob;
      setBatchJobId(job.id);
      setBatchProgress(toBatchProgress(job, mode, label));
      startBatchPolling(job.id, mode, label);
    } catch (error) {
      clearBatchPoll();
      setBatchJobId(null);
      setRunningId(null);
      setBatchRunning(false);
      setBatchProgress((current) => current ? {
        ...current,
        mode: "failed",
        currentQuestion: "批量运行启动失败",
        errors: [error instanceof Error ? error.message : "创建批量运行任务失败"]
      } : current);
      pushActionError(error, "创建批量运行任务失败");
    }
  }

  function stopBatchRun() {
    stopBatchRef.current = true;
    setBatchProgress((current) => current ? {
      ...current,
      currentQuestion: "正在请求停止后台任务"
    } : current);

    if (!batchJobId) {
      setBatchRunning(false);
      setBatchProgress((current) => current ? {
        ...current,
        mode: "stopped"
      } : current);
      return;
    }

    void fetch(`/api/admin/qa-tests/run-batch-job/${batchJobId}`, {
      method: "DELETE"
    }).catch(() => {
      pushWarning("停止请求发送失败", "当前题结束后可刷新查看状态。");
    });
  }

  async function runRemediationRetestBatch() {
    const openCount = remediationLoopStats.pending + remediationLoopStats.processing;

    if (openCount === 0) {
      pushWarning("没有待复测整改", "当前没有待处理或处理中的 QA 整改任务。");
      return;
    }

    setRemediationRetestRunning(true);
    setRemediationRetestProgress({
      mode: "queued",
      label: "待整改复测",
      total: openCount,
      completed: 0,
      resolved: 0,
      processing: 0,
      ignored: 0,
      failed: 0,
      currentQuestion: "后台复测队列排队中",
      errors: []
    });

    try {
      const response = await fetch("/api/admin/knowledge-tasks/retest-batch-job", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "open",
          limit: Math.min(openCount, 50)
        })
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "创建整改复测队列失败");
      }

      const job = data.job as KnowledgeTaskRetestBatchJob;
      setRemediationRetestJobId(job.id);
      setRemediationRetestProgress(toRemediationRetestProgress(job));
      startRemediationRetestPolling(job.id);
    } catch (error) {
      clearRemediationRetestPoll();
      setRemediationRetestJobId(null);
      setRemediationRetestRunning(false);
      setRemediationRetestProgress((current) => current ? {
        ...current,
        mode: "failed",
        currentQuestion: "整改复测队列启动失败",
        errors: [error instanceof Error ? error.message : "创建整改复测队列失败"]
      } : current);
      pushActionError(error, "创建整改复测队列失败");
    }
  }

  async function runScheduledRemediationRetestNow() {
    if (!remediationRetestSchedule) {
      pushWarning("计划状态未就绪", "请稍后再试，或先刷新页面。");
      return;
    }

    setRemediationRetestRunning(true);
    setRemediationRetestProgress({
      mode: "queued",
      label: "计划复测",
      total: Math.min(remediationRetestSchedule.limit, Math.max(remediationLoopStats.pending + remediationLoopStats.processing, 0)),
      completed: 0,
      resolved: 0,
      processing: 0,
      ignored: 0,
      failed: 0,
      currentQuestion: "正在启动计划复测",
      errors: []
    });

    try {
      const response = await fetch("/api/admin/knowledge-tasks/retest-schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "run_now" })
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "启动计划复测失败");
      }

      const job = data.job as KnowledgeTaskRetestBatchJob;
      setRemediationRetestSchedule(data.schedule ?? remediationRetestSchedule);
      setRemediationRetestJobId(job.id);
      setRemediationRetestProgress(toRemediationRetestProgress(job, "计划复测"));
      startRemediationRetestPolling(job.id);
    } catch (error) {
      clearRemediationRetestPoll();
      setRemediationRetestJobId(null);
      setRemediationRetestRunning(false);
      setRemediationRetestProgress((current) => current ? {
        ...current,
        mode: "failed",
        currentQuestion: "计划复测启动失败",
        errors: [error instanceof Error ? error.message : "启动计划复测失败"]
      } : current);
      pushActionError(error, "启动计划复测失败");
    }
  }

  function stopRemediationRetestBatch() {
    setRemediationRetestProgress((current) => current ? {
      ...current,
      currentQuestion: "正在请求停止整改复测队列"
    } : current);

    if (!remediationRetestJobId) {
      setRemediationRetestRunning(false);
      setRemediationRetestProgress((current) => current ? {
        ...current,
        mode: "stopped"
      } : current);
      return;
    }

    void fetch(`/api/admin/knowledge-tasks/retest-batch-job/${remediationRetestJobId}`, {
      method: "DELETE"
    }).catch(() => {
      pushWarning("停止请求发送失败", "当前题结束后可刷新查看状态。");
    });
  }

  function startRemediationRetestPolling(jobId: string) {
    clearRemediationRetestPoll();
    void pollRemediationRetestJob(jobId);
    remediationRetestPollRef.current = window.setInterval(() => {
      void pollRemediationRetestJob(jobId);
    }, 1800);
  }

  async function pollRemediationRetestJob(jobId: string) {
    try {
      const response = await fetch(`/api/admin/knowledge-tasks/retest-batch-job/${jobId}`, { cache: "no-store" });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "获取整改复测队列失败");
      }

      const job = data.job as KnowledgeTaskRetestBatchJob;
      const progress = toRemediationRetestProgress(job);
      setRemediationRetestProgress(progress);

      if (isTerminalRetestBatchJob(job.status)) {
        clearRemediationRetestPoll();
        setRemediationRetestJobId(null);
        setRemediationRetestRunning(false);
        await loadTests();
        await loadRemediationRetestSchedule({ notifyOnError: false });
        pushRemediationRetestToast(job);
      }
    } catch (error) {
      clearRemediationRetestPoll();
      setRemediationRetestJobId(null);
      setRemediationRetestRunning(false);
      setRemediationRetestProgress((current) => current ? {
        ...current,
        mode: "failed",
        currentQuestion: "整改复测状态读取失败",
        errors: [
          ...current.errors,
          error instanceof Error ? error.message : "获取整改复测队列失败"
        ].slice(-5)
      } : current);
      pushActionError(error, "获取整改复测队列失败");
    }
  }

  function startBatchPolling(jobId: string, mode: BatchRunMode, label: string) {
    clearBatchPoll();
    void pollBatchJob(jobId, mode, label);
    batchPollRef.current = window.setInterval(() => {
      void pollBatchJob(jobId, mode, label);
    }, 1800);
  }

  async function pollBatchJob(jobId: string, mode: BatchRunMode, label: string) {
    try {
      const response = await fetch(`/api/admin/qa-tests/run-batch-job/${jobId}`, { cache: "no-store" });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "获取批量运行状态失败");
      }

      const job = data.job as QaBatchJob;
      const progress = toBatchProgress(job, mode, label);
      setBatchProgress(progress);

      if (isTerminalBatchJob(job.status)) {
        clearBatchPoll();
        setBatchJobId(null);
        setRunningId(null);
        setBatchRunning(false);
        await loadTests();
        pushBatchJobToast(job, label);
      }
    } catch (error) {
      clearBatchPoll();
      setBatchJobId(null);
      setRunningId(null);
      setBatchRunning(false);
      setBatchProgress((current) => current ? {
        ...current,
        mode: "failed",
        currentQuestion: "批量运行状态读取失败",
        errors: [
          ...current.errors,
          error instanceof Error ? error.message : "获取批量运行状态失败"
        ].slice(-5)
      } : current);
      pushActionError(error, "获取批量运行状态失败");
    }
  }

  function clearBatchPoll() {
    if (batchPollRef.current !== null) {
      window.clearInterval(batchPollRef.current);
      batchPollRef.current = null;
    }
  }

  function clearRemediationRetestPoll() {
    if (remediationRetestPollRef.current !== null) {
      window.clearInterval(remediationRetestPollRef.current);
      remediationRetestPollRef.current = null;
    }
  }

  function exportCsv() {
    window.location.href = `/api/admin/qa-tests/export?status=${filter}`;
  }

  async function generateRemediationTasks() {
    setGeneratingRemediation(true);

    try {
      const response = await fetch("/api/admin/qa-tests/remediation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit: 50 })
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "生成整改任务失败");
      }

      await loadTests();
      pushSuccess(
        "整改任务已生成",
        `已生成 ${data.count ?? 0} 条整改任务${data.skipped?.length ? `，跳过 ${data.skipped.length} 条已有任务` : ""}。可到“会话反馈”查看处理。`
      );
    } catch (error) {
      pushActionError(error, "生成整改任务失败");
    } finally {
      setGeneratingRemediation(false);
    }
  }

  async function generateRecommendationRemediationTasks() {
    const recommendations = governanceRecommendationReport?.recommendations ?? [];
    const testIds = [
      ...new Set(
        recommendations
          .filter((item) => item.priority === "high" && item.test_id)
          .map((item) => item.test_id as string)
      )
    ];

    if (testIds.length === 0) {
      pushWarning("没有可生成整改的高优先级建议", "当前建议更适合先打开资料治理或调整策略。");
      return;
    }

    setGovernanceRecommendationRemediating(true);

    try {
      const response = await fetch("/api/admin/qa-tests/remediation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          test_ids: testIds,
          limit: testIds.length
        })
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "生成建议整改任务失败");
      }

      await loadTests();
      pushSuccess(
        "高优先级整改已生成",
        `已处理 ${testIds.length} 条建议，新增 ${data.count ?? 0} 条整改任务${data.skipped?.length ? `，跳过 ${data.skipped.length} 条已有任务` : ""}。`
      );
    } catch (error) {
      pushActionError(error, "生成建议整改任务失败");
    } finally {
      setGovernanceRecommendationRemediating(false);
    }
  }

  async function generateStrategyTrendRemediationTasks(testIds: string[], anomalyKey: string) {
    const uniqueTestIds = [...new Set(testIds.filter(Boolean))];

    if (uniqueTestIds.length === 0) {
      pushWarning("没有可生成整改的趋势样本", "这条策略异常还没有关联到低覆盖、无引用或不通过的 QA 题。");
      return;
    }

    setStrategyTrendRemediatingKey(anomalyKey);

    try {
      const response = await fetch("/api/admin/qa-tests/remediation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          test_ids: uniqueTestIds,
          limit: uniqueTestIds.length
        })
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "生成趋势整改任务失败");
      }

      await loadTests();
      pushSuccess(
        "趋势整改已生成",
        `已处理 ${uniqueTestIds.length} 条相关 QA 题，新增 ${data.count ?? 0} 条整改任务${data.skipped?.length ? `，跳过 ${data.skipped.length} 条已有任务` : ""}。`
      );
    } catch (error) {
      pushActionError(error, "生成趋势整改任务失败");
    } finally {
      setStrategyTrendRemediatingKey(null);
    }
  }

  async function generateSingleRemediationTask(test: QaTestCase) {
    setGeneratingRemediationId(test.id);

    try {
      const response = await fetch(`/api/admin/qa-tests/${test.id}/remediation`, {
        method: "POST"
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "生成整改任务失败");
      }

      if (data.created) {
        await loadTests();
        pushSuccess("整改任务已生成", `已为「${test.question}」生成整改任务，也可以在当前卡片直接补充知识并复测。`);
      } else if (data.skipped?.reason) {
        await loadTests();
        pushWarning("未重复生成", data.skipped.reason);
      } else {
        pushInfo("暂无明显整改原因", "当前测试可以先人工复核或补充标准依据。");
      }
    } catch (error) {
      pushActionError(error, "生成整改任务失败");
    } finally {
      setGeneratingRemediationId(null);
    }
  }

  async function supplementAndRetestTest(test: QaTestCase, input: QaSupplementInput) {
    setSupplementingId(test.id);

    try {
      const remediationResponse = await fetch(`/api/admin/qa-tests/${test.id}/remediation`, {
        method: "POST"
      });
      const remediationData = await remediationResponse.json();

      if (!remediationResponse.ok) {
        throw new Error(remediationData.error ?? "生成整改任务失败");
      }

      const taskId = remediationData.task?.id;
      if (!taskId) {
        throw new Error(remediationData.skipped?.reason ?? "当前测试无法生成整改任务");
      }

      const response = await fetch(`/api/admin/knowledge-tasks/${taskId}/supplement`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...input,
          retest: true
        })
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "补充知识并复测失败");
      }

      await loadTests();
      const retestStatus = data.retest?.status === "resolved" ? "已通过" : "仍需整改";
      pushSuccess("已补充知识并完成复测", `${retestStatus}，生成 ${data.chunks ?? 0} 个可检索片段。`);
    } catch (error) {
      pushActionError(error, "补充知识并复测失败");
    } finally {
      setSupplementingId(null);
    }
  }

  async function runTest(test: QaTestCase) {
    setRunningId(test.id);

    try {
      const response = await fetch(`/api/admin/qa-tests/${test.id}/run`, { method: "POST" });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "运行失败");
      }

      setTests((current) => current.map((item) => (item.id === test.id ? data.test : item)));
      await loadTests();
      if (data.test?.status === "failed") {
        pushWarning("测试已运行并标记不通过", data.test.reviewer_note ?? "请查看质检诊断。");
      } else {
        pushSuccess("测试已运行", "等待人工评审。");
      }
    } catch (error) {
      pushActionError(error, "运行失败");
    } finally {
      setRunningId(null);
    }
  }

  async function reviewTest(test: QaTestCase, status: QaTestStatus, note?: string | null) {
    setSavingId(test.id);

    try {
      const response = await fetch(`/api/admin/qa-tests/${test.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status,
          reviewer_note: note ?? test.reviewer_note
        })
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "保存评审失败");
      }

      setTests((current) => current.map((item) => (item.id === test.id ? data.test : item)));
      pushSuccess(status === "passed" ? "已标记通过" : "已标记不通过");
    } catch (error) {
      pushActionError(error, "保存评审失败");
    } finally {
      setSavingId(null);
    }
  }

  function pushBatchJobToast(job: QaBatchJob, label: string) {
    const description = batchJobNotice(job, label);

    if (job.status === "failed") {
      pushToast({
        tone: "error",
        title: "批量运行异常结束",
        description,
        durationMs: 7000
      });
      return;
    }

    if (job.status === "canceled") {
      pushWarning("批量运行已停止", description);
      return;
    }

    pushSuccess("批量运行完成", description);
  }

  function pushRemediationRetestToast(job: KnowledgeTaskRetestBatchJob) {
    const description = `整改复测：共 ${job.total} 条，已完成 ${job.completed} 条，通过 ${job.resolved} 条，仍需整改 ${job.processing} 条，失败 ${job.failed} 条。`;

    if (job.status === "failed") {
      pushToast({
        tone: "error",
        title: "整改复测异常结束",
        description,
        durationMs: 7000
      });
      return;
    }

    if (job.status === "canceled") {
      pushWarning("整改复测已停止", description);
      return;
    }

    pushSuccess("整改复测完成", description);
  }

  const showInitialSkeleton = loading && tests.length === 0 && knowledgeBases.length === 0;
  const showInitialError = !loading && Boolean(loadError) && tests.length === 0 && knowledgeBases.length === 0;

  return (
    <div className="space-y-3 pb-6">
      <header className="flex flex-col gap-3 border-b border-line pb-3 md:flex-row md:items-center md:justify-between" data-testid="qa-header">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-cyan/10 text-brand">
              <ClipboardCheck size={18} />
            </span>
            <div className="min-w-0">
              <h1 className="text-xl font-semibold text-ink">问答测试</h1>
              <p className="truncate text-sm text-slate-500">测试用例、质量评估、检索诊断与整改复测</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void loadTests()}
            disabled={loading}
            className="ui-button-secondary h-9 self-start px-3 md:self-auto"
          >
            {loading ? <Loader2 className="animate-spin" size={16} /> : <RefreshCw size={16} />}
            刷新
          </button>
      </header>

      {showInitialSkeleton && <QaTestAdminSkeleton />}

      {showInitialError && loadError && (
        <ErrorRetry
          title="问答测试加载失败"
          message={loadError}
          retrying={loading}
          onRetry={() => void loadTests({ notifyOnError: false })}
        />
      )}

      {!showInitialSkeleton && !showInitialError && (
        <>
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" data-testid="qa-primary-metrics">
        <Metric label="测试总数" value={stats.total} />
        <Metric label="已运行" value={stats.withAnswer} />
        <Metric label="通过率" value={`${stats.passRate}%`} />
        <Metric label="无引用率" value={`${stats.noCitationRate}%`} />
      </section>

      <details className="ui-card group overflow-hidden" data-testid="qa-metrics-details">
        <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between gap-3 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 [&::-webkit-details-marker]:hidden">
          <span>查看全部质量与用量指标</span>
          <ChevronDown className="size-4 text-slate-400 transition group-open:rotate-180" />
        </summary>
        <div className="grid gap-3 border-t border-line p-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          <Metric label="未运行" value={stats.unanswered} compact />
          <Metric label="期望覆盖" value={`${stats.averageCoverage}%`} compact />
          <Metric label="质量均分" value={`${stats.averageQuality}`} compact />
          <Metric label="低覆盖" value={stats.lowCoverage} compact />
          <Metric label="未命中" value={stats.knowledgeMiss} compact />
          <Metric label="平均耗时" value={`${stats.averageLatency}ms`} compact />
          <Metric label="QA Token" value={formatTokenCount(qaUsageSummary?.total_tokens ?? 0)} compact />
          <Metric label="QA 成本" value={formatUsd(qaUsageSummary?.cost_usd)} compact />
          <Metric label="估算用量" value={qaUsageSummary ? `${qaUsageSummary.estimated_count}/${qaUsageSummary.event_count}` : "0/0"} compact />
        </div>
      </details>

      <section className="ui-card grid grid-cols-2 gap-1 p-1.5 lg:grid-cols-4" aria-label="问答测试视图">
        <QaViewButton active={activeView === "tests"} onClick={() => setActiveView("tests")}>测试用例 · {tests.length}</QaViewButton>
        <QaViewButton active={activeView === "quality"} onClick={() => setActiveView("quality")}>质量与检索诊断</QaViewButton>
        <QaViewButton active={activeView === "automation"} onClick={() => setActiveView("automation")}>自动整改与复测</QaViewButton>
        <QaViewButton active={activeView === "create"} onClick={() => setActiveView("create")}>新增与导入</QaViewButton>
      </section>

      {activeView === "quality" && (
      <>
      <StrategyTrendPanel
        trend={strategyTrend}
        selectedWindowDays={strategyTrendWindowDays}
        loading={loading}
        onWindowChange={(days) => void changeStrategyTrendWindow(days)}
        remediatingAnomalyKey={strategyTrendRemediatingKey}
        onGenerateAnomalyRemediation={(testIds, anomalyKey) => void generateStrategyTrendRemediationTasks(testIds, anomalyKey)}
      />

      <RetrievalEvaluationPanel overview={retrievalOverview} onFilterChange={showTestsByFilter} />
      <RetrievalStrategyComparisonPanel
        report={retrievalStrategyReport}
        loading={strategyComparing}
        onRun={() => void compareRetrievalStrategies()}
      />
      <GovernanceImpactPanel
        report={governanceImpactReport}
        loading={governanceImpactLoading}
        onRun={() => void compareGovernanceImpact()}
      />
      <GovernanceRecommendationPanel
        report={governanceRecommendationReport}
        loading={governanceRecommendationLoading}
        remediating={governanceRecommendationRemediating}
        onRun={() => void generateGovernanceRecommendations()}
        onCreateRemediation={() => void generateRecommendationRemediationTasks()}
        onFilterChange={showTestsByFilter}
      />
      <FailureTracePanel overview={failureTraceOverview} onFilterChange={showTestsByFilter} />

      {(stats.slowest.length > 0 || stats.failedTests.length > 0 || stats.riskyTests.length > 0) && (
        <section className="grid gap-3 xl:grid-cols-3">
          <ReportList title="最慢问题" items={stats.slowest.map((item) => ({ id: item.id, title: item.question, detail: `${item.latency_ms ?? 0}ms · ${statusLabel[item.status]}` }))} emptyText="暂无耗时记录。" />
          <ReportList title="不通过问题" items={stats.failedTests.map((item) => ({ id: item.id, title: item.question, detail: item.reviewer_note || "未填写评审备注" }))} emptyText="暂无不通过问题。" />
          <ReportList title="需重点复核" items={stats.riskyTests.map((item) => ({ id: item.id, title: item.question, detail: qaDiagnostics(item).messages.join("；") }))} emptyText="暂无明显风险。" />
        </section>
      )}
      </>
      )}

      {activeView === "automation" && (
      <>
      <StrategyAnomalySchedulePanel
        schedule={strategyAnomalySchedule}
        loading={strategyAnomalyScheduleLoading}
        saving={strategyAnomalyScheduleSaving}
        running={strategyAnomalyRunning}
        onScheduleChange={(input) => void updateStrategyAnomalySchedule(input)}
        onRunNow={() => void runStrategyAnomalyScheduleNow()}
      />

      <RemediationLoopPanel
        stats={remediationLoopStats}
        status={remediationTasksStatus}
        trend={remediationRetestTrend}
        schedule={remediationRetestSchedule}
        scheduleLoading={remediationRetestScheduleLoading}
        scheduleSaving={remediationRetestScheduleSaving}
        retesting={remediationRetestRunning}
        onFilterChange={setFilter}
        onRefresh={() => void loadTests()}
        onRunRetestBatch={() => void runRemediationRetestBatch()}
        onRunScheduledRetestNow={() => void runScheduledRemediationRetestNow()}
        onScheduleChange={(input) => void updateRemediationRetestSchedule(input)}
      />
      {remediationRetestProgress && (
        <RemediationRetestProgressPanel
          progress={remediationRetestProgress}
          running={remediationRetestRunning}
          onStop={stopRemediationRetestBatch}
        />
      )}
      </>
      )}

      {activeView === "create" && (
      <>
      <section className="ui-card p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-base font-semibold text-ink">新增测试问题</h2>
            <p className="mt-1 text-sm text-slate-500">可手动录入，也可以从已发布资料分片自动生成一批真实质检题。</p>
          </div>
          <button
            type="button"
            onClick={() => void generateKnowledgeTemplate()}
            disabled={generatingTemplate || selectedKbIds.length === 0}
            className="ui-button-secondary min-h-11"
            title={selectedKbIds.length === 0 ? "请先选择知识库" : "从资料分片生成测试问题"}
          >
            {generatingTemplate ? <Loader2 className="animate-spin" size={16} /> : <FilePlus2 size={16} />}
            从资料生成测试
          </button>
        </div>
        <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_1fr_180px]">
          <textarea
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="输入要测试的员工问题"
            className="min-h-24 rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-brand"
          />
          <textarea
            value={expectedAnswer}
            onChange={(event) => setExpectedAnswer(event.target.value)}
            placeholder="期望答案或判定要点，可选"
            className="min-h-24 rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-brand"
          />
          <button
            type="button"
            onClick={() => void createTest()}
            disabled={creating || !question.trim() || selectedKbIds.length === 0}
            className="ui-button-primary h-11 self-start"
          >
            {creating ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />}
            保存测试
          </button>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {knowledgeBases.map((kb) => (
            <button
              key={kb.id}
              type="button"
              onClick={() => toggleKnowledgeBase(kb.id)}
              className={`min-h-11 rounded-lg border px-3 py-2 text-sm ${
                selectedKbIds.includes(kb.id)
                  ? "border-cyan/30 bg-cyan/10 text-brand"
                  : "border-line bg-white text-slate-600"
              }`}
            >
              {kb.name}
            </button>
          ))}
        </div>
      </section>

      <section className="ui-card p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-base font-semibold text-ink">批量导入</h2>
            <p className="mt-1 text-sm text-slate-500">每行一条：问题, 期望答案, 知识库名称。第三列可省略，默认使用上方选中的知识库。</p>
          </div>
          <button
            type="button"
            onClick={() => void importTests()}
            disabled={importing || !bulkContent.trim() || selectedKbIds.length === 0}
            className="ui-button-primary min-h-11"
          >
            {importing ? <Loader2 className="animate-spin" size={16} /> : <Upload size={16} />}
            导入
          </button>
        </div>
        <textarea
          value={bulkContent}
          onChange={(event) => setBulkContent(event.target.value)}
          placeholder={"问题,期望答案,知识库名称\n设备异常时如何处理？,立即停机并通知班组长,员工培训手册\n首件未经确认可以生产吗？,不得批量生产,员工培训手册"}
          className="mt-4 min-h-32 w-full rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-brand"
        />
      </section>
      </>
      )}

      {activeView === "tests" && (
      <>
      <section className="ui-card p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap gap-2">
            {[
              ["all", "全部"],
              ["untested", "待评审"],
              ["passed", "通过"],
              ["failed", "不通过"],
              ["no_citation", "无引用"],
              ["low_coverage", "低覆盖"],
              ["knowledge_miss", "未命中"]
            ].map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setFilter(value as typeof filter)}
                className={`min-h-11 rounded-lg border px-3 py-2 text-sm ${
                  filter === value
                    ? "border-cyan/30 bg-cyan/10 text-brand"
                    : "border-line bg-white text-slate-600"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => void runBatch(batchProgress?.mode === "stopped" ? batchProgress.runMode : "unanswered")}
            disabled={batchRunning || (batchProgress?.mode === "stopped" ? batchCandidates(batchProgress.runMode).length === 0 : stats.unanswered === 0)}
            className="ui-button-success min-h-11"
          >
            {batchRunning ? <Loader2 className="animate-spin" size={16} /> : <Play size={16} />}
            {batchProgress?.mode === "stopped" ? "继续运行" : "运行未测试"}
          </button>
          <button
            type="button"
            onClick={() => void generateRemediationTasks()}
            disabled={generatingRemediation || tests.length === 0}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 text-sm font-semibold text-amber-800 hover:bg-amber-100 disabled:bg-slate-100 disabled:text-slate-300"
          >
            {generatingRemediation ? <Loader2 className="animate-spin" size={16} /> : <ListTodo size={16} />}
            生成整改任务
          </button>
          <button
            type="button"
            onClick={exportCsv}
            className="ui-button-secondary min-h-11"
          >
            导出 CSV
          </button>
        </div>
      </section>

      <section className="ui-card p-4">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <h2 className="text-base font-semibold text-ink">定向复测</h2>
            <p className="mt-1 text-sm text-slate-500">资料补充或模型配置调整后，只复跑高风险问题，减少等待时间。</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <BatchRunButton
              label="复跑不通过"
              count={stats.failed}
              running={batchRunning}
              onClick={() => void runBatch("failed")}
            />
            <BatchRunButton
              label="复跑无引用"
              count={stats.noCitation}
              running={batchRunning}
              onClick={() => void runBatch("no_citation")}
            />
            <BatchRunButton
              label="复跑低覆盖"
              count={stats.lowCoverage}
              running={batchRunning}
              onClick={() => void runBatch("low_coverage")}
            />
            <BatchRunButton
              label="复跑未命中"
              count={stats.knowledgeMiss}
              running={batchRunning}
              onClick={() => void runBatch("knowledge_miss")}
            />
            <BatchRunButton
              label="复跑全部风险"
              count={stats.riskyCount}
              running={batchRunning}
              strong
              onClick={() => void runBatch("risky")}
            />
          </div>
        </div>
      </section>

      {batchProgress && (
        <BatchProgressPanel
          progress={batchProgress}
          running={batchRunning}
          onStop={stopBatchRun}
        />
      )}

      <section className="space-y-3">
        {visibleTests.map((test) => (
          <TestCard
            key={test.id}
            test={test}
            usage={qaUsageByTestId[test.id] ?? null}
            remediation={remediationByTestId[test.id] ?? null}
            knowledgeBases={knowledgeBases}
            running={runningId === test.id}
            saving={savingId === test.id}
            remediationRunning={generatingRemediationId === test.id}
            supplementing={supplementingId === test.id}
            onRun={() => void runTest(test)}
            onReview={(status, note) => void reviewTest(test, status, note)}
            onCreateRemediation={() => void generateSingleRemediationTask(test)}
            onSupplementAndRetest={(input) => void supplementAndRetestTest(test, input)}
          />
        ))}
        {visibleTests.length === 0 && (
          <div className="ui-card px-4 py-8 text-center text-sm text-slate-500">
            暂无匹配的测试问题。
          </div>
        )}
        {filteredTests.length > 8 && (
          <div className="flex justify-center pt-1">
            <button
              type="button"
              onClick={() => setShowAllTests((current) => !current)}
              className="ui-button-secondary min-h-10 px-4"
              aria-expanded={showAllTests}
            >
              <ChevronDown className={`size-4 transition ${showAllTests ? "rotate-180" : ""}`} />
              {showAllTests ? "收起用例" : `展开全部 ${filteredTests.length} 条用例`}
            </button>
          </div>
        )}
      </section>
      </>
      )}
        </>
      )}
    </div>
  );
}

function QaTestAdminSkeleton() {
  return (
    <div className="space-y-5" aria-label="问答测试加载中">
      <section className="grid gap-3 md:grid-cols-4">
        {Array.from({ length: 8 }).map((_, index) => (
          <div key={index} className="ui-card p-4">
            <div className="animate-pulse space-y-3">
              <div className="h-3 w-20 rounded-full bg-slate-200" />
              <div className="h-7 w-14 rounded-full bg-slate-100" />
            </div>
          </div>
        ))}
      </section>
      <PanelSkeleton rows={5} />
      <PanelSkeleton rows={4} />
      <PanelSkeleton rows={4} />
      <section className="grid gap-3">
        {Array.from({ length: 4 }).map((_, index) => (
          <PanelSkeleton key={index} rows={3} />
        ))}
      </section>
    </div>
  );
}

function Metric({ label, value, compact = false }: { label: string; value: string | number; compact?: boolean }) {
  return (
    <div className={compact ? "rounded-lg border border-line bg-white px-3 py-2.5" : "ui-card p-4"}>
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className={`${compact ? "mt-1 text-lg" : "mt-2 text-2xl"} font-semibold tabular-nums text-ink`}>{value}</p>
    </div>
  );
}

function QaViewButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`min-h-11 rounded-md px-3 py-2 text-sm font-semibold transition ${active ? "bg-brand text-white" : "text-slate-600 hover:bg-slate-100"}`}
    >
      {children}
    </button>
  );
}

type RetrievalEvaluationOverview = ReturnType<typeof buildRetrievalEvaluation>;

function RetrievalEvaluationPanel({
  overview,
  onFilterChange
}: {
  overview: RetrievalEvaluationOverview;
  onFilterChange: (filter: QaFilter) => void;
}) {
  return (
    <section className="ui-card p-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 text-sm font-semibold text-ink">
            {overview.riskTests > 0 ? <AlertTriangle size={16} className="text-amber-700" /> : <CheckCircle2 size={16} className="text-emerald-700" />}
            检索评估看板
          </div>
          <p className="mt-1 text-sm leading-6 text-slate-500">
            把 QA 失败、无引用、低覆盖和未命中聚合到知识库、文档和测试问题，方便定位需要补资料的位置。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => onFilterChange("no_citation")} className="ui-button-secondary min-h-11 px-3 text-xs">
            无引用 {overview.noCitation}
          </button>
          <button type="button" onClick={() => onFilterChange("low_coverage")} className="ui-button-secondary min-h-11 px-3 text-xs">
            低覆盖 {overview.lowCoverage}
          </button>
          <button type="button" onClick={() => onFilterChange("knowledge_miss")} className="ui-button-secondary min-h-11 px-3 text-xs">
            未命中 {overview.knowledgeMiss}
          </button>
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-5">
        <RetrievalMetric label="已运行" value={overview.answeredTests} />
        <RetrievalMetric label="风险问题" value={overview.riskTests} tone={overview.riskTests > 0 ? "warn" : "good"} />
        <RetrievalMetric label="风险率" value={`${overview.riskRate}%`} tone={overview.riskRate > 20 ? "warn" : "good"} />
        <RetrievalMetric label="平均引用" value={overview.averageCitations.toFixed(1)} />
        <RetrievalMetric label="覆盖均值" value={`${overview.averageCoverage}%`} tone={overview.averageCoverage < 70 ? "warn" : "good"} />
      </div>

      <MatchSignalOverviewPanel
        rows={overview.matchSignalRows}
        dominantRows={overview.dominantSignalRows}
        signalCitationCount={overview.signalCitationCount}
        loadedCitationTotal={overview.loadedCitationTotal}
        signalCoverageRate={overview.signalCoverageRate}
      />

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
        <div className="rounded-lg border border-line">
          <div className="border-b border-line bg-slate-50 px-3 py-2">
            <h3 className="text-sm font-semibold text-ink">知识库风险归因</h3>
          </div>
          <div className="divide-y divide-line">
            {overview.knowledgeBaseRows.slice(0, 5).map((row) => (
              <div key={row.id} className="px-3 py-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-ink" title={row.name}>{row.name}</p>
                    <p className="mt-1 text-xs leading-5 text-slate-500">
                      {row.answered} 已运行 · {row.citationCount} 引用 · 覆盖 {row.averageCoverage}% · 质量 {row.averageQuality}
                    </p>
                  </div>
                  <span className={`w-fit rounded-full px-2 py-0.5 text-xs font-semibold ${retrievalRiskClass(row.riskCount)}`}>
                    风险 {row.riskCount}
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
                  <RetrievalChip label="无引用" value={row.noCitation} />
                  <RetrievalChip label="低覆盖" value={row.lowCoverage} />
                  <RetrievalChip label="未命中" value={row.knowledgeMiss} />
                  <RetrievalChip label="不通过" value={row.failed} />
                </div>
              </div>
            ))}
            {overview.knowledgeBaseRows.length === 0 && (
              <p className="px-3 py-6 text-center text-sm text-slate-500">暂无可评估的知识库测试。</p>
            )}
          </div>
        </div>

        <div className="rounded-lg border border-line">
          <div className="border-b border-line bg-slate-50 px-3 py-2">
            <h3 className="text-sm font-semibold text-ink">命中文档/位置</h3>
          </div>
          <div className="divide-y divide-line">
            {overview.documentRows.slice(0, 5).map((row) => (
              <div key={row.id} className="px-3 py-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-ink" title={row.name}>{row.name}</p>
                    <p className="mt-1 text-xs leading-5 text-slate-500">
                      {row.testCount} 题命中 · {row.citationCount} 次引用{row.averageScore !== null ? ` · 平均相关度 ${row.averageScore}` : ""}
                    </p>
                    {row.locations.length > 0 && (
                      <p className="mt-1 line-clamp-1 text-xs text-slate-500">{row.locations.join("、")}</p>
                    )}
                  </div>
                  <span className={`w-fit rounded-full px-2 py-0.5 text-xs font-semibold ${retrievalRiskClass(row.riskTests)}`}>
                    风险 {row.riskTests}
                  </span>
                </div>
              </div>
            ))}
            {overview.documentRows.length === 0 && (
              <p className="px-3 py-6 text-center text-sm text-slate-500">暂无引用来源。优先复跑无引用测试或检查知识库范围。</p>
            )}
          </div>
        </div>
      </div>

      {overview.riskRows.length > 0 && (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50/70">
          <div className="border-b border-amber-100 px-3 py-2">
            <h3 className="text-sm font-semibold text-amber-900">优先处理问题</h3>
          </div>
          <div className="divide-y divide-amber-100">
            {overview.riskRows.slice(0, 5).map((row) => (
              <div key={row.id} className="px-3 py-3">
                <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                  <div className="min-w-0">
                    <p className="break-words text-sm font-semibold leading-5 text-ink">{row.question}</p>
                    <p className="mt-1 text-xs leading-5 text-amber-800">{row.reason}</p>
                    <p className="mt-1 text-xs leading-5 text-slate-500">
                      知识库：{row.knowledgeBases || "未绑定"} · 来源：{row.sources || "未命中文档"}
                    </p>
                  </div>
                  <span className={`w-fit shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${row.risk === "high" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"}`}>
                    {row.risk === "high" ? "高风险" : "中风险"}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function RetrievalMetric({
  label,
  value,
  tone
}: {
  label: string;
  value: string | number;
  tone?: "good" | "warn";
}) {
  const toneClass = tone === "good" ? "text-emerald-700" : tone === "warn" ? "text-amber-700" : "text-ink";

  return (
    <div className="rounded-lg border border-line bg-slate-50 px-3 py-2">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className={`mt-1 text-lg font-semibold ${toneClass}`}>{value}</p>
    </div>
  );
}

function RetrievalChip({ label, value }: { label: string; value: number }) {
  return (
    <span className={`rounded-full px-2 py-0.5 ${value > 0 ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-500"}`}>
      {label} {value}
    </span>
  );
}

function MatchSignalOverviewPanel({
  rows,
  dominantRows,
  signalCitationCount,
  loadedCitationTotal,
  signalCoverageRate
}: {
  rows: Array<MatchSignalBadge & { count: number }>;
  dominantRows: Array<{ key: CitationDominantMatchSignal; label: string; count: number; percent: number }>;
  signalCitationCount: number;
  loadedCitationTotal: number;
  signalCoverageRate: number;
}) {
  if (rows.length === 0) {
    return (
      <div className="mt-4 rounded-lg border border-dashed border-line bg-slate-50 px-3 py-3 text-sm leading-6 text-slate-500">
        召回贡献暂无分项数据。复跑 QA 后，新生成的引用会显示正文、摘要、关键词、同义词、元数据等命中来源。
      </div>
    );
  }

  return (
    <div className="mt-4 rounded-lg border border-line bg-slate-50 p-3">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-sm font-semibold text-ink">召回贡献</h3>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            已解析 {signalCitationCount}/{loadedCitationTotal} 个引用 · 覆盖 {signalCoverageRate}%
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {dominantRows.slice(0, 4).map((row) => (
            <span key={row.key} className="rounded-full bg-white px-2 py-0.5 text-xs font-medium text-slate-600 ring-1 ring-line">
              主因 {row.label} {row.count}
            </span>
          ))}
        </div>
      </div>

      <div className="mt-3 grid gap-2 lg:grid-cols-2">
        {rows.map((row) => (
          <div key={row.key} className="min-w-0 rounded-lg bg-white px-3 py-2 ring-1 ring-line">
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs font-semibold text-slate-700">{row.label}</span>
              <span className="shrink-0 text-xs text-slate-500">{row.percent}% · {row.count} 次</span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
              <div className={`h-full rounded-full ${matchSignalBarClass(row.key)}`} style={{ width: `${Math.max(row.percent, 4)}%` }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function RetrievalStrategyComparisonPanel({
  report,
  loading,
  onRun
}: {
  report: RetrievalStrategyReport | null;
  loading: boolean;
  onRun: () => void;
}) {
  const bestStrategy = report?.strategies.find((row) => row.strategy_id === report.best_strategy_id) ?? null;

  return (
    <section className="ui-card p-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 text-sm font-semibold text-ink">
            <GitCompareArrows size={16} className="text-brand" />
            召回策略 A/B 对比
          </div>
          <p className="mt-1 text-sm leading-6 text-slate-500">
            用现有 QA 测试集只读对比正文优先、摘要关键词增强、同义词扩展等策略，帮助判断下一步该调权重还是继续治理分片。
          </p>
        </div>
        <button
          type="button"
          onClick={onRun}
          disabled={loading}
          className="ui-button-secondary min-h-11 shrink-0 px-3 text-sm"
        >
          {loading ? <Loader2 className="animate-spin" size={16} /> : <GitCompareArrows size={16} />}
          {report ? "重新对比" : "运行对比"}
        </button>
      </div>

      {!report && (
        <div className="mt-4 rounded-lg border border-dashed border-line bg-slate-50 px-3 py-4 text-sm leading-6 text-slate-500">
          点击运行后会评估最近最多 60 条 QA 用例；不调用模型、不写入数据库，结果只用于诊断。
        </div>
      )}

      {report && (
        <>
          <div className="mt-4 grid gap-3 md:grid-cols-4">
            <RetrievalMetric label="样本题数" value={report.sample_count} />
            <RetrievalMetric label="资料文档" value={report.document_count} />
            <RetrievalMetric label="参与分片" value={report.chunk_count} />
            <RetrievalMetric label="最优策略" value={bestStrategy?.strategy_label ?? "待确认"} tone={bestStrategy ? "good" : undefined} />
          </div>

          <div className="mt-4 grid gap-3 xl:grid-cols-4">
            {report.strategies.map((row) => (
              <div key={row.strategy_id} className="min-w-0 rounded-lg border border-line bg-white p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <h3 className="text-sm font-semibold text-ink">{row.strategy_label}</h3>
                      {row.strategy_id === report.best_strategy_id && (
                        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-100">
                          当前最优
                        </span>
                      )}
                    </div>
                    <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">{row.description}</p>
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                  <StrategyMetric label="召回率" value={`${row.hit_rate}%`} />
                  <StrategyMetric label="高覆盖" value={`${row.pass_rate}%`} tone={row.pass_rate >= 70 ? "good" : row.pass_rate < 45 ? "warn" : undefined} />
                  <StrategyMetric label="覆盖均值" value={`${row.average_coverage}%`} />
                  <StrategyMetric label="误召回" value={row.false_positive_risk_count} tone={row.false_positive_risk_count > 0 ? "warn" : "good"} />
                </div>

                <div className="mt-3 space-y-2">
                  <StrategyProgress label="覆盖" value={row.average_coverage} tone="coverage" />
                  <StrategyProgress label="高覆盖题" value={row.pass_rate} tone="pass" />
                </div>

                {row.dominant_signals.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {row.dominant_signals.slice(0, 3).map((signal) => (
                      <span key={signal.signal} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                        {signal.label} {signal.count}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>

          {report.comparison_rows.length > 0 && (
            <div className="mt-4 rounded-lg border border-line">
              <div className="border-b border-line bg-slate-50 px-3 py-2">
                <h3 className="text-sm font-semibold text-ink">策略差异问题</h3>
              </div>
              <div className="divide-y divide-line">
                {report.comparison_rows.slice(0, 6).map((row) => (
                  <div key={row.test_id} className="px-3 py-3">
                    <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0">
                        <p className="break-words text-sm font-semibold leading-5 text-ink">{row.question}</p>
                        <p className="mt-1 text-xs leading-5 text-slate-500">
                          知识库：{row.knowledge_bases || "未绑定"} · 最优：{row.best_strategy_label}
                          {row.top_source ? ` · 来源：${row.top_source}` : ""}
                        </p>
                        {row.missing_terms.length > 0 && (
                          <p className="mt-1 line-clamp-1 text-xs text-amber-700">
                            仍缺：{row.missing_terms.join("、")}
                          </p>
                        )}
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-xs sm:min-w-64">
                        <StrategyMetric label="当前" value={`${row.baseline_coverage}%`} />
                        <StrategyMetric label="最优" value={`${row.best_coverage}%`} tone={row.best_coverage >= 60 ? "good" : "warn"} />
                        <StrategyMetric label="差值" value={`${row.delta > 0 ? "+" : ""}${row.delta}%`} tone={row.delta > 0 ? "good" : row.delta < 0 ? "warn" : undefined} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="mt-3 flex flex-wrap gap-1.5">
            {report.notes.map((note) => (
              <span key={note} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-500">
                {note}
              </span>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function StrategyMetric({
  label,
  value,
  tone
}: {
  label: string;
  value: string | number;
  tone?: "good" | "warn";
}) {
  const toneClass = tone === "good" ? "text-emerald-700" : tone === "warn" ? "text-amber-700" : "text-ink";

  return (
    <div className="rounded-lg bg-slate-50 px-2.5 py-2 ring-1 ring-line">
      <p className="text-[11px] font-medium text-slate-500">{label}</p>
      <p className={`mt-1 text-sm font-semibold ${toneClass}`}>{value}</p>
    </div>
  );
}

function StrategyProgress({
  label,
  value,
  tone
}: {
  label: string;
  value: number;
  tone: "coverage" | "pass";
}) {
  const color = tone === "pass" ? "bg-emerald-600" : value >= 70 ? "bg-cyan-600" : value >= 45 ? "bg-amber-600" : "bg-red-600";

  return (
    <div>
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="font-medium text-slate-600">{label}</span>
        <span className="text-slate-500">{value}%</span>
      </div>
      <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
      </div>
    </div>
  );
}

const strategyTrendWindowOptions: Array<{ value: QaStrategyTrendWindowDays; label: string }> = [
  { value: 0, label: "全部" },
  { value: 90, label: "90 天" },
  { value: 30, label: "30 天" },
  { value: 7, label: "7 天" }
];

function StrategyTrendPanel({
  trend,
  selectedWindowDays,
  loading,
  onWindowChange,
  onGenerateAnomalyRemediation,
  remediatingAnomalyKey
}: {
  trend: QaStrategyTrend | null;
  selectedWindowDays: QaStrategyTrendWindowDays;
  loading: boolean;
  onWindowChange: (days: QaStrategyTrendWindowDays) => void;
  onGenerateAnomalyRemediation?: (testIds: string[], anomalyKey: string) => void;
  remediatingAnomalyKey?: string | null;
}) {
  const strategies = trend?.strategies ?? [];
  const bestStrategy = strategies.length > 0
    ? [...strategies].sort((a, b) =>
      b.pass_rate - a.pass_rate ||
      (b.average_coverage ?? 0) - (a.average_coverage ?? 0) ||
      b.run_count - a.run_count
    )[0]
    : null;
  const currentStrategy = strategies.find((row) => row.strategy_id === trend?.current_strategy_id) ?? null;
  const trendRows = [...(trend?.rows ?? [])]
    .filter((row) => row.date)
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "") || b.run_count - a.run_count)
    .slice(0, 10);
  const maxRuns = Math.max(1, ...trendRows.map((row) => row.run_count));

  return (
    <section className="ui-card p-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h2 className="inline-flex items-center gap-2 text-sm font-semibold text-ink">
            <BarChart3 size={16} className="text-brand" />
            策略效果趋势
          </h2>
          <p className="mt-1 text-sm leading-6 text-slate-500">
            按 QA 实际运行记录汇总 RAG 策略的通过率、无引用率、覆盖率、耗时和 token，用来观察调策略后的长期效果。
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:items-end">
          <span className="inline-flex min-h-9 w-fit items-center rounded-lg bg-cyan/10 px-3 text-xs font-semibold text-brand ring-1 ring-cyan/20">
            当前策略：{trend?.current_strategy_label ?? "未读取"}
          </span>
          <div className="flex flex-wrap gap-1.5" aria-label="策略趋势时间范围">
            {strategyTrendWindowOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => onWindowChange(option.value)}
                disabled={loading || selectedWindowDays === option.value}
                className={`min-h-9 rounded-lg border px-3 text-xs font-semibold transition ${
                  selectedWindowDays === option.value
                    ? "border-cyan/30 bg-cyan/10 text-brand"
                    : "border-line bg-white text-slate-600 hover:bg-slate-50"
                } disabled:cursor-not-allowed disabled:opacity-70`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {(!trend || trend.event_count === 0) && (
        <div className="mt-4 rounded-lg border border-dashed border-line bg-slate-50 px-3 py-4 text-sm leading-6 text-slate-500">
          暂无 QA 运行用量记录。后续运行单题或批量 QA 后，这里会自动出现按策略分组的趋势数据。
        </div>
      )}

      {trend && trend.event_count === 0 && (
        <>
          {trend.anomalies.length > 0 && (
            <StrategyTrendAnomalyPanel
              anomalies={trend.anomalies}
              onGenerateRemediation={onGenerateAnomalyRemediation}
              remediatingKey={remediatingAnomalyKey}
            />
          )}
          <StrategyTrendComparisonPanel comparison={trend.comparison} />
          <div className="mt-4 grid gap-4 xl:grid-cols-2">
            <StrategyTrendBreakdownPanel
              title="按知识库拆分"
              description="定位哪个知识库在当前策略下更容易低覆盖、无引用或耗时高。"
              rows={trend.by_knowledge_base}
              emptyText="暂无知识库拆分样本。"
            />
            <StrategyTrendBreakdownPanel
              title="按问题类型拆分"
              description="把 QA 问法归到账号、资料、培训、安全、质量等类型，观察哪类问题需要补资料或调策略。"
              rows={trend.by_intent}
              emptyText="暂无问题类型拆分样本。"
            />
            <StrategyTrendBreakdownPanel
              title="按部门拆分"
              description="按 QA 运行人或测试创建人的部门归因，观察哪些部门的常问问题更需要补资料或调策略。"
              rows={trend.by_department}
              emptyText="暂无部门拆分样本。"
            />
            <StrategyTrendBreakdownPanel
              title="按岗位拆分"
              description="按岗位归因 QA 样本，帮助判断某类岗位是否缺少专属资料、术语或可见范围。"
              rows={trend.by_position}
              emptyText="暂无岗位拆分样本。"
            />
          </div>
        </>
      )}

      {trend && trend.event_count > 0 && (
        <>
          <div className="mt-4 grid gap-3 md:grid-cols-4">
            <TrendMetric label="QA 运行" value={trend.event_count} />
            <TrendMetric
              label="最优通过率"
              value={bestStrategy ? `${bestStrategy.pass_rate}%` : "待观察"}
              tone={bestStrategy && bestStrategy.pass_rate >= 70 ? "good" : undefined}
            />
            <TrendMetric
              label="当前无引用"
              value={currentStrategy ? `${currentStrategy.no_citation_rate}%` : "暂无样本"}
              tone={currentStrategy && currentStrategy.no_citation_rate > 0 ? "warn" : "good"}
            />
            <TrendMetric
              label="平均耗时"
              value={currentStrategy?.average_latency_ms ? `${currentStrategy.average_latency_ms}ms` : "暂无样本"}
            />
          </div>

          {trend.anomalies.length > 0 ? (
            <StrategyTrendAnomalyPanel
              anomalies={trend.anomalies}
              onGenerateRemediation={onGenerateAnomalyRemediation}
              remediatingKey={remediatingAnomalyKey}
            />
          ) : (
            <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm leading-6 text-emerald-800">
              暂未发现策略趋势异常。后续每次复跑 QA 后，这里会继续观察通过率、覆盖率、无引用和耗时波动。
            </div>
          )}

          <StrategyTrendComparisonPanel comparison={trend.comparison} />

          <div className="mt-4 grid gap-3 xl:grid-cols-4">
            {strategies.slice(0, 4).map((row) => (
              <div key={row.strategy_id} className="min-w-0 rounded-lg border border-line bg-white p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="break-words text-sm font-semibold text-ink">{row.strategy_label}</h3>
                    <p className="mt-1 text-xs text-slate-500">
                      {row.run_count} 次运行
                      {row.last_run_at ? ` · 最近 ${formatLocalDateTime(row.last_run_at)}` : ""}
                    </p>
                  </div>
                  {row.strategy_id === trend.current_strategy_id && (
                    <span className="shrink-0 rounded-full bg-cyan/10 px-2 py-0.5 text-xs font-semibold text-brand ring-1 ring-cyan/20">
                      当前
                    </span>
                  )}
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <StrategyMetric label="通过率" value={`${row.pass_rate}%`} tone={row.pass_rate >= 70 ? "good" : row.pass_rate < 45 ? "warn" : undefined} />
                  <StrategyMetric label="无引用" value={`${row.no_citation_rate}%`} tone={row.no_citation_rate > 0 ? "warn" : "good"} />
                  <StrategyMetric label="覆盖率" value={row.average_coverage === null ? "无样本" : `${row.average_coverage}%`} />
                  <StrategyMetric label="Token" value={formatTokenCount(row.total_tokens)} />
                </div>
                <div className="mt-3 space-y-2">
                  <StrategyProgress label="通过率" value={row.pass_rate} tone="pass" />
                  <StrategyProgress label="覆盖率" value={row.average_coverage ?? 0} tone="coverage" />
                </div>
              </div>
            ))}
          </div>

          <div className="mt-4 grid gap-4 xl:grid-cols-2">
            <StrategyTrendBreakdownPanel
              title="按知识库拆分"
              description="定位哪个知识库在当前策略下更容易低覆盖、无引用或耗时高。"
              rows={trend.by_knowledge_base}
              emptyText="暂无知识库拆分样本。"
            />
            <StrategyTrendBreakdownPanel
              title="按问题类型拆分"
              description="把 QA 问法归到账号、资料、培训、安全、质量等类型，观察哪类问题需要补资料或调策略。"
              rows={trend.by_intent}
              emptyText="暂无问题类型拆分样本。"
            />
            <StrategyTrendBreakdownPanel
              title="按部门拆分"
              description="按 QA 运行人或测试创建人的部门归因，观察哪些部门的常问问题更需要补资料或调策略。"
              rows={trend.by_department}
              emptyText="暂无部门拆分样本。"
            />
            <StrategyTrendBreakdownPanel
              title="按岗位拆分"
              description="按岗位归因 QA 样本，帮助判断某类岗位是否缺少专属资料、术语或可见范围。"
              rows={trend.by_position}
              emptyText="暂无岗位拆分样本。"
            />
          </div>

          <div className="mt-4 rounded-lg border border-line">
            <div className="flex flex-col gap-1 border-b border-line bg-slate-50 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
              <h3 className="text-sm font-semibold text-ink">最近趋势</h3>
              <span className="text-xs text-slate-500">按日期和策略聚合，最多展示最近 10 组。</span>
            </div>
            <div className="divide-y divide-line">
              {trendRows.map((row) => (
                <div key={`${row.date}-${row.strategy_id}`} className="px-3 py-3">
                  <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-ink">
                        {row.date ? formatShortDate(row.date) : "未知日期"} · {row.strategy_label}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        {row.run_count} 次运行 · 覆盖 {row.average_coverage === null ? "无样本" : `${row.average_coverage}%`} · 平均引用 {row.average_citations}
                      </p>
                    </div>
                    <div className="grid gap-2 text-xs sm:grid-cols-3 lg:min-w-[26rem]">
                      <StrategyMetric label="通过率" value={`${row.pass_rate}%`} tone={row.pass_rate >= 70 ? "good" : row.pass_rate < 45 ? "warn" : undefined} />
                      <StrategyMetric label="无引用" value={`${row.no_citation_rate}%`} tone={row.no_citation_rate > 0 ? "warn" : "good"} />
                      <StrategyMetric label="耗时" value={row.average_latency_ms ? `${row.average_latency_ms}ms` : "无样本"} />
                    </div>
                  </div>
                  <div className="mt-3 grid grid-cols-[minmax(0,1fr)_4rem] items-center gap-3">
                    <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                      <div
                        className="h-full rounded-full bg-cyan-600"
                        style={{ width: `${Math.max(4, Math.round((row.run_count / maxRuns) * 100))}%` }}
                      />
                    </div>
                    <span className="text-right text-xs font-medium text-slate-500">{row.run_count} 次</span>
                  </div>
                </div>
              ))}
              {trendRows.length === 0 && (
                <div className="px-3 py-4 text-center text-sm text-slate-500">
                  暂无可按日期展示的趋势记录。
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </section>
  );
}

function StrategyTrendAnomalyPanel({
  anomalies,
  onGenerateRemediation,
  remediatingKey
}: {
  anomalies: QaStrategyTrendAnomaly[];
  onGenerateRemediation?: (testIds: string[], anomalyKey: string) => void;
  remediatingKey?: string | null;
}) {
  return (
    <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50/70">
      <div className="flex items-center justify-between gap-3 border-b border-amber-100 px-3 py-2">
        <h3 className="inline-flex items-center gap-2 text-sm font-semibold text-amber-900">
          <AlertTriangle size={15} />
          策略异常提醒
        </h3>
        <span className="rounded-full bg-white px-2 py-0.5 text-xs font-semibold text-amber-800 ring-1 ring-amber-100">
          {anomalies.length} 条
        </span>
      </div>
      <div className="grid gap-2 p-3 lg:grid-cols-2">
        {anomalies.map((item, index) => {
          const anomalyKey = strategyTrendAnomalyKey(item, index);
          const actionableTestIds = [...new Set(item.suggested_test_ids ?? [])];
          const isRemediating = remediatingKey === anomalyKey;

          return (
            <div
              key={anomalyKey}
              className={`rounded-lg border bg-white p-3 ${
                item.level === "critical" ? "border-red-200" : "border-amber-200"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className={`flex flex-wrap items-center gap-2 text-sm font-semibold ${item.level === "critical" ? "text-red-800" : "text-amber-900"}`}>
                    <span className={`rounded-full px-2 py-0.5 text-xs ${
                      item.level === "critical" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-800"
                    }`}>
                      {item.level === "critical" ? "严重" : "关注"}
                    </span>
                    <span>{item.title}</span>
                  </p>
                  <p className="mt-1 text-xs leading-5 text-slate-600">{item.description}</p>
                </div>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${
                  item.level === "critical" ? "bg-red-50 text-red-700 ring-1 ring-red-100" : "bg-amber-100 text-amber-800"
                }`}>
                  {item.metric}
                </span>
              </div>
              <p className="mt-2 text-xs leading-5 text-slate-500">{item.action_hint}</p>
              {onGenerateRemediation && actionableTestIds.length > 0 && (
                <button
                  type="button"
                  onClick={() => onGenerateRemediation(actionableTestIds, anomalyKey)}
                  disabled={Boolean(remediatingKey)}
                  aria-label={`为${item.title}生成相关整改任务`}
                  className="mt-3 inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 text-xs font-semibold text-amber-900 transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                >
                  {isRemediating ? <Loader2 className="animate-spin" size={15} /> : <ListTodo size={15} />}
                  生成相关整改
                  <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold text-amber-800 ring-1 ring-amber-100">
                    {actionableTestIds.length} 题
                  </span>
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function strategyTrendAnomalyKey(item: QaStrategyTrendAnomaly, index: number) {
  return `${item.title}-${item.metric}-${index}`;
}

function StrategyTrendComparisonPanel({ comparison }: { comparison: QaStrategyTrendComparison }) {
  const before = comparison.before;
  const after = comparison.after;

  return (
    <div className="mt-4 rounded-lg border border-line">
      <div className="flex flex-col gap-1 border-b border-line bg-slate-50 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-sm font-semibold text-ink">策略切换前后对比</h3>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            {comparison.mode === "switch_detected" && comparison.cutover_at
              ? `检测到 ${formatLocalDateTime(comparison.cutover_at)} 进入当前策略样本`
              : "当前时间范围内暂未形成完整切换前后样本"}
          </p>
        </div>
        <span className={`w-fit rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ${
          comparison.mode === "switch_detected"
            ? "bg-emerald-50 text-emerald-700 ring-emerald-100"
            : "bg-slate-100 text-slate-600 ring-slate-200"
        }`}>
          {comparison.mode === "switch_detected" ? "可对比" : "样本不足"}
        </span>
      </div>

      <div className="grid gap-3 p-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <StrategyTrendCompareCard title="切换前" row={before} emptyText="暂无切换前样本" />
        <StrategyTrendCompareCard title="切换后" row={after} emptyText="暂无当前策略样本" />
        <div className="rounded-lg border border-line bg-white p-3">
          <h4 className="text-sm font-semibold text-ink">变化</h4>
          {comparison.deltas ? (
            <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
              <StrategyMetric
                label="通过率"
                value={formatSignedPercent(comparison.deltas.pass_rate)}
                tone={deltaTone(comparison.deltas.pass_rate)}
              />
              <StrategyMetric
                label="覆盖率"
                value={comparison.deltas.average_coverage === null ? "无样本" : formatSignedPercent(comparison.deltas.average_coverage)}
                tone={comparison.deltas.average_coverage === null ? undefined : deltaTone(comparison.deltas.average_coverage)}
              />
              <StrategyMetric
                label="无引用"
                value={formatSignedPercent(comparison.deltas.no_citation_rate)}
                tone={inverseDeltaTone(comparison.deltas.no_citation_rate)}
              />
              <StrategyMetric
                label="耗时"
                value={comparison.deltas.average_latency_ms === null ? "无样本" : `${formatSignedNumber(comparison.deltas.average_latency_ms)}ms`}
                tone={comparison.deltas.average_latency_ms === null ? undefined : inverseDeltaTone(comparison.deltas.average_latency_ms)}
              />
            </div>
          ) : (
            <p className="mt-3 text-sm leading-6 text-slate-500">
              样本还不足以计算变化。先在当前策略下复跑一批失败、低覆盖或无引用问题。
            </p>
          )}
        </div>
      </div>

      {comparison.notes.length > 0 && (
        <div className="flex flex-wrap gap-1.5 border-t border-line px-3 py-2">
          {comparison.notes.map((note) => (
            <span key={note} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-500">
              {note}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function StrategyTrendCompareCard({
  title,
  row,
  emptyText
}: {
  title: string;
  row: QaStrategyTrendRow | null;
  emptyText: string;
}) {
  return (
    <div className="rounded-lg border border-line bg-white p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h4 className="text-sm font-semibold text-ink">{title}</h4>
          <p className="mt-1 break-words text-xs text-slate-500">
            {row ? `${row.strategy_label} · ${row.run_count} 次运行` : emptyText}
          </p>
        </div>
      </div>
      {row ? (
        <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
          <StrategyMetric label="通过率" value={`${row.pass_rate}%`} tone={row.pass_rate >= 70 ? "good" : row.pass_rate < 45 ? "warn" : undefined} />
          <StrategyMetric label="覆盖率" value={row.average_coverage === null ? "无样本" : `${row.average_coverage}%`} tone={(row.average_coverage ?? 100) < 60 ? "warn" : "good"} />
          <StrategyMetric label="无引用" value={`${row.no_citation_rate}%`} tone={row.no_citation_rate > 0 ? "warn" : "good"} />
          <StrategyMetric label="耗时" value={row.average_latency_ms ? `${row.average_latency_ms}ms` : "无样本"} />
        </div>
      ) : (
        <p className="mt-3 text-sm leading-6 text-slate-500">暂无可展示指标。</p>
      )}
    </div>
  );
}

function StrategyTrendBreakdownPanel({
  title,
  description,
  rows,
  emptyText
}: {
  title: string;
  description: string;
  rows: QaStrategyTrendBreakdownRow[];
  emptyText: string;
}) {
  return (
    <div className="rounded-lg border border-line">
      <div className="border-b border-line bg-slate-50 px-3 py-2">
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
        <p className="mt-1 text-xs leading-5 text-slate-500">{description}</p>
      </div>
      <div className="divide-y divide-line">
        {rows.slice(0, 5).map((row) => (
          <StrategyTrendBreakdownItem key={`${row.dimension_id}-${row.strategy_id}`} row={row} />
        ))}
        {rows.length === 0 && (
          <p className="px-3 py-5 text-center text-sm text-slate-500">{emptyText}</p>
        )}
      </div>
    </div>
  );
}

function StrategyTrendBreakdownItem({ row }: { row: QaStrategyTrendBreakdownRow }) {
  const riskTone = row.risk_score >= 35 ? "text-red-700 bg-red-50 ring-red-100" : row.risk_score >= 20 ? "text-amber-800 bg-amber-50 ring-amber-100" : "text-emerald-700 bg-emerald-50 ring-emerald-100";

  return (
    <div className="px-3 py-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="break-words text-sm font-semibold text-ink">{row.dimension_label}</p>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            {row.strategy_label} · {row.run_count} 次运行
            {row.last_run_at ? ` · 最近 ${formatLocalDateTime(row.last_run_at)}` : ""}
          </p>
        </div>
        <span className={`w-fit shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ${riskTone}`}>
          风险 {row.risk_score}
        </span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
        <StrategyMetric label="通过率" value={`${row.pass_rate}%`} tone={row.pass_rate >= 70 ? "good" : row.pass_rate < 45 ? "warn" : undefined} />
        <StrategyMetric label="覆盖率" value={row.average_coverage === null ? "无样本" : `${row.average_coverage}%`} tone={(row.average_coverage ?? 100) < 60 ? "warn" : "good"} />
        <StrategyMetric label="无引用" value={`${row.no_citation_rate}%`} tone={row.no_citation_rate > 0 ? "warn" : "good"} />
        <StrategyMetric label="耗时" value={row.average_latency_ms ? `${row.average_latency_ms}ms` : "无样本"} />
      </div>
    </div>
  );
}

function TrendMetric({
  label,
  value,
  tone
}: {
  label: string;
  value: string | number;
  tone?: "good" | "warn";
}) {
  const toneClass = tone === "good" ? "text-emerald-700" : tone === "warn" ? "text-amber-700" : "text-ink";

  return (
    <div className="rounded-lg border border-line bg-slate-50 px-3 py-2">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className={`mt-1 break-words text-lg font-semibold ${toneClass}`}>{value}</p>
    </div>
  );
}

function retrievalRiskClass(value: number) {
  if (value > 3) {
    return "bg-red-100 text-red-700";
  }

  if (value > 0) {
    return "bg-amber-100 text-amber-700";
  }

  return "bg-emerald-100 text-emerald-700";
}

function SignalBadgeList({ badges, className = "" }: { badges: MatchSignalBadge[]; className?: string }) {
  if (badges.length === 0) {
    return null;
  }

  return (
    <div className={`flex flex-wrap gap-1.5 ${className}`}>
      {badges.map((badge) => (
        <span key={badge.key} className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${matchSignalBadgeClass(badge.key)}`}>
          {badge.label} {badge.percent}%
        </span>
      ))}
    </div>
  );
}

function GovernanceImpactPanel({
  report,
  loading,
  onRun
}: {
  report: GovernanceImpactReport | null;
  loading: boolean;
  onRun: () => void;
}) {
  return (
    <section className="ui-card p-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 text-sm font-semibold text-ink">
            <GitCompareArrows size={16} className="text-brand" />
            治理前后效果对比
          </div>
          <p className="mt-1 text-sm leading-6 text-slate-500">
            用现有 QA 测试集只读模拟治理字段的贡献，判断摘要、关键词、同义词或待确认建议是否真的改善召回。
          </p>
        </div>
        <button
          type="button"
          onClick={onRun}
          disabled={loading}
          className="ui-button-secondary min-h-11 shrink-0 px-3 text-sm"
        >
          {loading ? <Loader2 className="animate-spin" size={16} /> : <GitCompareArrows size={16} />}
          {report ? "重新对比" : "运行对比"}
        </button>
      </div>

      {!report && (
        <div className="mt-4 rounded-lg border border-dashed border-line bg-slate-50 px-3 py-4 text-sm leading-6 text-slate-500">
          点击运行后会评估最近最多 60 条 QA 用例。当前接口只读取测试集和已发布分片，不调用模型，也不会写入数据库。
        </div>
      )}

      {report && (
        <>
          <div className="mt-4 grid gap-3 md:grid-cols-3 xl:grid-cols-6">
            <RetrievalMetric label="样本题数" value={report.sample_count} />
            <RetrievalMetric label="资料文档" value={report.document_count} />
            <RetrievalMetric label="参与分片" value={report.chunk_count} />
            <RetrievalMetric label="治理模式" value={report.mode_label} />
            <RetrievalMetric label="待确认建议" value={report.pending_suggestion_count} tone={report.pending_suggestion_count > 0 ? "warn" : undefined} />
            <RetrievalMetric label="已治理分片" value={report.governed_chunk_count} tone={report.governed_chunk_count > 0 ? "good" : undefined} />
          </div>

          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            <GovernanceSummaryCard title="治理前基线" summary={report.before} />
            <GovernanceSummaryCard title="治理后结果" summary={report.after} highlight />
          </div>

          <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-6">
            <GovernanceDeltaMetric
              label="高覆盖变化"
              value={formatSignedPercent(report.delta.pass_rate)}
              tone={deltaTone(report.delta.pass_rate)}
            />
            <GovernanceDeltaMetric
              label="平均覆盖"
              value={formatSignedPercent(report.delta.average_coverage)}
              tone={deltaTone(report.delta.average_coverage)}
            />
            <GovernanceDeltaMetric
              label="新增通过"
              value={report.delta.newly_passed_count}
              tone={report.delta.newly_passed_count > 0 ? "good" : undefined}
            />
            <GovernanceDeltaMetric
              label="覆盖提升"
              value={report.delta.improved_count}
              tone={report.delta.improved_count > 0 ? "good" : undefined}
            />
            <GovernanceDeltaMetric
              label="覆盖回退"
              value={report.delta.regressed_count}
              tone={report.delta.regressed_count > 0 ? "warn" : "good"}
            />
            <GovernanceDeltaMetric
              label="误召回风险"
              value={formatSignedNumber(report.delta.false_positive_risk_count)}
              tone={inverseDeltaTone(report.delta.false_positive_risk_count)}
            />
          </div>

          {report.comparison_rows.length > 0 ? (
            <div className="mt-4 rounded-lg border border-line">
              <div className="border-b border-line bg-slate-50 px-3 py-2">
                <h3 className="text-sm font-semibold text-ink">变化样本与风险样本</h3>
              </div>
              <div className="divide-y divide-line">
                {report.comparison_rows.slice(0, 8).map((row) => (
                  <div key={row.test_id} className="px-3 py-3">
                    <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                      <div className="min-w-0">
                        <p className="break-words text-sm font-semibold leading-5 text-ink">{row.question}</p>
                        <p className="mt-1 text-xs leading-5 text-slate-500">
                          知识库：{row.knowledge_bases || "未绑定"}
                          {row.source_changed ? " · 命中来源有变化" : ""}
                        </p>
                        {(row.before_top_source || row.after_top_source) && (
                          <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">
                            来源：{row.before_top_source ?? "未命中"} / {row.after_top_source ?? "未命中"}
                          </p>
                        )}
                        {row.missing_terms.length > 0 && (
                          <p className="mt-1 line-clamp-1 text-xs text-amber-700">
                            仍缺：{row.missing_terms.join("、")}
                          </p>
                        )}
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4 xl:min-w-[25rem]">
                        <StrategyMetric label="治理前" value={`${row.before_coverage}%`} />
                        <StrategyMetric label="治理后" value={`${row.after_coverage}%`} tone={row.after_coverage >= 60 ? "good" : "warn"} />
                        <StrategyMetric label="差值" value={formatSignedPercent(row.delta)} tone={deltaTone(row.delta)} />
                        <StrategyMetric
                          label="风险"
                          value={row.after_false_positive_risk ? "需复核" : "正常"}
                          tone={row.after_false_positive_risk ? "warn" : "good"}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-4 text-sm leading-6 text-emerald-800">
              本次样本没有明显回退、风险变化或低覆盖残留。后续可扩大测试集继续验证。
            </div>
          )}

          <div className="mt-3 flex flex-wrap gap-1.5">
            {report.notes.map((note) => (
              <span key={note} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-500">
                {note}
              </span>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function GovernanceSummaryCard({
  title,
  summary,
  highlight = false
}: {
  title: string;
  summary: GovernanceImpactSummary;
  highlight?: boolean;
}) {
  return (
    <div className={`rounded-lg border p-3 ${highlight ? "border-cyan/30 bg-cyan/5" : "border-line bg-slate-50"}`}>
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
        <span className="rounded-full bg-white px-2 py-0.5 text-xs font-medium text-slate-600 ring-1 ring-line">
          {summary.sample_count} 题
        </span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
        <StrategyMetric label="召回率" value={`${summary.hit_rate}%`} />
        <StrategyMetric label="高覆盖" value={`${summary.pass_rate}%`} tone={summary.pass_rate >= 70 ? "good" : summary.pass_rate < 45 ? "warn" : undefined} />
        <StrategyMetric label="覆盖均值" value={`${summary.average_coverage}%`} />
        <StrategyMetric label="误召回" value={summary.false_positive_risk_count} tone={summary.false_positive_risk_count > 0 ? "warn" : "good"} />
      </div>
      <div className="mt-3 space-y-2">
        <StrategyProgress label="平均覆盖" value={summary.average_coverage} tone="coverage" />
        <StrategyProgress label="高覆盖题" value={summary.pass_rate} tone="pass" />
      </div>
    </div>
  );
}

function GovernanceDeltaMetric({
  label,
  value,
  tone
}: {
  label: string;
  value: string | number;
  tone?: "good" | "warn";
}) {
  const toneClass = tone === "good"
    ? "border-emerald-200 bg-emerald-50 text-emerald-800"
    : tone === "warn"
      ? "border-amber-200 bg-amber-50 text-amber-800"
      : "border-line bg-slate-50 text-slate-700";

  return (
    <div className={`rounded-lg border px-3 py-2 ${toneClass}`}>
      <p className="text-[11px] font-medium opacity-80">{label}</p>
      <p className="mt-1 text-base font-semibold">{value}</p>
    </div>
  );
}

function GovernanceRecommendationPanel({
  report,
  loading,
  remediating,
  onRun,
  onCreateRemediation,
  onFilterChange
}: {
  report: GovernanceRecommendationReport | null;
  loading: boolean;
  remediating: boolean;
  onRun: () => void;
  onCreateRemediation: () => void;
  onFilterChange: (filter: QaFilter) => void;
}) {
  const bestStrategy = report?.strategy_summary.strategies.find((row) =>
    row.strategy_id === report.strategy_summary.best_strategy_id
  ) ?? null;
  const highPriorityActionableCount = report?.recommendations.filter((item) =>
    item.priority === "high" && Boolean(item.test_id)
  ).length ?? 0;
  const governanceTargets = useMemo(
    () => buildGovernanceTargetQueue(report?.recommendations ?? []),
    [report]
  );

  return (
    <section className="ui-card p-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 text-sm font-semibold text-ink">
            <ListTodo size={16} className="text-brand" />
            自动治理动作建议
          </div>
          <p className="mt-1 text-sm leading-6 text-slate-500">
            把 QA 样本、召回策略、待确认治理建议和低覆盖原因合并分析，自动排出下一步该补知识、治理分片、调策略还是复核误召回。
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row lg:justify-end">
          {report && (
            <button
              type="button"
              onClick={onCreateRemediation}
              disabled={remediating || highPriorityActionableCount === 0}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 text-sm font-semibold text-amber-800 transition hover:bg-amber-100 disabled:bg-slate-100 disabled:text-slate-300"
              title={highPriorityActionableCount === 0 ? "当前没有可生成整改任务的高优先级建议" : "为高优先级建议生成整改任务"}
            >
              {remediating ? <Loader2 className="animate-spin" size={16} /> : <ListTodo size={16} />}
              生成高优先级整改
              <span className="rounded-full bg-white px-2 py-0.5 text-xs text-amber-700 ring-1 ring-amber-100">
                {highPriorityActionableCount}
              </span>
            </button>
          )}
          <button
            type="button"
            onClick={onRun}
            disabled={loading}
            className="ui-button-secondary min-h-11 shrink-0 px-3 text-sm"
          >
            {loading ? <Loader2 className="animate-spin" size={16} /> : <ListTodo size={16} />}
            {report ? "重新生成" : "生成建议"}
          </button>
        </div>
      </div>

      {loading && !report && (
        <PanelSkeleton rows={3} className="mt-4 border-dashed shadow-none" />
      )}

      {!loading && !report && (
        <div className="mt-4 rounded-lg border border-dashed border-line bg-slate-50 px-3 py-4 text-sm leading-6 text-slate-500">
          点击生成后只读扫描最近最多 60 条 QA 用例，不调用模型、不写入数据库；结果会优先展示可直接处理的动作。
        </div>
      )}

      {report && (
        <>
          <div className="mt-4 grid gap-3 md:grid-cols-4 xl:grid-cols-6">
            <RetrievalMetric label="建议总数" value={report.recommendation_count} tone={report.recommendation_count > 0 ? "warn" : "good"} />
            <RetrievalMetric label="高优先级" value={report.high_priority_count} tone={report.high_priority_count > 0 ? "warn" : "good"} />
            <RetrievalMetric label="样本题数" value={report.sample_count} />
            <RetrievalMetric label="参与分片" value={report.chunk_count} />
            <RetrievalMetric label="最优策略" value={bestStrategy?.strategy_label ?? "当前策略"} tone={bestStrategy && bestStrategy.strategy_id !== "balanced" ? "warn" : "good"} />
            <RetrievalMetric label="只读分析" value={report.read_only ? "是" : "否"} tone={report.read_only ? "good" : "warn"} />
          </div>

          <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            <GovernanceActionMetric label="补知识" value={report.type_counts.supplement_knowledge ?? 0} tone="knowledge" />
            <GovernanceActionMetric label="治理分片" value={report.type_counts.improve_chunk_governance ?? 0} tone="governance" />
            <GovernanceActionMetric label="调策略" value={report.type_counts.adjust_retrieval_strategy ?? 0} tone="strategy" />
            <GovernanceActionMetric label="复核误召回" value={report.type_counts.review_false_positive ?? 0} tone="risk" />
          </div>

          {governanceTargets.length > 0 && (
            <GovernanceTargetQueue targets={governanceTargets} />
          )}

          {report.recommendations.length > 0 ? (
            <div className="mt-4 rounded-lg border border-line">
              <div className="flex flex-col gap-2 border-b border-line bg-slate-50 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
                <h3 className="text-sm font-semibold text-ink">优先处理建议</h3>
                <p className="text-xs text-slate-500">
                  高 {report.priority_counts.high ?? 0} · 中 {report.priority_counts.medium ?? 0} · 低 {report.priority_counts.low ?? 0}
                </p>
              </div>
              <div className="divide-y divide-line">
                {report.recommendations.slice(0, 10).map((recommendation) => (
                  <GovernanceRecommendationRow
                    key={recommendation.id}
                    recommendation={recommendation}
                    onFilterChange={onFilterChange}
                  />
                ))}
              </div>
            </div>
          ) : (
            <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-4 text-sm leading-6 text-emerald-800">
              当前样本没有生成明确治理动作。可以先扩大 QA 测试集，或在新增资料后重新生成。
            </div>
          )}

          <div className="mt-3 flex flex-wrap gap-1.5">
            {report.notes.map((note) => (
              <span key={note} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-500">
                {note}
              </span>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function GovernanceActionMetric({
  label,
  value,
  tone
}: {
  label: string;
  value: number;
  tone: "knowledge" | "governance" | "strategy" | "risk";
}) {
  const toneClass = {
    knowledge: "border-blue-100 bg-blue-50 text-blue-800",
    governance: "border-cyan/20 bg-cyan/10 text-brand",
    strategy: "border-violet-100 bg-violet-50 text-violet-800",
    risk: "border-amber-100 bg-amber-50 text-amber-800"
  }[tone];

  return (
    <div className={`rounded-lg border px-3 py-2 ${toneClass}`}>
      <p className="text-[11px] font-medium opacity-80">{label}</p>
      <p className="mt-1 text-base font-semibold">{value}</p>
    </div>
  );
}

type GovernanceTargetQueueItem = {
  key: string;
  href: string;
  source: string;
  title: string;
  questions: string[];
  missingTerms: string[];
  priority: GovernanceRecommendationPriority;
  count: number;
};

function GovernanceTargetQueue({ targets }: { targets: GovernanceTargetQueueItem[] }) {
  const [expanded, setExpanded] = useState(false);
  const [copying, setCopying] = useState(false);
  const primaryTarget = targets[0];
  const highCount = targets.filter((target) => target.priority === "high").length;

  async function copyTargetLinks() {
    setCopying(true);

    try {
      const origin = typeof window !== "undefined" ? window.location.origin : "";
      const content = targets
        .map((target, index) => {
          const url = target.href.startsWith("http") ? target.href : `${origin}${target.href}`;
          const questions = target.questions.slice(0, 3).map((question) => `  - ${question}`).join("\n");
          const missing = target.missingTerms.length > 0 ? `\n缺失关键词：${target.missingTerms.slice(0, 8).join("、")}` : "";
          return `${index + 1}. ${target.source}\n${url}${missing}${questions ? `\n关联问题：\n${questions}` : ""}`;
        })
        .join("\n\n");

      try {
        await copyText(content);
        window.dispatchEvent(new CustomEvent("qa-governance-links-copied", {
          detail: { count: targets.length }
        }));
      } catch (error) {
        window.dispatchEvent(new CustomEvent("qa-governance-links-copied", {
          detail: { error: errorMessage(error, "请手动展开清单复制链接。") }
        }));
      }
    } finally {
      setCopying(false);
    }
  }

  return (
    <div className="mt-4 rounded-lg border border-cyan/20 bg-cyan/10 p-3">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="inline-flex items-center gap-2 text-sm font-semibold text-ink">
            <FilePlus2 size={16} className="text-brand" />
            待治理分片队列
          </div>
          <p className="mt-1 text-sm leading-6 text-slate-600">
            已汇总 {targets.length} 个唯一分片，其中 {highCount} 个高优先级。可以先打开第一个，也可以复制全部治理链接按清单处理。
          </p>
          <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">
            首个：{primaryTarget.source}
            {primaryTarget.questions[0] ? ` · ${primaryTarget.questions[0]}` : ""}
          </p>
        </div>
        <div className="grid gap-2 sm:grid-cols-3 lg:min-w-[26rem]">
          <a
            href={primaryTarget.href}
            className="inline-flex min-h-11 items-center justify-center rounded-lg bg-ink px-3 text-sm font-semibold text-white hover:bg-slate-700"
          >
            打开首个分片
          </a>
          <button
            type="button"
            onClick={() => void copyTargetLinks()}
            disabled={copying}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-cyan/20 bg-white px-3 text-sm font-semibold text-brand hover:bg-cyan/5 disabled:bg-slate-100 disabled:text-slate-300"
          >
            {copying ? <Loader2 className="animate-spin" size={16} /> : <ClipboardCheck size={16} />}
            复制清单
          </button>
          <button
            type="button"
            onClick={() => setExpanded((current) => !current)}
            className="inline-flex min-h-11 items-center justify-center rounded-lg border border-line bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            {expanded ? "收起清单" : "展开清单"}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="mt-3 divide-y divide-cyan/20 overflow-hidden rounded-lg border border-cyan/20 bg-white">
          {targets.slice(0, 8).map((target, index) => (
            <div key={target.key} className="px-3 py-3">
              <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${recommendationPriorityClass(target.priority)}`}>
                      {recommendationPriorityLabel(target.priority)}
                    </span>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                      #{index + 1} · 关联 {target.count} 条建议
                    </span>
                  </div>
                  <p className="mt-2 break-words text-sm font-semibold leading-5 text-ink">{target.source}</p>
                  {target.questions.length > 0 && (
                    <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">
                      样本：{target.questions.slice(0, 2).join("；")}
                    </p>
                  )}
                  {target.missingTerms.length > 0 && (
                    <p className="mt-1 line-clamp-1 text-xs leading-5 text-amber-700">
                      缺：{target.missingTerms.slice(0, 8).join("、")}
                    </p>
                  )}
                </div>
                <a
                  href={target.href}
                  className="inline-flex min-h-10 shrink-0 items-center justify-center rounded-lg border border-line bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  打开治理
                </a>
              </div>
            </div>
          ))}
          {targets.length > 8 && (
            <p className="px-3 py-3 text-xs leading-5 text-slate-500">
              还有 {targets.length - 8} 个分片未展开，复制清单会包含全部治理链接。
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function buildGovernanceTargetQueue(recommendations: GovernanceRecommendation[]): GovernanceTargetQueueItem[] {
  const rows = new Map<string, GovernanceTargetQueueItem>();

  for (const recommendation of recommendations) {
    if (recommendation.type !== "improve_chunk_governance" || !recommendation.action_href) {
      continue;
    }

    const key = recommendation.target_chunk_id ?? recommendation.target_document_id ?? recommendation.action_href;
    const current = rows.get(key) ?? {
      key,
      href: recommendation.action_href,
      source: recommendation.target_source ?? recommendation.title,
      title: recommendation.title,
      questions: [],
      missingTerms: [],
      priority: recommendation.priority,
      count: 0
    };

    current.count += 1;
    current.priority = strongerPriority(current.priority, recommendation.priority);
    if (recommendation.question && !current.questions.includes(recommendation.question)) {
      current.questions.push(recommendation.question);
    }
    for (const term of recommendation.missing_terms) {
      if (!current.missingTerms.includes(term)) {
        current.missingTerms.push(term);
      }
    }
    rows.set(key, current);
  }

  return [...rows.values()]
    .sort((a, b) =>
      priorityRank(b.priority) - priorityRank(a.priority) ||
      b.count - a.count ||
      a.source.localeCompare(b.source, "zh-Hans-CN")
    );
}

function strongerPriority(current: GovernanceRecommendationPriority, next: GovernanceRecommendationPriority) {
  return priorityRank(next) > priorityRank(current) ? next : current;
}

function priorityRank(priority: GovernanceRecommendationPriority) {
  if (priority === "high") {
    return 3;
  }

  if (priority === "medium") {
    return 2;
  }

  return 1;
}

async function copyText(value: string) {
  if (navigator.clipboard?.writeText && window.isSecureContext) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
}

function GovernanceRecommendationRow({
  recommendation,
  onFilterChange
}: {
  recommendation: GovernanceRecommendation;
  onFilterChange: (filter: QaFilter) => void;
}) {
  const testHref = recommendation.test_id ? `#qa-test-${recommendation.test_id}` : null;

  return (
    <div className="px-3 py-3">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${recommendationPriorityClass(recommendation.priority)}`}>
              {recommendationPriorityLabel(recommendation.priority)}
            </span>
            <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${recommendationTypeClass(recommendation.type)}`}>
              {recommendation.type_label}
            </span>
            {recommendation.affected_count > 1 && (
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                影响 {recommendation.affected_count} 题
              </span>
            )}
          </div>
          <p className="mt-2 break-words text-sm font-semibold leading-5 text-ink">{recommendation.title}</p>
          <p className="mt-1 text-sm leading-6 text-slate-600">{recommendation.description}</p>
          {recommendation.question && (
            <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">
              样本：{recommendation.question}
            </p>
          )}
          <p className="mt-1 text-xs leading-5 text-slate-500">
            原因：{recommendation.reason}
            {recommendation.knowledge_bases ? ` · 知识库：${recommendation.knowledge_bases}` : ""}
            {recommendation.target_source ? ` · 来源：${recommendation.target_source}` : ""}
          </p>
          {recommendation.missing_terms.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {recommendation.missing_terms.slice(0, 6).map((term) => (
                <span key={term} className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 ring-1 ring-amber-100">
                  缺 {term}
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="grid gap-2 sm:grid-cols-[repeat(2,minmax(0,1fr))] xl:min-w-[24rem]">
          <StrategyMetric label="当前覆盖" value={recommendation.current_coverage === null ? "待评估" : `${recommendation.current_coverage}%`} />
          <StrategyMetric
            label="目标/预计"
            value={recommendation.expected_coverage === null ? "待评估" : `${recommendation.expected_coverage}%`}
            tone={(recommendation.expected_coverage ?? 0) >= 60 ? "good" : "warn"}
          />
          {recommendation.action_filter && (
            <button
              type="button"
              onClick={() => onFilterChange(recommendation.action_filter as QaFilter)}
              className="inline-flex min-h-10 items-center justify-center rounded-lg border border-line bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              查看相关题
            </button>
          )}
          {testHref && (
            <a
              href={testHref}
              className="inline-flex min-h-10 items-center justify-center rounded-lg border border-line bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              定位题目
            </a>
          )}
          {recommendation.action_href && (
            <a
              href={recommendation.action_href}
              className="inline-flex min-h-10 items-center justify-center rounded-lg bg-ink px-3 text-xs font-semibold text-white hover:bg-slate-700"
            >
              {recommendation.action_label}
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

function recommendationPriorityLabel(priority: GovernanceRecommendationPriority) {
  if (priority === "high") {
    return "高优先级";
  }

  if (priority === "medium") {
    return "中优先级";
  }

  return "低优先级";
}

function recommendationPriorityClass(priority: GovernanceRecommendationPriority) {
  if (priority === "high") {
    return "bg-red-50 text-red-700 ring-1 ring-red-100";
  }

  if (priority === "medium") {
    return "bg-amber-50 text-amber-700 ring-1 ring-amber-100";
  }

  return "bg-slate-100 text-slate-600 ring-1 ring-slate-200";
}

function recommendationTypeClass(type: GovernanceRecommendationType) {
  switch (type) {
    case "supplement_knowledge":
      return "bg-blue-50 text-blue-700 ring-1 ring-blue-100";
    case "improve_chunk_governance":
      return "bg-cyan/10 text-brand ring-1 ring-cyan/20";
    case "adjust_retrieval_strategy":
      return "bg-violet-50 text-violet-700 ring-1 ring-violet-100";
    case "review_false_positive":
      return "bg-amber-50 text-amber-700 ring-1 ring-amber-100";
  }
}

function citationSignalBuckets(citation: Citation): MatchSignalBadge[] {
  const rows = matchSignalBucketDefinitions
    .map((definition) => ({
      key: definition.key,
      label: definition.label,
      score: roundSignalScore(signalKeyTotal(citation.match_signals, definition.signalKeys)),
      percent: 0
    }))
    .filter((row) => row.score > 0);
  const total = rows.reduce((sum, row) => sum + row.score, 0);

  return rows
    .map((row) => ({
      ...row,
      percent: total > 0 ? Math.round((row.score / total) * 100) : 0
    }))
    .sort((a, b) => b.score - a.score);
}

function signalBadgesFromMap(signals: Map<MatchSignalBucketKey, number>, limit: number) {
  const total = [...signals.values()].reduce((sum, value) => sum + value, 0);

  return matchSignalBucketDefinitions
    .map((definition) => {
      const score = roundSignalScore(signals.get(definition.key) ?? 0);
      return {
        key: definition.key,
        label: definition.label,
        score,
        percent: total > 0 ? Math.round((score / total) * 100) : 0
      };
    })
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function dominantCitationSignal(citation: Citation): CitationDominantMatchSignal | null {
  if (isDominantMatchSignal(citation.dominant_match_signal)) {
    return citation.dominant_match_signal;
  }

  const buckets = citationSignalBuckets(citation);
  if (buckets.length === 0) {
    return null;
  }

  if (buckets.length > 1 && buckets[0].percent < 42) {
    return "mixed";
  }

  return buckets[0].key;
}

function dominantCitationSignalLabel(citation: Citation) {
  const signal = dominantCitationSignal(citation);
  return signal ? dominantMatchSignalLabels[signal] : null;
}

function isDominantMatchSignal(value: unknown): value is CitationDominantMatchSignal {
  return typeof value === "string" && value in dominantMatchSignalLabels;
}

function signalKeyTotal(signals: Citation["match_signals"], keys: CitationMatchSignalKey[]) {
  return keys.reduce((total, key) => total + signalValue(signals, key), 0);
}

function signalValue(signals: Citation["match_signals"], key: CitationMatchSignalKey) {
  const value = signals?.[key];
  const numeric = typeof value === "number" ? value : Number(value ?? 0);

  return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
}

function roundSignalScore(value: number) {
  return Number(value.toFixed(2));
}

function matchSignalBarClass(key: MatchSignalBucketKey) {
  switch (key) {
    case "content":
      return "bg-cyan-600";
    case "summary":
      return "bg-emerald-600";
    case "keywords":
      return "bg-amber-600";
    case "synonyms":
      return "bg-rose-600";
    case "metadata":
      return "bg-slate-500";
    case "semantic":
      return "bg-blue-600";
  }
}

function matchSignalBadgeClass(key: MatchSignalBucketKey) {
  switch (key) {
    case "content":
      return "bg-cyan-50 text-cyan-700 ring-cyan-100";
    case "summary":
      return "bg-emerald-50 text-emerald-700 ring-emerald-100";
    case "keywords":
      return "bg-amber-50 text-amber-700 ring-amber-100";
    case "synonyms":
      return "bg-rose-50 text-rose-700 ring-rose-100";
    case "metadata":
      return "bg-slate-100 text-slate-700 ring-slate-200";
    case "semantic":
      return "bg-blue-50 text-blue-700 ring-blue-100";
  }
}

type FailureTraceOverview = ReturnType<typeof buildFailureTraceOverview>;
type QaFailureTrace = ReturnType<typeof buildQaFailureTrace>;

function FailureTracePanel({
  overview,
  onFilterChange
}: {
  overview: FailureTraceOverview;
  onFilterChange: (filter: QaFilter) => void;
}) {
  if (overview.totalRisk === 0) {
    return (
      <section className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
        <div className="flex items-start gap-3">
          <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-emerald-700" />
          <div>
            <h2 className="text-sm font-semibold text-emerald-900">失败反查暂未发现高风险问题</h2>
            <p className="mt-1 text-sm leading-6 text-emerald-800">
              已运行测试没有明显无引用、未命中、低覆盖或人工不通过问题。
            </p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="ui-card p-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 text-sm font-semibold text-ink">
            <AlertTriangle size={16} className="text-amber-700" />
            QA 失败反查
          </div>
          <p className="mt-1 text-sm leading-6 text-slate-500">
            按问题意图、缺失关键词和命中分片反查失败原因，优先定位该补资料还是该治理已有分片。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => onFilterChange("failed")} className="ui-button-secondary min-h-11 px-3 text-xs">
            不通过 {overview.failed}
          </button>
          <button type="button" onClick={() => onFilterChange("low_coverage")} className="ui-button-secondary min-h-11 px-3 text-xs">
            缺关键词 {overview.missingKeywordTests}
          </button>
          <button type="button" onClick={() => onFilterChange("knowledge_miss")} className="ui-button-secondary min-h-11 px-3 text-xs">
            未命中 {overview.knowledgeMiss}
          </button>
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-4">
        <RetrievalMetric label="风险题" value={overview.totalRisk} tone="warn" />
        <RetrievalMetric label="高风险" value={overview.highRisk} tone={overview.highRisk > 0 ? "warn" : "good"} />
        <RetrievalMetric label="意图类型" value={overview.intentRows.length} />
        <RetrievalMetric label="可疑来源" value={overview.chunkRows.length} tone={overview.chunkRows.length > 0 ? "warn" : "good"} />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
        <div className="rounded-lg border border-line">
          <div className="border-b border-line bg-slate-50 px-3 py-2">
            <h3 className="text-sm font-semibold text-ink">问题意图分布</h3>
          </div>
          <div className="divide-y divide-line">
            {overview.intentRows.map((row) => (
              <div key={row.intent} className="px-3 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-ink">{row.intent}</p>
                    <p className="mt-1 text-xs text-slate-500">{row.total} 题 · 高风险 {row.highRisk}</p>
                  </div>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${retrievalRiskClass(row.total)}`}>
                    {row.primaryCause}
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
                  <RetrievalChip label="无引用" value={row.noCitation} />
                  <RetrievalChip label="低覆盖" value={row.lowCoverage} />
                  <RetrievalChip label="未命中" value={row.knowledgeMiss} />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-line">
          <div className="border-b border-line bg-slate-50 px-3 py-2">
            <h3 className="text-sm font-semibold text-ink">可疑分片 / 来源</h3>
          </div>
          <div className="divide-y divide-line">
            {overview.chunkRows.slice(0, 6).map((row) => (
              <div key={row.id} className="px-3 py-3">
                <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-ink" title={row.source}>{row.source}</p>
                    <p className="mt-1 text-xs leading-5 text-slate-500">
                      {row.location || "未记录页码/段落"} · 关联 {row.tests} 题 · 风险 {row.riskTests}
                      {row.averageScore !== null ? ` · 相关度 ${row.averageScore}` : ""}
                    </p>
                    {row.missingKeywords.length > 0 && (
                      <p className="mt-1 line-clamp-1 text-xs text-amber-700">
                        缺：{row.missingKeywords.join("、")}
                      </p>
                    )}
                    {row.signalBadges.length > 0 && (
                      <SignalBadgeList badges={row.signalBadges} className="mt-2" />
                    )}
                  </div>
                  {row.documentId && (
                    <a
                      href={`/admin/documents?document=${encodeURIComponent(row.documentId)}${row.chunkId ? `&chunk=${encodeURIComponent(row.chunkId)}` : ""}`}
                      className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-lg border border-line bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      打开治理
                    </a>
                  )}
                </div>
              </div>
            ))}
            {overview.chunkRows.length === 0 && (
              <p className="px-3 py-6 text-center text-sm text-slate-500">
                风险题没有命中来源，优先补充知识或检查知识库范围。
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50/70">
        <div className="border-b border-amber-100 px-3 py-2">
          <h3 className="text-sm font-semibold text-amber-900">优先处理链路</h3>
        </div>
        <div className="divide-y divide-amber-100">
          {overview.traceRows.slice(0, 5).map((trace) => (
            <FailureTraceRow key={trace.id} trace={trace} />
          ))}
        </div>
      </div>
    </section>
  );
}

function FailureTraceRow({ trace }: { trace: QaFailureTrace }) {
  const topCitation = trace.citations[0] ?? null;

  return (
    <div className="px-3 py-3">
      <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
              trace.risk === "high" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"
            }`}>
              {trace.risk === "high" ? "高风险" : "中风险"}
            </span>
            <span className="rounded-full bg-white px-2 py-0.5 text-xs font-medium text-slate-600 ring-1 ring-amber-100">
              {trace.intent}
            </span>
          </div>
          <p className="mt-2 break-words text-sm font-semibold leading-5 text-ink">{trace.question}</p>
          <p className="mt-1 text-xs leading-5 text-amber-800">{trace.causes.join("；")}</p>
          {trace.missingKeywords.length > 0 && (
            <p className="mt-1 text-xs leading-5 text-slate-600">缺失关键词：{trace.missingKeywords.join("、")}</p>
          )}
          <p className="mt-1 text-xs leading-5 text-slate-500">
            定位：{topCitation ? `${topCitation.source}${topCitation.location ? ` · ${topCitation.location}` : ""}` : "未命中来源"}
          </p>
          {topCitation?.signalBuckets.length ? (
            <SignalBadgeList badges={topCitation.signalBuckets.slice(0, 3)} className="mt-2" />
          ) : null}
        </div>
        {topCitation?.documentId && (
          <a
            href={`/admin/documents?document=${encodeURIComponent(topCitation.documentId)}${topCitation.chunkId ? `&chunk=${encodeURIComponent(topCitation.chunkId)}` : ""}`}
            className="inline-flex min-h-10 shrink-0 items-center justify-center rounded-lg bg-amber-700 px-3 text-xs font-semibold text-white hover:bg-amber-800"
          >
            去治理
          </a>
        )}
      </div>
    </div>
  );
}

function buildFailureTraceOverview(tests: QaTestCase[], knowledgeBases: KnowledgeBase[]) {
  const traces = tests
    .map((test) => buildQaFailureTrace(test, knowledgeBases))
    .filter((trace) => trace.shouldTrace);
  const intentRows = new Map<string, {
    intent: string;
    total: number;
    highRisk: number;
    noCitation: number;
    lowCoverage: number;
    knowledgeMiss: number;
    causes: Map<string, number>;
  }>();
  const chunkRows = new Map<string, {
    id: string;
    source: string;
    documentId: string | null;
    chunkId: string | null;
    location: string;
    tests: Set<string>;
    riskTests: Set<string>;
    scoreTotal: number;
    scoreSamples: number;
    missingKeywords: Set<string>;
    signals: Map<MatchSignalBucketKey, number>;
  }>();

  for (const trace of traces) {
    const intentRow = intentRows.get(trace.intent) ?? {
      intent: trace.intent,
      total: 0,
      highRisk: 0,
      noCitation: 0,
      lowCoverage: 0,
      knowledgeMiss: 0,
      causes: new Map<string, number>()
    };
    intentRow.total += 1;
    intentRow.highRisk += trace.risk === "high" ? 1 : 0;
    intentRow.noCitation += trace.flags.noCitation ? 1 : 0;
    intentRow.lowCoverage += trace.flags.lowCoverage ? 1 : 0;
    intentRow.knowledgeMiss += trace.flags.knowledgeMiss ? 1 : 0;
    for (const cause of trace.causes) {
      intentRow.causes.set(cause, (intentRow.causes.get(cause) ?? 0) + 1);
    }
    intentRows.set(trace.intent, intentRow);

    for (const citation of trace.citations) {
      const key = citation.chunkId ?? `${citation.documentId ?? citation.source}:${citation.location}`;
      const row = chunkRows.get(key) ?? {
        id: key,
        source: citation.source,
        documentId: citation.documentId,
        chunkId: citation.chunkId,
        location: citation.location,
        tests: new Set<string>(),
        riskTests: new Set<string>(),
        scoreTotal: 0,
        scoreSamples: 0,
        missingKeywords: new Set<string>(),
        signals: new Map<MatchSignalBucketKey, number>()
      };
      row.tests.add(trace.id);
      row.riskTests.add(trace.id);
      if (typeof citation.score === "number" && Number.isFinite(citation.score)) {
        row.scoreTotal += citation.score;
        row.scoreSamples += 1;
      }
      for (const keyword of trace.missingKeywords) {
        row.missingKeywords.add(keyword);
      }
      for (const signal of citation.signalBuckets) {
        row.signals.set(signal.key, (row.signals.get(signal.key) ?? 0) + signal.score);
      }
      chunkRows.set(key, row);
    }
  }

  return {
    totalRisk: traces.length,
    highRisk: traces.filter((trace) => trace.risk === "high").length,
    failed: traces.filter((trace) => trace.flags.failed).length,
    knowledgeMiss: traces.filter((trace) => trace.flags.knowledgeMiss).length,
    missingKeywordTests: traces.filter((trace) => trace.missingKeywords.length > 0).length,
    intentRows: [...intentRows.values()]
      .map((row) => ({
        ...row,
        primaryCause: [...row.causes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "待复核"
      }))
      .sort((a, b) => b.highRisk - a.highRisk || b.total - a.total),
    chunkRows: [...chunkRows.values()]
      .map((row) => ({
        id: row.id,
        source: row.source,
        documentId: row.documentId,
        chunkId: row.chunkId,
        location: row.location,
        tests: row.tests.size,
        riskTests: row.riskTests.size,
        averageScore: row.scoreSamples > 0 ? Number((row.scoreTotal / row.scoreSamples).toFixed(2)) : null,
        missingKeywords: [...row.missingKeywords].slice(0, 6),
        signalBadges: signalBadgesFromMap(row.signals, 3)
      }))
      .sort((a, b) => b.riskTests - a.riskTests || b.tests - a.tests),
    traceRows: traces.sort((a, b) => {
      const riskDelta = (b.risk === "high" ? 1 : 0) - (a.risk === "high" ? 1 : 0);
      return riskDelta || a.qualityScore - b.qualityScore;
    })
  };
}

function buildQaFailureTrace(test: QaTestCase, knowledgeBases: KnowledgeBase[]) {
  const diagnostics = qaDiagnostics(test);
  const intent = classifyQaIntent(test);
  const citationCount = getCitationCount(test);
  const noCitation = Boolean(test.answer && citationCount === 0);
  const knowledgeMiss = Boolean(test.answer?.includes("未在知识库中找到明确依据"));
  const lowCoverage = Boolean(test.answer && test.expected_answer && diagnostics.coverage.coverage < 60);
  const failed = test.status === "failed";
  const notRun = !test.answer;
  const causes = [
    notRun ? "尚未运行" : "",
    failed ? "人工不通过" : "",
    noCitation ? "无引用来源" : "",
    knowledgeMiss ? "知识库未命中" : "",
    lowCoverage ? `期望覆盖 ${diagnostics.coverage.coverage}%` : "",
    diagnostics.messages.filter((message) => !["回答没有引用来源", "知识库可能未命中", "期望答案关键词覆盖偏低"].includes(message)).join("；")
  ].filter(Boolean);
  const selectedNames = knowledgeBases
    .filter((kb) => test.knowledge_base_ids.includes(kb.id))
    .map((kb) => kb.name);
  const citations = test.citations.map((citation, index) => ({
    source: citation.file_name ?? citation.url ?? "未知来源",
    documentId: citation.file_id ?? null,
    chunkId: citation.chunk_id ?? null,
    chunkIndex: citation.chunk_index,
    location: citationTraceLocation(citation),
    score: citation.score,
    quote: citation.quote,
    index: citation.index ?? index + 1,
    signalBuckets: citationSignalBuckets(citation).slice(0, 4),
    dominantSignalLabel: dominantCitationSignalLabel(citation)
  }));
  const shouldTrace = notRun || failed || noCitation || knowledgeMiss || lowCoverage || diagnostics.risk !== "low";

  return {
    id: test.id,
    question: test.question,
    intent,
    risk: noCitation || knowledgeMiss || diagnostics.coverage.coverage < 40 || failed ? "high" as const : "medium" as const,
    shouldTrace,
    qualityScore: diagnostics.qualityScore,
    missingKeywords: diagnostics.coverage.missing,
    causes: causes.length > 0 ? causes : ["建议人工复核"],
    knowledgeBases: selectedNames.join("、") || "未绑定知识库",
    citations,
    flags: {
      failed,
      noCitation,
      lowCoverage,
      knowledgeMiss,
      notRun
    }
  };
}

function citationTraceLocation(citation: Citation) {
  const parts: string[] = [];

  if (citation.chunk_index !== undefined) {
    parts.push(`分片 #${citation.chunk_index + 1}`);
  }
  if (citation.page) {
    parts.push(`第 ${citation.page} 页`);
  }
  if (citation.section) {
    parts.push(citation.section);
  }
  if (citation.sheet) {
    parts.push(`工作表：${citation.sheet}`);
  }
  if (citation.cell_range) {
    parts.push(citation.cell_range);
  }

  return parts.join(" · ");
}

function classifyQaIntent(test: QaTestCase) {
  const text = `${test.question} ${test.expected_answer ?? ""}`.toLowerCase();
  const rules: Array<{ label: string; keywords: string[] }> = [
    { label: "登录与账号", keywords: ["登录", "账号", "密码", "移动端", "企业账号", "权限"] },
    { label: "资料上传与维护", keywords: ["上传", "资料", "文档", "更新", "知识库", "附件"] },
    { label: "客户资料与业务", keywords: ["客户", "联系人", "地址", "业务", "kass", "开始云"] },
    { label: "培训学习", keywords: ["培训", "课程", "学习", "考试", "讲解", "完课"] },
    { label: "安全制度", keywords: ["安全", "消防", "劳保", "防护", "危险", "事故"] },
    { label: "质量与生产", keywords: ["质量", "首件", "不合格", "异常", "生产", "设备", "点检"] },
    { label: "审批流程", keywords: ["审批", "流程", "申请", "请假", "补卡", "报销"] },
    { label: "反馈与工单", keywords: ["反馈", "点踩", "工单", "人工", "整改"] }
  ];

  return rules.find((rule) => rule.keywords.some((keyword) => text.includes(keyword)))?.label ?? "通用问答";
}

function buildRetrievalEvaluation(tests: QaTestCase[], knowledgeBases: KnowledgeBase[]) {
  const kbById = new Map(knowledgeBases.map((kb) => [kb.id, kb]));
  const kbRows = new Map<string, {
    id: string;
    name: string;
    total: number;
    answered: number;
    riskCount: number;
    noCitation: number;
    lowCoverage: number;
    knowledgeMiss: number;
    failed: number;
    citationCount: number;
    coverageTotal: number;
    coverageSamples: number;
    qualityTotal: number;
    qualitySamples: number;
  }>();
  const documentRows = new Map<string, {
    id: string;
    name: string;
    citationCount: number;
    tests: Set<string>;
    riskTests: Set<string>;
    scoreTotal: number;
    scoreSamples: number;
    locations: Set<string>;
  }>();
  const matchSignalRows = new Map<MatchSignalBucketKey, { score: number; count: number }>();
  const dominantSignalRows = new Map<CitationDominantMatchSignal, number>();
  let answeredTests = 0;
  let noCitation = 0;
  let lowCoverage = 0;
  let knowledgeMiss = 0;
  let riskTests = 0;
  let citationTotal = 0;
  let loadedCitationTotal = 0;
  let signalCitationCount = 0;
  let coverageTotal = 0;
  let coverageSamples = 0;

  const riskRows: Array<{
    id: string;
    question: string;
    reason: string;
    knowledgeBases: string;
    sources: string;
    risk: "high" | "medium";
    score: number;
  }> = [];

  for (const test of tests) {
    const diagnostics = qaDiagnostics(test);
    const answered = Boolean(test.answer);
    const citationCount = getCitationCount(test);
    const testLowCoverage = Boolean(test.answer && test.expected_answer && diagnostics.coverage.coverage < 60);
    const testKnowledgeMiss = Boolean(test.answer?.includes("未在知识库中找到明确依据"));
    const testNoCitation = Boolean(test.answer && citationCount === 0);
    const risky = diagnostics.risk !== "low" || test.status === "failed";
    const kbIds = test.knowledge_base_ids.length > 0 ? test.knowledge_base_ids : ["__unscoped"];

    if (answered) {
      answeredTests += 1;
      citationTotal += citationCount;
      if (test.expected_answer) {
        coverageTotal += diagnostics.coverage.coverage;
        coverageSamples += 1;
      }
    }

    if (testNoCitation) {
      noCitation += 1;
    }
    if (testLowCoverage) {
      lowCoverage += 1;
    }
    if (testKnowledgeMiss) {
      knowledgeMiss += 1;
    }
    if (risky) {
      riskTests += 1;
      riskRows.push({
        id: test.id,
        question: test.question,
        reason: diagnostics.messages.join("；") || test.reviewer_note || "人工标记不通过",
        knowledgeBases: kbIds.map((id) => kbById.get(id)?.name ?? (id === "__unscoped" ? "未绑定知识库" : id)).join("、"),
        sources: test.citations.slice(0, 3).map(citationSourceLabel).filter(Boolean).join("、"),
        risk: diagnostics.risk === "high" || testNoCitation || testKnowledgeMiss ? "high" : "medium",
        score: diagnostics.qualityScore
      });
    }

    for (const kbId of kbIds) {
      const row = kbRows.get(kbId) ?? {
        id: kbId,
        name: kbById.get(kbId)?.name ?? (kbId === "__unscoped" ? "未绑定知识库" : kbId),
        total: 0,
        answered: 0,
        riskCount: 0,
        noCitation: 0,
        lowCoverage: 0,
        knowledgeMiss: 0,
        failed: 0,
        citationCount: 0,
        coverageTotal: 0,
        coverageSamples: 0,
        qualityTotal: 0,
        qualitySamples: 0
      };

      row.total += 1;
      row.answered += answered ? 1 : 0;
      row.riskCount += risky ? 1 : 0;
      row.noCitation += testNoCitation ? 1 : 0;
      row.lowCoverage += testLowCoverage ? 1 : 0;
      row.knowledgeMiss += testKnowledgeMiss ? 1 : 0;
      row.failed += test.status === "failed" ? 1 : 0;
      row.citationCount += citationCount;
      if (test.expected_answer && answered) {
        row.coverageTotal += diagnostics.coverage.coverage;
        row.coverageSamples += 1;
      }
      if (answered) {
        row.qualityTotal += diagnostics.qualityScore;
        row.qualitySamples += 1;
      }
      kbRows.set(kbId, row);
    }

    for (const citation of test.citations) {
      loadedCitationTotal += 1;
      const signalBuckets = citationSignalBuckets(citation);
      const dominantSignal = dominantCitationSignal(citation);

      if (signalBuckets.length > 0) {
        signalCitationCount += 1;
      }
      if (dominantSignal) {
        dominantSignalRows.set(dominantSignal, (dominantSignalRows.get(dominantSignal) ?? 0) + 1);
      }
      for (const signal of signalBuckets) {
        const current = matchSignalRows.get(signal.key) ?? { score: 0, count: 0 };
        current.score += signal.score;
        current.count += 1;
        matchSignalRows.set(signal.key, current);
      }

      const key = citation.file_id ?? citation.file_name ?? citation.url ?? "unknown";
      const row = documentRows.get(key) ?? {
        id: key,
        name: citation.file_name ?? citation.url ?? "未知来源",
        citationCount: 0,
        tests: new Set<string>(),
        riskTests: new Set<string>(),
        scoreTotal: 0,
        scoreSamples: 0,
        locations: new Set<string>()
      };

      row.citationCount += 1;
      row.tests.add(test.id);
      if (risky) {
        row.riskTests.add(test.id);
      }
      if (typeof citation.score === "number" && Number.isFinite(citation.score)) {
        row.scoreTotal += citation.score;
        row.scoreSamples += 1;
      }
      const location = citationLocationLabel(citation);
      if (location) {
        row.locations.add(location);
      }
      documentRows.set(key, row);
    }
  }

  const matchSignalScoreTotal = [...matchSignalRows.values()].reduce((total, row) => total + row.score, 0);

  return {
    answeredTests,
    riskTests,
    riskRate: answeredTests > 0 ? Math.round((riskTests / answeredTests) * 100) : 0,
    noCitation,
    lowCoverage,
    knowledgeMiss,
    averageCitations: answeredTests > 0 ? citationTotal / answeredTests : 0,
    averageCoverage: coverageSamples > 0 ? Math.round(coverageTotal / coverageSamples) : 100,
    loadedCitationTotal,
    signalCitationCount,
    signalCoverageRate: loadedCitationTotal > 0 ? Math.round((signalCitationCount / loadedCitationTotal) * 100) : 0,
    matchSignalRows: matchSignalBucketDefinitions
      .map((definition) => {
        const row = matchSignalRows.get(definition.key) ?? { score: 0, count: 0 };
        return {
          key: definition.key,
          label: definition.label,
          score: Number(row.score.toFixed(2)),
          count: row.count,
          percent: matchSignalScoreTotal > 0 ? Math.round((row.score / matchSignalScoreTotal) * 100) : 0
        };
      })
      .filter((row) => row.count > 0)
      .sort((a, b) => b.score - a.score),
    dominantSignalRows: [...dominantSignalRows.entries()]
      .map(([key, count]) => ({
        key,
        label: dominantMatchSignalLabels[key],
        count,
        percent: signalCitationCount > 0 ? Math.round((count / signalCitationCount) * 100) : 0
      }))
      .sort((a, b) => b.count - a.count),
    knowledgeBaseRows: [...kbRows.values()]
      .map((row) => ({
        ...row,
        averageCoverage: row.coverageSamples > 0 ? Math.round(row.coverageTotal / row.coverageSamples) : 100,
        averageQuality: row.qualitySamples > 0 ? Math.round(row.qualityTotal / row.qualitySamples) : 0
      }))
      .sort((a, b) => b.riskCount - a.riskCount || b.noCitation - a.noCitation || b.total - a.total),
    documentRows: [...documentRows.values()]
      .map((row) => ({
        id: row.id,
        name: row.name,
        citationCount: row.citationCount,
        testCount: row.tests.size,
        riskTests: row.riskTests.size,
        averageScore: row.scoreSamples > 0 ? Number((row.scoreTotal / row.scoreSamples).toFixed(2)) : null,
        locations: [...row.locations].slice(0, 4)
      }))
      .sort((a, b) => b.riskTests - a.riskTests || b.citationCount - a.citationCount),
    riskRows: riskRows.sort((a, b) => {
      const riskDelta = (b.risk === "high" ? 1 : 0) - (a.risk === "high" ? 1 : 0);
      return riskDelta || a.score - b.score;
    })
  };
}

function citationSourceLabel(citation: Citation) {
  const location = citationLocationLabel(citation);
  const source = citation.file_name ?? citation.url ?? "未知来源";
  return location ? `${source}（${location}）` : source;
}

function citationLocationLabel(citation: Citation) {
  const parts: string[] = [];

  if (citation.page) {
    parts.push(`第 ${citation.page} 页`);
  }
  if (citation.section) {
    parts.push(citation.section);
  }
  if (citation.sheet) {
    parts.push(`工作表：${citation.sheet}`);
  }
  if (citation.cell_range) {
    parts.push(citation.cell_range);
  }

  return parts.join(" · ");
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}

function isTransientQaLoadError(message: string) {
  const normalized = message.toLowerCase();
  return normalized.includes("timeout") ||
    normalized.includes("etimedout") ||
    normalized.includes("connection lost") ||
    message.includes("连接") ||
    message.includes("超时");
}

function wait(ms: number) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function formatTokenCount(value: number) {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }

  if (value >= 10_000) {
    return `${Math.round(value / 1000)}K`;
  }

  if (value >= 1000) {
    return `${(value / 1000).toFixed(1)}K`;
  }

  return String(value);
}

function formatSignedPercent(value: number) {
  return `${value > 0 ? "+" : ""}${value}%`;
}

function formatSignedNumber(value: number) {
  return `${value > 0 ? "+" : ""}${value}`;
}

function deltaTone(value: number): "good" | "warn" | undefined {
  if (value > 0) {
    return "good";
  }

  if (value < 0) {
    return "warn";
  }

  return undefined;
}

function inverseDeltaTone(value: number): "good" | "warn" | undefined {
  if (value < 0) {
    return "good";
  }

  if (value > 0) {
    return "warn";
  }

  return undefined;
}

function formatUsd(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "未配置价格";
  }

  if (value === 0) {
    return "$0";
  }

  if (value < 0.01) {
    return `$${value.toFixed(4)}`;
  }

  return `$${value.toFixed(2)}`;
}

function BatchRunButton({
  label,
  count,
  running,
  strong,
  onClick
}: {
  label: string;
  count: number;
  running: boolean;
  strong?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={running || count === 0}
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-3 text-sm font-semibold transition disabled:bg-slate-100 disabled:text-slate-300 ${
        strong
          ? "bg-amber-600 text-white hover:bg-amber-700"
          : "border border-line bg-white text-slate-700 hover:bg-slate-50"
      }`}
    >
      {running ? <Loader2 className="animate-spin" size={15} /> : <Play size={15} />}
      {label}
      <span className={`rounded-full px-2 py-0.5 text-xs ${
        strong ? "bg-white/20 text-white" : "bg-slate-100 text-slate-600"
      }`}>
        {count}
      </span>
    </button>
  );
}

function toBatchProgress(job: QaBatchJob, mode: BatchRunMode, label: string): BatchProgress {
  const progressMode: BatchProgress["mode"] = job.status === "completed"
    ? "done"
    : job.status === "canceled"
      ? "stopped"
      : job.status === "failed"
        ? "failed"
        : job.status;

  return {
    mode: progressMode,
    runMode: mode,
    label,
    total: job.total,
    completed: job.completed,
    ready: job.ready,
    autoFailed: job.auto_failed,
    failed: job.failed,
    currentQuestion: job.current_question ?? (job.status === "queued" ? "后台任务排队中" : "等待开始"),
    errors: job.errors.slice(-5)
  };
}

function isTerminalBatchJob(status: QaBatchJob["status"]) {
  return status === "completed" || status === "failed" || status === "canceled";
}

function toRemediationRetestProgress(job: KnowledgeTaskRetestBatchJob, label = "待整改复测"): RemediationRetestProgress {
  const progressMode: RemediationRetestProgress["mode"] = job.status === "completed"
    ? "done"
    : job.status === "canceled"
      ? "stopped"
      : job.status === "failed"
        ? "failed"
        : job.status;

  return {
    mode: progressMode,
    label,
    total: job.total,
    completed: job.completed,
    resolved: job.resolved,
    processing: job.processing,
    ignored: job.ignored,
    failed: job.failed,
    currentQuestion: job.current_question ?? (job.status === "queued" ? "后台复测队列排队中" : "等待开始"),
    errors: job.errors.slice(-5)
  };
}

function isTerminalRetestBatchJob(status: KnowledgeTaskRetestBatchJob["status"]) {
  return status === "completed" || status === "failed" || status === "canceled";
}

function batchJobNotice(job: QaBatchJob, label: string) {
  const summary = `${label}批量运行：共 ${job.total} 条，已完成 ${job.completed} 条，运行成功 ${job.ready} 条，自动标记不通过 ${job.auto_failed} 条，接口失败 ${job.failed} 条。`;

  if (job.status === "canceled") {
    return `已停止${summary}`;
  }

  if (job.status === "failed") {
    return `批量运行异常结束。${summary}`;
  }

  return `${summary}`;
}

function BatchProgressPanel({
  progress,
  running,
  onStop
}: {
  progress: BatchProgress;
  running: boolean;
  onStop: () => void;
}) {
  const percent = progress.total > 0 ? Math.round((progress.completed / progress.total) * 100) : 0;
  const statusText = progress.mode === "queued"
    ? "排队中"
    : progress.mode === "running"
      ? "运行中"
      : progress.mode === "stopped"
        ? "已停止"
        : progress.mode === "failed"
          ? "运行失败"
          : "已完成";

  return (
    <section className="rounded-lg border border-cyan/30 bg-cyan/10 p-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold text-ink">批量运行进度</h2>
            <span className="rounded-full bg-white px-2.5 py-1 text-xs font-medium text-brand ring-1 ring-cyan/30">
              {statusText}
            </span>
            <span className="rounded-full bg-white px-2.5 py-1 text-xs font-medium text-slate-600 ring-1 ring-cyan/20">
              {progress.label}
            </span>
          </div>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            当前：{progress.currentQuestion || "等待开始"}
          </p>
        </div>
        {running && (
          <button
            type="button"
            onClick={onStop}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-amber-200 bg-white px-4 text-sm font-semibold text-amber-800 hover:bg-amber-50"
          >
            <Pause size={16} />
            停止
          </button>
        )}
      </div>
      <div className="mt-4 h-3 overflow-hidden rounded-full bg-white ring-1 ring-cyan/20">
        <div className="h-full bg-brand transition-all" style={{ width: `${percent}%` }} />
      </div>
      <div className="mt-3 grid gap-3 text-sm md:grid-cols-6">
        <ProgressMetric label="进度" value={`${progress.completed}/${progress.total}`} />
        <ProgressMetric label="完成率" value={`${percent}%`} />
        <ProgressMetric label="运行成功" value={progress.ready} tone="good" />
        <ProgressMetric label="自动不通过" value={progress.autoFailed} tone={progress.autoFailed > 0 ? "bad" : undefined} />
        <ProgressMetric label="接口失败" value={progress.failed} tone="bad" />
        <ProgressMetric label="剩余" value={Math.max(progress.total - progress.completed, 0)} />
      </div>
      {progress.errors.length > 0 && (
        <div className="mt-4 rounded-lg border border-red-100 bg-white p-3">
          <p className="text-xs font-semibold text-red-700">最近失败</p>
          <div className="mt-2 space-y-1 text-xs leading-5 text-red-700">
            {progress.errors.map((error) => (
              <p key={error}>{error}</p>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function RemediationRetestProgressPanel({
  progress,
  running,
  onStop
}: {
  progress: RemediationRetestProgress;
  running: boolean;
  onStop: () => void;
}) {
  const percent = progress.total > 0 ? Math.round((progress.completed / progress.total) * 100) : 0;
  const statusText = progress.mode === "queued"
    ? "排队中"
    : progress.mode === "running"
      ? "复测中"
      : progress.mode === "stopped"
        ? "已停止"
        : progress.mode === "failed"
          ? "复测失败"
          : "已完成";

  return (
    <section className="rounded-lg border border-emerald-200 bg-emerald-50 p-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold text-ink">整改复测队列</h2>
            <span className="rounded-full bg-white px-2.5 py-1 text-xs font-medium text-emerald-700 ring-1 ring-emerald-100">
              {statusText}
            </span>
            <span className="rounded-full bg-white px-2.5 py-1 text-xs font-medium text-slate-600 ring-1 ring-emerald-100">
              {progress.label}
            </span>
          </div>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            当前：{progress.currentQuestion || "等待开始"}
          </p>
        </div>
        {running && (
          <button
            type="button"
            onClick={onStop}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-amber-200 bg-white px-4 text-sm font-semibold text-amber-800 hover:bg-amber-50"
          >
            <Pause size={16} />
            停止
          </button>
        )}
      </div>
      <div className="mt-4 h-3 overflow-hidden rounded-full bg-white ring-1 ring-emerald-100">
        <div className="h-full bg-emerald-600 transition-all" style={{ width: `${percent}%` }} />
      </div>
      <div className="mt-3 grid gap-3 text-sm md:grid-cols-6">
        <ProgressMetric label="进度" value={`${progress.completed}/${progress.total}`} />
        <ProgressMetric label="完成率" value={`${percent}%`} />
        <ProgressMetric label="复测通过" value={progress.resolved} tone="good" />
        <ProgressMetric label="仍需整改" value={progress.processing} tone={progress.processing > 0 ? "bad" : undefined} />
        <ProgressMetric label="接口失败" value={progress.failed} tone="bad" />
        <ProgressMetric label="剩余" value={Math.max(progress.total - progress.completed, 0)} />
      </div>
      {progress.ignored > 0 && (
        <p className="mt-3 text-xs leading-5 text-slate-500">已忽略任务：{progress.ignored} 条。</p>
      )}
      {progress.errors.length > 0 && (
        <div className="mt-4 rounded-lg border border-red-100 bg-white p-3">
          <p className="text-xs font-semibold text-red-700">最近失败</p>
          <div className="mt-2 space-y-1 text-xs leading-5 text-red-700">
            {progress.errors.map((error) => (
              <p key={error}>{error}</p>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function ProgressMetric({
  label,
  value,
  tone
}: {
  label: string;
  value: string | number;
  tone?: "good" | "bad";
}) {
  const toneClass = tone === "good" ? "text-emerald-700" : tone === "bad" ? "text-red-700" : "text-ink";

  return (
    <div className="rounded-lg bg-white p-3 ring-1 ring-cyan/20">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className={`mt-1 text-lg font-semibold ${toneClass}`}>{value}</p>
    </div>
  );
}

function ReportList({
  title,
  items,
  emptyText
}: {
  title: string;
  items: Array<{ id: string; title: string; detail: string }>;
  emptyText: string;
}) {
  return (
    <section className="ui-card p-5">
      <h2 className="text-base font-semibold text-ink">{title}</h2>
      <div className="mt-3 space-y-3">
        {items.length > 0 ? (
          items.map((item) => (
            <div key={item.id} className="border-b border-slate-100 pb-3 last:border-b-0 last:pb-0">
              <p className="text-sm font-medium text-ink">{item.title}</p>
              <p className="mt-1 text-xs text-slate-500">{item.detail}</p>
            </div>
          ))
        ) : (
          <p className="text-sm text-slate-500">{emptyText}</p>
        )}
      </div>
    </section>
  );
}

function StrategyAnomalySchedulePanel({
  schedule,
  loading,
  saving,
  running,
  onScheduleChange,
  onRunNow
}: {
  schedule: QaStrategyAnomalySchedule | null;
  loading: boolean;
  saving: boolean;
  running: boolean;
  onScheduleChange: (input: QaStrategyAnomalyScheduleInput) => void;
  onRunNow: () => void;
}) {
  const [draftInterval, setDraftInterval] = useState(String(schedule?.interval_minutes ?? 1440));
  const [draftWindowDays, setDraftWindowDays] = useState(String(schedule?.window_days ?? 90));
  const [draftLimit, setDraftLimit] = useState(String(schedule?.limit ?? 20));
  const result = schedule?.last_result ?? null;
  const busy = loading || saving || running;

  useEffect(() => {
    setDraftInterval(String(schedule?.interval_minutes ?? 1440));
    setDraftWindowDays(String(schedule?.window_days ?? 90));
    setDraftLimit(String(schedule?.limit ?? 20));
  }, [schedule?.interval_minutes, schedule?.limit, schedule?.window_days]);

  return (
    <section className="ui-card p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="inline-flex items-center gap-2 rounded-full bg-cyan/10 px-2.5 py-1 text-xs font-semibold text-brand ring-1 ring-cyan/20">
            {loading ? <Loader2 className="animate-spin" size={14} /> : <CalendarClock size={14} />}
            策略异常巡检
          </div>
          <h2 className="mt-3 text-base font-semibold text-ink">自动发现异常并生成整改</h2>
          <p className="mt-1 text-sm leading-6 text-slate-500">
            定时扫描最近 QA 策略样本，把无引用、低覆盖或不通过问题转成整改任务；已有整改会自动跳过。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onRunNow}
            disabled={busy}
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-cyan/30 bg-cyan/10 px-3 text-xs font-semibold text-brand transition hover:bg-cyan/15 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {running ? <Loader2 className="animate-spin" size={13} /> : <RefreshCw size={13} />}
            立即巡检
          </button>
          <button
            type="button"
            onClick={() => onScheduleChange({ enabled: !schedule?.enabled })}
            disabled={loading || saving}
            className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border px-3 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${
              schedule?.enabled
                ? "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                : "border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100"
            }`}
          >
            {saving ? <Loader2 className="animate-spin" size={13} /> : <CalendarClock size={13} />}
            {schedule?.enabled ? "暂停巡检" : "开启巡检"}
          </button>
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-4">
        <RemediationMetric label="最近候选" value={result?.candidate_count ?? 0} tone={result?.candidate_count ? "warn" : "neutral"} />
        <RemediationMetric label="新增整改" value={result?.created_count ?? 0} tone={result?.created_count ? "good" : "neutral"} />
        <RemediationMetric label="已跳过" value={result?.skipped_count ?? 0} tone="neutral" />
        <RemediationMetric label="巡检次数" value={schedule?.run_count ?? 0} tone="neutral" />
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <label className="min-w-0 text-xs font-semibold text-slate-600">
          巡检间隔（分钟）
          <input
            type="number"
            min={30}
            max={20160}
            value={draftInterval}
            disabled={loading || saving}
            onChange={(event) => setDraftInterval(event.target.value)}
            onBlur={() => onScheduleChange({ interval_minutes: Number(draftInterval) })}
            className="mt-1 min-h-11 w-full rounded-lg border border-line bg-white px-3 text-sm font-semibold text-ink outline-none transition focus:border-cyan/40 focus:ring-2 focus:ring-cyan/15 disabled:bg-slate-50 disabled:text-slate-400"
          />
        </label>
        <label className="min-w-0 text-xs font-semibold text-slate-600">
          样本窗口（天）
          <input
            type="number"
            min={7}
            max={365}
            value={draftWindowDays}
            disabled={loading || saving}
            onChange={(event) => setDraftWindowDays(event.target.value)}
            onBlur={() => onScheduleChange({ window_days: Number(draftWindowDays) })}
            className="mt-1 min-h-11 w-full rounded-lg border border-line bg-white px-3 text-sm font-semibold text-ink outline-none transition focus:border-cyan/40 focus:ring-2 focus:ring-cyan/15 disabled:bg-slate-50 disabled:text-slate-400"
          />
        </label>
        <label className="min-w-0 text-xs font-semibold text-slate-600">
          单次上限
          <input
            type="number"
            min={1}
            max={50}
            value={draftLimit}
            disabled={loading || saving}
            onChange={(event) => setDraftLimit(event.target.value)}
            onBlur={() => onScheduleChange({ limit: Number(draftLimit) })}
            className="mt-1 min-h-11 w-full rounded-lg border border-line bg-white px-3 text-sm font-semibold text-ink outline-none transition focus:border-cyan/40 focus:ring-2 focus:ring-cyan/15 disabled:bg-slate-50 disabled:text-slate-400"
          />
        </label>
      </div>

      <div className="mt-3 rounded-lg border border-line bg-slate-50 px-3 py-3 text-xs leading-5 text-slate-600">
        {strategyAnomalyScheduleStatusText(schedule, loading)}
      </div>
    </section>
  );
}

function RemediationLoopPanel({
  stats,
  status,
  trend,
  schedule,
  scheduleLoading,
  scheduleSaving,
  retesting,
  onFilterChange,
  onRefresh,
  onRunRetestBatch,
  onRunScheduledRetestNow,
  onScheduleChange
}: {
  stats: ReturnType<typeof buildRemediationLoopStats>;
  status: "ready" | "timeout";
  trend: QaRemediationRetestTrend | null;
  schedule: KnowledgeTaskRetestSchedule | null;
  scheduleLoading: boolean;
  scheduleSaving: boolean;
  retesting: boolean;
  onFilterChange: (filter: QaFilter) => void;
  onRefresh: () => void;
  onRunRetestBatch: () => void;
  onRunScheduledRetestNow: () => void;
  onScheduleChange: (input: KnowledgeTaskRetestScheduleInput) => void;
}) {
  const hasTasks = stats.total > 0;
  const isTimeout = status === "timeout";
  const openCount = stats.pending + stats.processing;
  const retestPassRate = trend && trend.total_retests > 0
    ? Math.round((trend.resolved / trend.total_retests) * 100)
    : 0;
  const maxDailyRetests = Math.max(...(trend?.daily.map((item) => item.total) ?? [0]), 1);

  return (
    <section className="ui-card p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800 ring-1 ring-amber-100">
            <ListTodo size={14} />
            整改闭环
          </div>
          <h2 className="mt-3 text-base font-semibold text-ink">整改任务与自动复测</h2>
          <p className="mt-1 text-sm leading-6 text-slate-500">
            生成整改后在这里看处理进度；补知识并复测后，复测结论会回写到对应 QA 卡片。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onRunRetestBatch}
            disabled={retesting || openCount === 0}
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 text-xs font-semibold text-emerald-800 hover:bg-emerald-100 disabled:border-line disabled:bg-slate-100 disabled:text-slate-400"
            title={openCount === 0 ? "当前没有待处理或处理中的整改任务" : "后台批量复测待整改任务"}
          >
            {retesting ? <Loader2 className="animate-spin" size={13} /> : <RefreshCw size={13} />}
            复测待整改
          </button>
          {isTimeout && (
            <button
              type="button"
              onClick={onRefresh}
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-cyan/30 bg-cyan/10 px-3 text-xs font-semibold text-brand hover:bg-cyan/15"
            >
              <RefreshCw size={13} />
              重读整改
            </button>
          )}
          <button
            type="button"
            onClick={() => onFilterChange("failed")}
            className="inline-flex min-h-10 items-center justify-center rounded-lg border border-line bg-white px-3 text-xs font-semibold text-slate-700 hover:border-amber-200 hover:bg-amber-50"
          >
            查看不通过
          </button>
          <a
            href="/admin/insights"
            className="inline-flex min-h-10 items-center justify-center rounded-lg border border-amber-200 bg-amber-50 px-3 text-xs font-semibold text-amber-800 hover:bg-amber-100"
          >
            处理整改
          </a>
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <RemediationMetric label="整改任务" value={stats.total} tone="neutral" />
        <RemediationMetric label="待处理" value={stats.pending} tone="warn" />
        <RemediationMetric label="处理中" value={stats.processing} tone="info" />
        <RemediationMetric label="复测通过" value={stats.resolved} tone="good" />
        <RemediationMetric label="已复测" value={stats.retested} tone="neutral" />
      </div>

      <div className="mt-4 rounded-lg border border-cyan/15 bg-cyan/5 p-3">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white text-brand ring-1 ring-cyan/20">
              {scheduleLoading ? <Loader2 className="animate-spin" size={16} /> : <CalendarClock size={16} />}
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-semibold text-ink">自动复测计划</h3>
                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                  schedule?.enabled ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100" : "bg-slate-100 text-slate-600 ring-1 ring-slate-200"
                }`}>
                  {schedule?.enabled ? "已开启" : "未开启"}
                </span>
              </div>
              <p className="mt-1 text-xs leading-5 text-slate-600">
                {scheduleStatusText(schedule, scheduleLoading)}
              </p>
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-[minmax(120px,150px)_minmax(110px,130px)_auto_auto] sm:items-center">
            <label className="block">
              <span className="sr-only">自动复测间隔</span>
              <select
                value={schedule?.interval_minutes ?? 1440}
                onChange={(event) => onScheduleChange({ interval_minutes: Number(event.target.value) })}
                disabled={scheduleLoading || scheduleSaving}
                className="h-10 w-full rounded-lg border border-cyan/20 bg-white px-3 text-xs font-semibold text-slate-700 outline-none focus:border-brand disabled:bg-slate-100 disabled:text-slate-400"
              >
                <option value={60}>每小时</option>
                <option value={360}>每 6 小时</option>
                <option value={720}>每 12 小时</option>
                <option value={1440}>每天</option>
                <option value={10080}>每周</option>
              </select>
            </label>
            <label className="block">
              <span className="sr-only">单次复测数量</span>
              <select
                value={schedule?.limit ?? 20}
                onChange={(event) => onScheduleChange({ limit: Number(event.target.value) })}
                disabled={scheduleLoading || scheduleSaving}
                className="h-10 w-full rounded-lg border border-cyan/20 bg-white px-3 text-xs font-semibold text-slate-700 outline-none focus:border-brand disabled:bg-slate-100 disabled:text-slate-400"
              >
                <option value={10}>每次 10 条</option>
                <option value={20}>每次 20 条</option>
                <option value={50}>每次 50 条</option>
              </select>
            </label>
            <button
              type="button"
              onClick={() => onScheduleChange({ enabled: !schedule?.enabled })}
              disabled={scheduleLoading || scheduleSaving}
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-cyan/25 bg-white px-3 text-xs font-semibold text-brand hover:bg-cyan/10 disabled:bg-slate-100 disabled:text-slate-400"
            >
              {scheduleSaving ? <Loader2 className="animate-spin" size={13} /> : <CalendarClock size={13} />}
              {schedule?.enabled ? "暂停计划" : "开启计划"}
            </button>
            <button
              type="button"
              onClick={onRunScheduledRetestNow}
              disabled={scheduleLoading || scheduleSaving || retesting}
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 text-xs font-semibold text-emerald-800 hover:bg-emerald-100 disabled:border-line disabled:bg-slate-100 disabled:text-slate-400"
            >
              {retesting ? <Loader2 className="animate-spin" size={13} /> : <RefreshCw size={13} />}
              立即按计划复测
            </button>
          </div>
        </div>
      </div>

      {trend && trend.total_retests > 0 && (
        <div className="mt-4 rounded-lg border border-emerald-100 bg-emerald-50/70 p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h3 className="text-sm font-semibold text-ink">复测趋势</h3>
              <p className="mt-1 text-xs leading-5 text-slate-600">
                累计复测 {trend.total_retests} 次，覆盖 {trend.retested_task_count}/{trend.task_count} 个整改任务，通过率 {retestPassRate}%。
              </p>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center text-xs sm:min-w-[320px]">
              <TrendBadge label="通过" value={trend.resolved} tone="good" />
              <TrendBadge label="仍需整改" value={trend.processing} tone="warn" />
              <TrendBadge label="异常/忽略" value={trend.failed + trend.ignored} tone="muted" />
            </div>
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-7">
            {trend.daily.map((item) => (
              <div key={item.date} className="rounded-lg bg-white p-2 ring-1 ring-emerald-100">
                <div className="flex h-16 items-end gap-1">
                  <div
                    className="w-full rounded-t bg-emerald-500"
                    style={{ height: `${Math.max((item.resolved / maxDailyRetests) * 100, item.resolved > 0 ? 10 : 0)}%` }}
                    title={`通过 ${item.resolved}`}
                  />
                  <div
                    className="w-full rounded-t bg-amber-400"
                    style={{ height: `${Math.max((item.processing / maxDailyRetests) * 100, item.processing > 0 ? 10 : 0)}%` }}
                    title={`仍需整改 ${item.processing}`}
                  />
                  <div
                    className="w-full rounded-t bg-slate-300"
                    style={{ height: `${Math.max(((item.failed + item.ignored) / maxDailyRetests) * 100, item.failed + item.ignored > 0 ? 10 : 0)}%` }}
                    title={`异常/忽略 ${item.failed + item.ignored}`}
                  />
                </div>
                <p className="mt-2 truncate text-center text-[11px] font-medium text-slate-500">{formatShortDate(item.date)}</p>
                <p className="text-center text-xs font-semibold text-ink">{item.total}</p>
              </div>
            ))}
          </div>
          {trend.latest.length > 0 && (
            <div className="mt-4 grid gap-2 lg:grid-cols-2">
              {trend.latest.slice(0, 2).map((item) => (
                <div key={`${item.id}-${item.time}`} className="rounded-lg border border-emerald-100 bg-white px-3 py-2">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className={`rounded-full px-2 py-0.5 font-semibold ${retestOutcomeClass(item.outcome)}`}>
                      {retestOutcomeLabel(item.outcome)}
                    </span>
                    <span className="text-slate-500">{item.time}</span>
                  </div>
                  <p className="mt-1 line-clamp-1 text-sm font-medium text-ink">{item.question}</p>
                  <p className="mt-0.5 line-clamp-1 text-xs text-slate-500">{item.conclusion}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {isTimeout && !hasTasks ? (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-4 text-sm leading-6 text-amber-800">
          整改任务读取超时，QA 主列表已先显示。可以点“重读整改”刷新状态，或到洞察页处理整改任务。
        </div>
      ) : hasTasks ? (
        stats.latestRetests.length > 0 ? (
          <div className="mt-4 grid gap-3 lg:grid-cols-3">
            {stats.latestRetests.map((item) => (
              <div key={item.id} className="rounded-lg border border-line bg-slate-50 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${remediationStatusClass(item.status)}`}>
                    {remediationStatusLabel[item.status]}
                  </span>
                  <span className="text-xs text-slate-500">{item.latest_retest?.time ?? formatLocalDateTime(item.updated_at)}</span>
                </div>
                <p className="mt-2 line-clamp-2 text-sm font-medium leading-6 text-ink">{item.question}</p>
                <p className="mt-1 text-xs leading-5 text-slate-600">{item.latest_retest?.conclusion ?? "暂无复测结论"}</p>
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-4 rounded-lg border border-dashed border-line bg-slate-50 px-3 py-4 text-sm leading-6 text-slate-500">
            已生成整改任务，但还没有自动复测记录。处理资料后可在单题里“补知识并复测”，或到洞察页执行自动复测。
          </div>
        )
      ) : (
        <div className="mt-4 rounded-lg border border-dashed border-line bg-slate-50 px-3 py-4 text-sm leading-6 text-slate-500">
          暂无 QA 整改任务。运行测试后，可对无引用、低覆盖或不通过问题生成整改。
        </div>
      )}
    </section>
  );
}

function RemediationMetric({
  label,
  value,
  tone
}: {
  label: string;
  value: number;
  tone: "neutral" | "warn" | "info" | "good";
}) {
  const toneClass = {
    neutral: "text-ink",
    warn: "text-amber-700",
    info: "text-cyan-700",
    good: "text-emerald-700"
  }[tone];

  return (
    <div className="rounded-lg border border-line bg-white px-3 py-3">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${toneClass}`}>{value}</p>
    </div>
  );
}

function TrendBadge({
  label,
  value,
  tone
}: {
  label: string;
  value: number;
  tone: "good" | "warn" | "muted";
}) {
  const toneClass = {
    good: "text-emerald-700",
    warn: "text-amber-700",
    muted: "text-slate-600"
  }[tone];

  return (
    <div className="rounded-lg bg-white px-3 py-2 ring-1 ring-emerald-100">
      <p className="text-slate-500">{label}</p>
      <p className={`mt-1 text-base font-semibold ${toneClass}`}>{value}</p>
    </div>
  );
}

function scheduleStatusText(schedule: KnowledgeTaskRetestSchedule | null, loading: boolean) {
  if (loading) {
    return "正在读取计划状态。";
  }

  if (!schedule) {
    return "计划状态暂不可用，手动复测不受影响。";
  }

  const parts = [
    schedule.enabled
      ? `按${formatScheduleInterval(schedule.interval_minutes)}自动复测，每次最多 ${schedule.limit} 条`
      : `计划已暂停，保留${formatScheduleInterval(schedule.interval_minutes)}与每次 ${schedule.limit} 条设置`,
    schedule.next_run_at ? `下次 ${formatLocalDateTime(schedule.next_run_at)}` : "",
    schedule.last_run_at ? `上次 ${formatLocalDateTime(schedule.last_run_at)}${schedule.last_job_status ? `（${scheduleJobStatusLabel(schedule.last_job_status)}）` : ""}` : "",
    schedule.last_error ? `最近异常：${schedule.last_error}` : ""
  ].filter(Boolean);

  return parts.join("；");
}

function strategyAnomalyScheduleStatusText(schedule: QaStrategyAnomalySchedule | null, loading: boolean) {
  if (loading) {
    return "正在读取策略异常巡检计划。";
  }

  if (!schedule) {
    return "巡检计划暂不可用，手动生成相关整改不受影响。";
  }

  const result = schedule.last_result;
  const parts = [
    schedule.enabled
      ? `按${formatScheduleInterval(schedule.interval_minutes)}巡检近 ${schedule.window_days} 天 QA 样本，每次最多 ${schedule.limit} 条`
      : `巡检已暂停，保留近 ${schedule.window_days} 天与每次 ${schedule.limit} 条设置`,
    schedule.next_run_at ? `下次 ${formatLocalDateTime(schedule.next_run_at)}` : "",
    schedule.last_run_at ? `上次 ${formatLocalDateTime(schedule.last_run_at)}` : "",
    result
      ? `最近发现 ${result.candidate_count} 条候选，新增 ${result.created_count} 条，跳过 ${result.skipped_count} 条`
      : "",
    schedule.last_error ? `最近异常：${schedule.last_error}` : ""
  ].filter(Boolean);

  return parts.join("；");
}

function formatScheduleInterval(minutes: number) {
  if (minutes >= 60 * 24 * 7 && minutes % (60 * 24 * 7) === 0) {
    const weeks = minutes / (60 * 24 * 7);
    return weeks === 1 ? "每周" : `每 ${weeks} 周`;
  }

  if (minutes >= 60 * 24 && minutes % (60 * 24) === 0) {
    const days = minutes / (60 * 24);
    return days === 1 ? "每天" : `每 ${days} 天`;
  }

  if (minutes >= 60 && minutes % 60 === 0) {
    const hours = minutes / 60;
    return hours === 1 ? "每小时" : `每 ${hours} 小时`;
  }

  return `每 ${minutes} 分钟`;
}

function scheduleJobStatusLabel(status: KnowledgeTaskRetestSchedule["last_job_status"]) {
  if (status === "queued") {
    return "排队中";
  }

  if (status === "running") {
    return "运行中";
  }

  if (status === "completed") {
    return "已完成";
  }

  if (status === "failed") {
    return "失败";
  }

  if (status === "canceled") {
    return "已停止";
  }

  if (status === "expired") {
    return "状态已过期";
  }

  return "未知";
}

function retestOutcomeLabel(outcome: QaRemediationRetestTrend["latest"][number]["outcome"]) {
  if (outcome === "resolved") {
    return "通过";
  }

  if (outcome === "ignored") {
    return "忽略";
  }

  if (outcome === "failed") {
    return "异常";
  }

  return "仍需整改";
}

function retestOutcomeClass(outcome: QaRemediationRetestTrend["latest"][number]["outcome"]) {
  if (outcome === "resolved") {
    return "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100";
  }

  if (outcome === "failed") {
    return "bg-red-50 text-red-700 ring-1 ring-red-100";
  }

  if (outcome === "ignored") {
    return "bg-slate-100 text-slate-600 ring-1 ring-slate-200";
  }

  return "bg-amber-50 text-amber-800 ring-1 ring-amber-100";
}

function TestCard({
  test,
  usage,
  remediation,
  knowledgeBases,
  running,
  saving,
  remediationRunning,
  supplementing,
  onRun,
  onReview,
  onCreateRemediation,
  onSupplementAndRetest
}: {
  test: QaTestCase;
  usage: QaUsageByTest[string] | null;
  remediation: QaRemediationTaskSummary | null;
  knowledgeBases: KnowledgeBase[];
  running: boolean;
  saving: boolean;
  remediationRunning: boolean;
  supplementing: boolean;
  onRun: () => void;
  onReview: (status: QaTestStatus, note?: string | null) => void;
  onCreateRemediation: () => void;
  onSupplementAndRetest: (input: QaSupplementInput) => void;
}) {
  const [note, setNote] = useState(test.reviewer_note ?? "");
  const [supplementOpen, setSupplementOpen] = useState(false);
  const selectedNames = knowledgeBases
    .filter((kb) => test.knowledge_base_ids.includes(kb.id))
    .map((kb) => kb.name)
    .join("、");
  const diagnostics = qaDiagnostics(test);
  const shouldShowRemediation =
    !test.answer ||
    test.status === "failed" ||
    diagnostics.risk !== "low";
  const supplementKnowledgeBases = knowledgeBases.filter((kb) => test.knowledge_base_ids.includes(kb.id));
  const availableKnowledgeBases = supplementKnowledgeBases.length > 0 ? supplementKnowledgeBases : knowledgeBases;
  const failureTrace = buildQaFailureTrace(test, knowledgeBases);
  const hasRemediation = Boolean(remediation);

  useEffect(() => {
    setNote(test.reviewer_note ?? "");
  }, [test.reviewer_note]);

  return (
    <article id={`qa-test-${test.id}`} className="ui-card scroll-mt-24 p-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${statusClass(test.status)}`}>
              {statusLabel[test.status]}
            </span>
            {test.latency_ms !== null && <span className="text-xs text-slate-500">{test.latency_ms}ms</span>}
            {test.model && <span className="text-xs text-slate-500">{test.model}</span>}
            {usage && (
              <span className="text-xs text-slate-500">
                最近用量：{formatTokenCount(usage.last_total_tokens)} token · {formatUsd(usage.last_cost_usd)}
                {usage.last_estimated ? " · 估算" : ""}
              </span>
            )}
          </div>
          <h3 className="mt-3 text-base font-semibold text-ink">{test.question}</h3>
          <p className="mt-1 text-xs text-slate-500">知识库：{selectedNames || "未选择"}</p>
          {usage && (
            <p className="mt-1 text-xs text-slate-500">
              输入 {formatTokenCount(usage.last_input_tokens)} / 输出 {formatTokenCount(usage.last_output_tokens)}
              · 已运行 {usage.run_count} 次
              {usage.total_tokens !== usage.last_total_tokens ? ` · 累计 ${formatTokenCount(usage.total_tokens)} token` : ""}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {shouldShowRemediation && (
            hasRemediation ? (
              <a
                href="/admin/insights"
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 text-sm font-semibold text-amber-800 hover:bg-amber-100"
              >
                <ListTodo size={16} />
                继续整改
              </a>
            ) : (
              <button
                type="button"
                onClick={onCreateRemediation}
                disabled={remediationRunning}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 text-sm font-semibold text-amber-800 hover:bg-amber-100 disabled:bg-slate-100 disabled:text-slate-300"
              >
                {remediationRunning ? <Loader2 className="animate-spin" size={16} /> : <ListTodo size={16} />}
                生成整改
              </button>
            )
          )}
          {shouldShowRemediation && (
            <button
              type="button"
              onClick={() => setSupplementOpen((current) => !current)}
              disabled={supplementing}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-cyan/30 bg-cyan/10 px-3 text-sm font-semibold text-brand hover:bg-cyan/15 disabled:bg-slate-100 disabled:text-slate-300"
            >
              {supplementing ? <Loader2 className="animate-spin" size={16} /> : <FilePlus2 size={16} />}
              {supplementOpen ? "收起补充" : "补知识并复测"}
            </button>
          )}
          <button
            type="button"
            onClick={onRun}
            disabled={running}
            className="ui-button-primary min-h-11"
          >
            {running ? <Loader2 className="animate-spin" size={16} /> : <Play size={16} />}
            运行
          </button>
        </div>
      </div>

      {test.expected_answer && (
        <div className="mt-4 ui-card-muted p-3">
          <p className="text-xs font-medium text-slate-500">期望答案</p>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">{test.expected_answer}</p>
        </div>
      )}

      {test.answer && (
        <div className="mt-4 rounded-lg border border-cyan/20 bg-cyan/10 p-3">
          <p className="text-xs font-medium text-brand">AI 回答</p>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-ink">{test.answer}</p>
        </div>
      )}

      {test.answer && <QaDiagnosticsView diagnostics={diagnostics} />}

      {remediation && <QaRemediationInlineStatus remediation={remediation} />}

      {failureTrace.shouldTrace && <QaFailureTraceInline trace={failureTrace} />}

      {getCitationCount(test) > 0 && <CitationList citations={test.citations} totalCount={getCitationCount(test)} />}

      {supplementOpen && (
        <QaInlineSupplementPanel
          test={test}
          diagnostics={diagnostics}
          knowledgeBases={availableKnowledgeBases}
          saving={supplementing}
          onSubmit={onSupplementAndRetest}
        />
      )}

      <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_auto_auto]">
        <input
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="评审备注，例如：答案遗漏审批条件"
          className="h-11 rounded-lg border border-line px-3 text-sm outline-none focus:border-brand"
        />
        <button
          type="button"
          onClick={() => onReview("passed", note)}
          disabled={saving || !test.answer}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-emerald-200 px-3 text-sm font-semibold text-emerald-700 hover:bg-emerald-50 disabled:text-slate-300"
        >
          {saving ? <Loader2 className="animate-spin" size={15} /> : <CheckCircle2 size={15} />}
          通过
        </button>
        <button
          type="button"
          onClick={() => onReview("failed", note)}
          disabled={saving || !test.answer}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-red-200 px-3 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:text-slate-300"
        >
          {saving ? <Loader2 className="animate-spin" size={15} /> : <XCircle size={15} />}
          不通过
        </button>
      </div>
    </article>
  );
}

function QaRemediationInlineStatus({ remediation }: { remediation: QaRemediationTaskSummary }) {
  const latest = remediation.latest_retest;

  return (
    <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50/70 p-3">
      <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-amber-800 ring-1 ring-amber-100">
              <ListTodo size={13} />
              已建整改
            </span>
            <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${remediationStatusClass(remediation.status)}`}>
              {remediationStatusLabel[remediation.status]}
            </span>
            <span className="text-xs text-slate-500">更新：{formatLocalDateTime(remediation.updated_at)}</span>
          </div>
          <p className="mt-2 text-xs leading-5 text-slate-700">原因：{remediation.reason}</p>
          <p className="mt-1 text-xs leading-5 text-slate-600">建议：{remediation.suggestion}</p>
        </div>
        <a
          href="/admin/insights"
          className="inline-flex min-h-10 shrink-0 items-center justify-center rounded-lg border border-amber-200 bg-white px-3 text-xs font-semibold text-amber-800 hover:bg-amber-100"
        >
          去处理
        </a>
      </div>

      {remediation.missing_keywords.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {remediation.missing_keywords.map((keyword) => (
            <span key={keyword} className="rounded-full bg-white px-2.5 py-1 text-xs font-medium text-red-700 ring-1 ring-red-100">
              缺：{keyword}
            </span>
          ))}
        </div>
      )}

      {latest ? (
        <div className={`mt-3 rounded-lg border px-3 py-2 ${
          remediation.status === "resolved"
            ? "border-emerald-200 bg-emerald-50"
            : "border-white bg-white"
        }`}>
          <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-slate-700">
            <RefreshCw size={13} />
            最近复测
            <span className="rounded-full bg-white px-2 py-0.5 text-slate-500 ring-1 ring-black/5">{latest.time}</span>
          </div>
          <div className="mt-2 grid gap-2 text-xs leading-5 text-slate-700 md:grid-cols-3">
            <span>结论：{latest.conclusion}</span>
            {latest.citationCount && <span>引用：{latest.citationCount}</span>}
            {latest.coverage && <span>期望覆盖：{latest.coverage}</span>}
          </div>
          {latest.missingKeywords && (
            <p className="mt-2 text-xs leading-5 text-slate-600">仍缺关键词：{latest.missingKeywords}</p>
          )}
        </div>
      ) : (
        <p className="mt-3 rounded-lg bg-white px-3 py-2 text-xs leading-5 text-slate-600 ring-1 ring-amber-100">
          暂无复测记录。补充资料后可直接使用“补知识并复测”验证效果。
        </p>
      )}
    </div>
  );
}

function QaDiagnosticsView({ diagnostics }: { diagnostics: ReturnType<typeof qaDiagnostics> }) {
  const isLowRisk = diagnostics.risk === "low";
  const scoreTone = qualityScoreTone(diagnostics.qualityScore);

  return (
    <div className={`mt-4 rounded-lg border p-3 ${
      isLowRisk ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"
    }`}>
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <div className={`flex items-center gap-2 text-xs font-semibold ${
            isLowRisk ? "text-emerald-700" : "text-amber-800"
          }`}>
            {isLowRisk ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
            质检诊断
          </div>
          <div className="mt-2 grid gap-2 text-xs leading-5 text-slate-700 md:grid-cols-3">
            <span>引用：{diagnostics.citationCount} 个</span>
            <span>期望覆盖：{diagnostics.coverage.coverage}%</span>
            <span>缺失关键词：{diagnostics.coverage.missing.length > 0 ? diagnostics.coverage.missing.join("、") : "无"}</span>
          </div>
        </div>
        <div className="min-w-28 rounded-lg bg-white px-3 py-2 text-right ring-1 ring-black/5">
          <p className="text-xs font-medium text-slate-500">质量评分</p>
          <p className={`mt-1 text-2xl font-semibold ${scoreTone}`}>{diagnostics.qualityScore}</p>
          <p className="mt-1 text-xs text-slate-500">{qualityGradeLabel(diagnostics.qualityGrade)}</p>
        </div>
      </div>
      {diagnostics.messages.length > 0 && (
        <div className="mt-2 text-xs leading-5 text-slate-600">
          {diagnostics.messages.join("；")}
        </div>
      )}
      {diagnostics.deductions.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {diagnostics.deductions.map((item) => (
            <span key={`${item.reason}-${item.points}`} className="rounded-full bg-white px-2.5 py-1 text-xs font-medium text-slate-600 ring-1 ring-black/5">
              -{item.points} {item.reason}
            </span>
          ))}
        </div>
      )}
      <p className="mt-3 rounded-lg bg-white px-3 py-2 text-xs leading-5 text-slate-600 ring-1 ring-black/5">
        建议：{diagnostics.action}
      </p>
    </div>
  );
}

function QaFailureTraceInline({ trace }: { trace: QaFailureTrace }) {
  const primaryCitation = trace.citations[0] ?? null;

  return (
    <div className="mt-4 rounded-lg border border-amber-200 bg-white p-3">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
              trace.risk === "high" ? "bg-red-50 text-red-700 ring-1 ring-red-100" : "bg-amber-50 text-amber-700 ring-1 ring-amber-100"
            }`}>
              失败反查 · {trace.risk === "high" ? "高风险" : "中风险"}
            </span>
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
              {trace.intent}
            </span>
          </div>
          <p className="mt-2 text-xs leading-5 text-slate-600">
            原因：{trace.causes.join("；")}
          </p>
          {trace.missingKeywords.length > 0 && (
            <p className="mt-1 text-xs leading-5 text-amber-700">
              缺失关键词：{trace.missingKeywords.join("、")}
            </p>
          )}
          <p className="mt-1 text-xs leading-5 text-slate-500">
            {primaryCitation
              ? `命中：${primaryCitation.source}${primaryCitation.location ? ` · ${primaryCitation.location}` : ""}`
              : "没有命中可治理分片，建议先补充知识或检查知识库范围。"}
          </p>
          {primaryCitation?.signalBuckets.length ? (
            <SignalBadgeList badges={primaryCitation.signalBuckets.slice(0, 3)} className="mt-2" />
          ) : null}
        </div>
        {primaryCitation?.documentId && (
          <a
            href={`/admin/documents?document=${encodeURIComponent(primaryCitation.documentId)}${primaryCitation.chunkId ? `&chunk=${encodeURIComponent(primaryCitation.chunkId)}` : ""}`}
            className="inline-flex min-h-10 shrink-0 items-center justify-center rounded-lg border border-amber-200 bg-amber-50 px-3 text-xs font-semibold text-amber-800 hover:bg-amber-100"
          >
            打开资料治理
          </a>
        )}
      </div>
      {trace.citations.length > 1 && (
        <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
          {trace.citations.slice(0, 3).map((citation) => (
            <span key={`${citation.index}-${citation.source}-${citation.location}`} className="shrink-0 rounded-full bg-slate-50 px-2.5 py-1 text-xs text-slate-500 ring-1 ring-slate-200">
              来源 {citation.index}：{citation.dominantSignalLabel ? `${citation.dominantSignalLabel} · ` : ""}{citation.location || citation.source}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function QaInlineSupplementPanel({
  test,
  diagnostics,
  knowledgeBases,
  saving,
  onSubmit
}: {
  test: QaTestCase;
  diagnostics: ReturnType<typeof qaDiagnostics>;
  knowledgeBases: KnowledgeBase[];
  saving: boolean;
  onSubmit: (input: QaSupplementInput) => void;
}) {
  const suggestedContent = buildSuggestedSupplementContent(test, diagnostics);
  const [knowledgeBaseId, setKnowledgeBaseId] = useState(knowledgeBases[0]?.id ?? "");
  const [title, setTitle] = useState(test.question);
  const [content, setContent] = useState(() => suggestedContent);

  useEffect(() => {
    setKnowledgeBaseId((current) => current || knowledgeBases[0]?.id || "");
  }, [knowledgeBases]);

  useEffect(() => {
    setTitle(test.question);
    setContent(suggestedContent);
  }, [test.id, test.question, suggestedContent]);

  return (
    <div className="mt-4 rounded-lg border border-cyan/20 bg-cyan/10 p-3">
      <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 text-xs font-semibold text-brand">
            <FilePlus2 size={14} />
            补充知识并自动复测
          </div>
          <p className="mt-1 text-xs leading-5 text-slate-600">
            这段内容会作为一份整改补充资料写入知识库，然后立即重跑当前测试。
          </p>
        </div>
        <span className="rounded-full bg-white px-2.5 py-1 text-xs font-medium text-slate-600 ring-1 ring-cyan/20">
          {diagnostics.messages.length > 0 ? diagnostics.messages.join("；") : "待补充标准依据"}
        </span>
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-[220px_1fr]">
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-slate-600">写入知识库</span>
          <select
            value={knowledgeBaseId}
            onChange={(event) => setKnowledgeBaseId(event.target.value)}
            disabled={saving || knowledgeBases.length === 0}
            className="h-11 w-full rounded-lg border border-cyan/20 bg-white px-3 text-sm outline-none focus:border-brand disabled:bg-slate-50"
          >
            {knowledgeBases.map((kb) => (
              <option key={kb.id} value={kb.id}>
                {kb.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-slate-600">资料标题</span>
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="知识标题"
            className="h-11 w-full rounded-lg border border-cyan/20 bg-white px-3 text-sm outline-none focus:border-brand"
          />
        </label>
      </div>

      <label className="mt-3 block">
        <span className="mb-1.5 block text-xs font-medium text-slate-600">补充依据</span>
        <textarea
          value={content}
          onChange={(event) => setContent(event.target.value)}
          placeholder="填写可作为员工问答依据的制度、流程或标准答案。"
          className="min-h-32 w-full rounded-lg border border-cyan/20 bg-white px-3 py-2 text-sm leading-6 outline-none focus:border-brand"
        />
      </label>

      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs leading-5 text-slate-500">
          补充内容至少 10 个字符；建议写成员工可直接引用的标准依据。
        </p>
        <button
          type="button"
          onClick={() => onSubmit({
            knowledge_base_id: knowledgeBaseId,
            title,
            content
          })}
          disabled={saving || !knowledgeBaseId || content.trim().length < 10}
          className="ui-button-primary min-h-11 px-3"
        >
          {saving ? <Loader2 className="animate-spin" size={15} /> : <RefreshCw size={15} />}
          补充并复测
        </button>
      </div>
    </div>
  );
}

function buildSuggestedSupplementContent(test: QaTestCase, diagnostics: ReturnType<typeof qaDiagnostics>) {
  const parts = [
    test.expected_answer ? `标准答案：${test.expected_answer}` : "",
    diagnostics.coverage.missing.length > 0 ? `需补充关键词：${diagnostics.coverage.missing.join("、")}` : "",
    test.answer ? `当前回答问题：${diagnostics.messages.join("；") || "请补充更明确依据"}` : "当前测试尚未运行，请补充标准依据后复测。"
  ].filter(Boolean);

  return parts.join("\n");
}

function buildRemediationLoopStats(remediationByTestId: QaRemediationByTest) {
  const tasks = Object.values(remediationByTestId);
  const latestRetests = tasks
    .filter((task) => task.latest_retest)
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
    .slice(0, 3);

  return {
    total: tasks.length,
    pending: tasks.filter((task) => task.status === "pending").length,
    processing: tasks.filter((task) => task.status === "processing").length,
    resolved: tasks.filter((task) => task.status === "resolved").length,
    ignored: tasks.filter((task) => task.status === "ignored").length,
    retested: tasks.filter((task) => task.latest_retest).length,
    latestRetests
  };
}

function remediationStatusClass(status: QaRemediationTaskSummary["status"]) {
  if (status === "resolved") {
    return "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100";
  }

  if (status === "processing") {
    return "bg-cyan-50 text-cyan-700 ring-1 ring-cyan-100";
  }

  if (status === "ignored") {
    return "bg-slate-100 text-slate-600 ring-1 ring-slate-200";
  }

  return "bg-amber-50 text-amber-800 ring-1 ring-amber-100";
}

function formatLocalDateTime(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString("zh-CN");
}

function formatShortDate(value: string) {
  const matched = value.match(/^\d{4}-(\d{2})-(\d{2})$/);

  if (matched) {
    return `${matched[1]}/${matched[2]}`;
  }

  return value;
}

function qaDiagnostics(test: QaTestCase) {
  const coverage = expectedCoverage(test.answer ?? "", test.expected_answer ?? "");
  const citationCount = getCitationCount(test);
  const messages: string[] = [];
  const deductions: Array<{ reason: string; points: number }> = [];
  let qualityScore = test.answer ? 100 : 0;

  if (!test.answer) {
    deductions.push({ reason: "尚未运行", points: 100 });
  }

  if (test.answer && citationCount === 0) {
    messages.push("回答没有引用来源");
    deductions.push({ reason: "无引用", points: 30 });
    qualityScore -= 30;
  }

  if (test.expected_answer && test.answer && coverage.coverage < 60) {
    messages.push("期望答案关键词覆盖偏低");
    const points = coverage.coverage < 40 ? 28 : 18;
    deductions.push({ reason: "覆盖偏低", points });
    qualityScore -= points;
  } else if (test.expected_answer && test.answer && coverage.coverage < 80) {
    deductions.push({ reason: "覆盖可提升", points: 8 });
    qualityScore -= 8;
  }

  if (test.answer?.includes("未在知识库中找到明确依据")) {
    messages.push("知识库可能未命中");
    deductions.push({ reason: "未命中知识库", points: 30 });
    qualityScore -= 30;
  }

  if ((test.latency_ms ?? 0) > 15000) {
    messages.push("响应耗时较长");
    deductions.push({ reason: "响应较慢", points: 8 });
    qualityScore -= 8;
  } else if ((test.latency_ms ?? 0) > 8000) {
    deductions.push({ reason: "耗时偏高", points: 4 });
    qualityScore -= 4;
  }

  if (test.status === "failed") {
    deductions.push({ reason: "人工不通过", points: 20 });
    qualityScore -= 20;
  }

  if (test.status === "passed") {
    qualityScore += 5;
  }

  qualityScore = Math.max(0, Math.min(100, Math.round(qualityScore)));

  return {
    citationCount,
    coverage,
    messages,
    deductions,
    qualityScore,
    qualityGrade: qualityGrade(qualityScore),
    action: qualityAction({
      answer: test.answer ?? "",
      status: test.status,
      citationCount,
      coverage,
      qualityScore
    }),
    risk: messages.length === 0 ? "low" as const : coverage.coverage < 40 || citationCount === 0 ? "high" as const : "medium" as const
  };
}

function qualityGrade(score: number) {
  if (score >= 85) {
    return "excellent" as const;
  }

  if (score >= 70) {
    return "usable" as const;
  }

  if (score >= 50) {
    return "review" as const;
  }

  return "repair" as const;
}

function qualityGradeLabel(grade: ReturnType<typeof qualityGrade>) {
  const labels: Record<ReturnType<typeof qualityGrade>, string> = {
    excellent: "可直接通过",
    usable: "建议复核",
    review: "需要修订",
    repair: "优先整改"
  };

  return labels[grade];
}

function qualityScoreTone(score: number) {
  if (score >= 85) {
    return "text-emerald-700";
  }

  if (score >= 70) {
    return "text-cyan-700";
  }

  if (score >= 50) {
    return "text-amber-700";
  }

  return "text-red-700";
}

function qualityAction(input: {
  answer: string;
  status: QaTestStatus;
  citationCount: number;
  coverage: ReturnType<typeof expectedCoverage>;
  qualityScore: number;
}) {
  if (!input.answer) {
    return "先运行测试，再根据回答和引用来源判断是否需要补充资料。";
  }

  if (input.citationCount === 0 || input.answer.includes("未在知识库中找到明确依据")) {
    return "优先补充可引用资料，或检查资料是否已发布、知识库范围是否选对。";
  }

  if (input.coverage.coverage < 60) {
    return "补充缺失关键词对应的制度依据，完成后用“补知识并复测”重新验证。";
  }

  if (input.status === "failed") {
    return "按人工评审备注修订知识内容，复测通过后再标记通过。";
  }

  if (input.qualityScore >= 85) {
    return "回答质量较好，可抽查来源后标记通过。";
  }

  return "建议人工快速复核来源与措辞，必要时补充更明确的标准答案。";
}

function expectedCoverage(answer: string, expected: string) {
  const terms = extractExpectedTerms(expected);

  if (terms.length === 0) {
    return {
      coverage: expected ? 0 : 100,
      matched: [] as string[],
      missing: [] as string[]
    };
  }

  const normalizedAnswer = normalizeCoverageText(answer);
  const matched = terms.filter((term) => normalizedAnswer.includes(normalizeCoverageText(term)));
  const missing = terms.filter((term) => !matched.includes(term));

  return {
    coverage: Math.round((matched.length / terms.length) * 100),
    matched,
    missing
  };
}

function extractExpectedTerms(expected: string) {
  const normalizedExpected = expected
    .replace(/资料「[^」]+」/g, " ")
    .replace(/文档「[^」]+」/g, " ")
    .replace(/主要内容应(?:包括|包含)/g, " ")
    .replace(/应(?:概括|说明|包括|包含|提到)/g, " ")
    .replace(/并?至少提到/g, " ")
    .replace(/目录(?:包括|包含)/g, " ")
    .replace(/(?:参考|标准)?答案/g, " ");
  const stopWords = new Set([
    "应该",
    "需要",
    "可以",
    "不得",
    "必须",
    "进行",
    "员工",
    "公司",
    "如果",
    "时候",
    "说明",
    "应说明",
    "引用",
    "资料",
    "文档",
    "页面",
    "主要",
    "内容",
    "主要内容",
    "包括",
    "包含",
    "提到",
    "测试",
    "回归"
  ]);
  const terms = normalizedExpected
    .replace(/[，。！？、；：,.!?;:]/g, " ")
    .split(/\s+/)
    .flatMap((part) => part.match(/[a-z0-9\u4e00-\u9fa5]{2,}/gi) ?? [])
    .map((term) => term.trim())
    .filter((term) => term.length >= 2 && !stopWords.has(term) && !stopWords.has(term.toLowerCase()));

  return [...new Set(terms)].slice(0, 12);
}

function normalizeCoverageText(value: string) {
  return value
    .toLowerCase()
    .replace(/[^\da-z\u3400-\u9fff]+/g, "")
    .trim();
}

function getCitationCount(test: QaTestCase) {
  return typeof test.citation_count === "number" ? test.citation_count : test.citations.length;
}

function CitationList({ citations, totalCount }: { citations: Citation[]; totalCount: number }) {
  return (
    <div className="mt-4 grid gap-2">
      {totalCount > citations.length && (
        <p className="text-xs text-slate-500">
          已引用 {totalCount} 个来源，列表仅展示前 {citations.length} 个摘要；完整内容可通过导出查看。
        </p>
      )}
      {citations.map((citation, index) => {
        const signalBadges = citationSignalBuckets(citation).slice(0, 3);
        return (
          <div key={`${citation.file_id}-${index}`} className="rounded-lg border border-line p-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <p className="text-xs font-medium text-slate-500">
                来源 {citation.index ?? index + 1} · {citation.file_name ?? "未知文件"}
              </p>
              {signalBadges.length > 0 && <SignalBadgeList badges={signalBadges} />}
            </div>
            {citationMeta(citation) && (
              <p className="mt-1 text-xs leading-5 text-slate-500">{citationMeta(citation)}</p>
            )}
            {citation.quote && <p className="mt-2 text-sm leading-6 text-slate-700">{citation.quote}</p>}
          </div>
        );
      })}
    </div>
  );
}

function citationMeta(citation: Citation) {
  const parts: string[] = [];

  if (citation.page) {
    parts.push(`第 ${citation.page} 页`);
  }

  if (citation.section) {
    parts.push(citation.section);
  }

  if (citation.sheet) {
    parts.push(`工作表：${citation.sheet}`);
  }

  if (citation.cell_range) {
    parts.push(`范围：${citation.cell_range}`);
  }

  if (citation.score !== undefined) {
    parts.push(`相关度：${citation.score}`);
  }

  if (citation.score_reason) {
    parts.push(citation.score_reason);
  }

  return parts.join(" · ");
}

function statusClass(status: QaTestStatus) {
  if (status === "passed") {
    return "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200";
  }

  if (status === "failed") {
    return "bg-red-50 text-red-700 ring-1 ring-red-200";
  }

  return "bg-amber-50 text-amber-700 ring-1 ring-amber-200";
}
