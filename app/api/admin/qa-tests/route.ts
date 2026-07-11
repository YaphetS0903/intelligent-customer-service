import { NextResponse } from "next/server";
import { createQaTestCase, listKnowledgeBases, listKnowledgeTasks, listModelUsageEvents, listQaTestCases, listUsers, requireAdmin } from "@/lib/db";
import { buildQaRemediationRetestTrend, buildQaRemediationTaskSummary } from "@/lib/knowledge-task-summary";
import { configuredLocalRagStrategyId, localRagStrategies } from "@/lib/local-rag";
import { expectedCoverage } from "@/lib/qa-quality";
import { toRemediationCandidate } from "@/lib/qa-remediation";
import type { Citation, KnowledgeTask, ModelUsageEvent, QaTestCase } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await requireAdmin();
    const url = new URL(request.url);
    const strategyWindowDays = normalizeStrategyTrendWindowDays(url.searchParams.get("strategy_window_days"));
    const [tests, knowledgeBases, qaUsageEvents, knowledgeTaskResult, users] = await Promise.all([
      retryDbRead(() => listQaTestCases({ compactCitations: true }), "qa-tests:list"),
      retryDbRead(() => listKnowledgeBases(), "qa-tests:knowledge-bases"),
      listQaUsageEventsSafely(),
      listKnowledgeTasksSafely(),
      listUsersSafely()
    ]);

    return NextResponse.json({
      tests: tests.map(compactQaTestCaseForList),
      knowledgeBases,
      qaUsageByTestId: buildQaUsageByTestId(qaUsageEvents),
      qaUsageSummary: summarizeQaUsage(qaUsageEvents),
      strategyTrend: buildQaStrategyTrend(qaUsageEvents, tests, knowledgeBases, users, { windowDays: strategyWindowDays }),
      remediationByTestId: buildRemediationByTestId(knowledgeTaskResult.tasks),
      remediationRetestTrend: buildQaRemediationRetestTrend(knowledgeTaskResult.tasks),
      remediationTasksStatus: knowledgeTaskResult.timedOut ? "timeout" : "ready"
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "获取问答测试失败" },
      { status: 403 }
    );
  }
}

async function listKnowledgeTasksSafely() {
  let timedOut = false;
  const tasksPromise = listKnowledgeTasks().catch((error) => {
    if (!timedOut) {
      console.error("[qa-tests:knowledge-tasks-list]", error);
    }
    timedOut = true;
    return [];
  });

  try {
    const tasks = await Promise.race([
      tasksPromise,
      sleep(3500).then(() => {
        timedOut = true;
        return [] as KnowledgeTask[];
      })
    ]);

    return { tasks, timedOut };
  } finally {
    void tasksPromise;
  }
}

async function retryDbRead<T>(operation: () => Promise<T>, label: string, attempts = 3): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      console.warn(`[${label}] read failed, attempt ${attempt}/${attempts}`, error);
      if (attempt < attempts) {
        await sleep(700 * attempt);
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error("读取数据库失败");
}

async function listQaUsageEventsSafely() {
  let timedOut = false;
  const usagePromise = retryDbRead(() => listModelUsageEvents(1000, { source: "qa" }), "qa-tests:usage", 2).catch((error) => {
    if (!timedOut) {
      console.error("[qa-tests:usage-list]", error);
    }
    return [];
  });

  try {
    return await Promise.race([
      usagePromise,
      sleep(8000).then(() => {
        timedOut = true;
        return [] as ModelUsageEvent[];
      })
    ]);
  } finally {
    void usagePromise;
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function listUsersSafely() {
  return retryDbRead(() => listUsers(), "qa-tests:users", 2).catch((error) => {
    console.warn("[qa-tests:users] read unavailable, using empty dimension map", error);
    return [];
  });
}

function buildRemediationByTestId(tasks: KnowledgeTask[]) {
  const qaTasks = tasks
    .filter((task) => task.source === "manual" && task.source_id?.startsWith("qa:"))
    .map(buildQaRemediationTaskSummary);
  const grouped = new Map<string, typeof qaTasks[number]>();

  for (const task of qaTasks) {
    const existing = grouped.get(task.qa_test_id);

    if (!existing || new Date(task.updated_at).getTime() > new Date(existing.updated_at).getTime()) {
      grouped.set(task.qa_test_id, task);
    }
  }

  return Object.fromEntries(grouped.entries());
}

function compactQaTestCaseForList(test: QaTestCase): QaTestCase {
  return {
    ...test,
    citations: test.citations.map(compactCitationForList)
  };
}

function compactCitationForList(citation: Citation): Citation {
  return {
    ...citation,
    quote: citation.quote ? truncateText(citation.quote, 220) : citation.quote,
    matched_terms: citation.matched_terms?.slice(0, 8),
    score_reason: citation.score_reason ? truncateText(citation.score_reason, 120) : citation.score_reason
  };
}

function truncateText(value: string, maxLength: number) {
  const normalized = value.replace(/\s+/g, " ").trim();

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 1)}…`;
}

function buildQaUsageByTestId(events: ModelUsageEvent[]) {
  const grouped = new Map<string, ModelUsageEvent[]>();

  for (const event of events) {
    if (!event.source_id) {
      continue;
    }

    grouped.set(event.source_id, [...(grouped.get(event.source_id) ?? []), event]);
  }

  return Object.fromEntries([...grouped.entries()].map(([testId, testEvents]) => {
    const sorted = [...testEvents].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    const latest = sorted[0];
    const total = summarizeQaUsage(sorted);

    return [testId, {
      run_count: sorted.length,
      last_input_tokens: latest?.input_tokens ?? 0,
      last_output_tokens: latest?.output_tokens ?? 0,
      last_total_tokens: latest?.total_tokens ?? 0,
      last_cost_usd: latest?.cost_usd ?? null,
      last_estimated: latest?.estimated ?? true,
      last_model: latest?.model ?? null,
      last_provider: latest?.provider ?? null,
      last_created_at: latest?.created_at ?? null,
      total_tokens: total.total_tokens,
      total_cost_usd: total.cost_usd
    }];
  }));
}

function summarizeQaUsage(events: ModelUsageEvent[]) {
  const costs = events
    .map((event) => event.cost_usd)
    .filter((cost): cost is number => typeof cost === "number" && Number.isFinite(cost));

  return {
    event_count: events.length,
    input_tokens: events.reduce((sum, event) => sum + event.input_tokens, 0),
    output_tokens: events.reduce((sum, event) => sum + event.output_tokens, 0),
    total_tokens: events.reduce((sum, event) => sum + event.total_tokens, 0),
    estimated_count: events.filter((event) => event.estimated).length,
    cost_usd: costs.length > 0 ? Number(costs.reduce((sum, cost) => sum + cost, 0).toFixed(8)) : null
  };
}

function buildQaStrategyTrend(
  events: ModelUsageEvent[],
  tests: QaTestCase[],
  knowledgeBases: Awaited<ReturnType<typeof listKnowledgeBases>>,
  users: Awaited<ReturnType<typeof listUsers>>,
  options: { windowDays: number }
) {
  const trendWindow = buildQaStrategyTrendWindow(events, options.windowDays);
  const trendEvents = trendWindow.events;
  const testById = new Map(tests.map((test) => [test.id, test]));
  const knowledgeBaseNameById = new Map(knowledgeBases.map((kb) => [kb.id, kb.name]));
  const userById = new Map(users.map((user) => [user.id, user]));
  const strategyLabels = new Map(localRagStrategies.map((strategy) => [strategy.id, strategy.label]));
  const currentStrategyId = configuredLocalRagStrategyId();
  const grouped = new Map<string, QaStrategyTrendAccumulator>();
  const strategyGrouped = new Map<string, QaStrategyTrendAccumulator>();
  const knowledgeBaseGrouped = new Map<string, QaStrategyTrendAccumulator>();
  const intentGrouped = new Map<string, QaStrategyTrendAccumulator>();
  const departmentGrouped = new Map<string, QaStrategyTrendAccumulator>();
  const positionGrouped = new Map<string, QaStrategyTrendAccumulator>();
  const latestRuns = [...trendEvents]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 8)
    .map((event) => {
      const test = event.source_id ? testById.get(event.source_id) ?? null : null;
      const strategyId = modelUsageStrategyId(event);

      return {
        id: event.id,
        test_id: event.source_id,
        question: test?.question ?? "未知问题",
        strategy_id: strategyId,
        strategy_label: strategyLabel(strategyId, strategyLabels),
        status: modelUsageStatus(event, test),
        citation_count: modelUsageCitationCount(event, test),
        coverage: modelUsageCoverage(event, test),
        latency_ms: modelUsageLatency(event, test),
        total_tokens: event.total_tokens,
        created_at: event.created_at
      };
    });

  for (const event of trendEvents) {
    const test = event.source_id ? testById.get(event.source_id) ?? null : null;
    const strategyId = modelUsageStrategyId(event);
    const strategyLabelValue = strategyLabel(strategyId, strategyLabels);
    const date = event.created_at.slice(0, 10);
    const key = `${date}:${strategyId}`;
    const row = grouped.get(key) ?? createQaStrategyTrendAccumulator(date, strategyId, strategyLabelValue);
    const summary = strategyGrouped.get(strategyId) ?? createQaStrategyTrendAccumulator(null, strategyId, strategyLabelValue);

    addQaStrategyTrendEvent(row, event, test);
    addQaStrategyTrendEvent(summary, event, test);
    grouped.set(key, row);
    strategyGrouped.set(strategyId, summary);

    for (const knowledgeBaseId of modelUsageKnowledgeBaseIds(event, test)) {
      const knowledgeBaseLabel = knowledgeBaseNameById.get(knowledgeBaseId) ?? knowledgeBaseId;
      const breakdownKey = `${knowledgeBaseId}:${strategyId}`;
      const breakdownRow = knowledgeBaseGrouped.get(breakdownKey) ??
        createQaStrategyTrendAccumulator(null, strategyId, strategyLabelValue, {
          dimension_id: knowledgeBaseId,
          dimension_label: knowledgeBaseLabel
        });

      addQaStrategyTrendEvent(breakdownRow, event, test);
      knowledgeBaseGrouped.set(breakdownKey, breakdownRow);
    }

    const intentLabel = classifyQaTrendIntent(test?.question ?? "");
    const intentKey = `${intentLabel}:${strategyId}`;
    const intentRow = intentGrouped.get(intentKey) ??
      createQaStrategyTrendAccumulator(null, strategyId, strategyLabelValue, {
        dimension_id: intentLabel,
        dimension_label: intentLabel
      });

    addQaStrategyTrendEvent(intentRow, event, test);
    intentGrouped.set(intentKey, intentRow);

    const userDimension = modelUsageUserDimension(event, test, userById);
    const departmentKey = `${userDimension.department_id}:${strategyId}`;
    const departmentRow = departmentGrouped.get(departmentKey) ??
      createQaStrategyTrendAccumulator(null, strategyId, strategyLabelValue, {
        dimension_id: userDimension.department_id,
        dimension_label: userDimension.department_label
      });
    addQaStrategyTrendEvent(departmentRow, event, test);
    departmentGrouped.set(departmentKey, departmentRow);

    const positionKey = `${userDimension.position_id}:${strategyId}`;
    const positionRow = positionGrouped.get(positionKey) ??
      createQaStrategyTrendAccumulator(null, strategyId, strategyLabelValue, {
        dimension_id: userDimension.position_id,
        dimension_label: userDimension.position_label
      });
    addQaStrategyTrendEvent(positionRow, event, test);
    positionGrouped.set(positionKey, positionRow);
  }

  const rows = [...grouped.values()]
    .map(finalizeQaStrategyTrendAccumulator)
    .sort((a, b) => {
      const dateCompare = (b.date ?? "").localeCompare(a.date ?? "");
      return dateCompare || b.run_count - a.run_count;
    });
  const strategies = [...strategyGrouped.values()]
    .map(finalizeQaStrategyTrendAccumulator)
    .sort((a, b) => b.run_count - a.run_count || (b.last_run_at ?? "").localeCompare(a.last_run_at ?? ""));
  const byKnowledgeBase = [...knowledgeBaseGrouped.values()]
    .map(finalizeQaStrategyTrendAccumulator)
    .map(withTrendRiskScore)
    .sort(sortQaStrategyBreakdownRows)
    .slice(0, 8);
  const byIntent = [...intentGrouped.values()]
    .map(finalizeQaStrategyTrendAccumulator)
    .map(withTrendRiskScore)
    .sort(sortQaStrategyBreakdownRows)
    .slice(0, 8);
  const byDepartment = [...departmentGrouped.values()]
    .map(finalizeQaStrategyTrendAccumulator)
    .map(withTrendRiskScore)
    .sort(sortQaStrategyBreakdownRows)
    .slice(0, 8);
  const byPosition = [...positionGrouped.values()]
    .map(finalizeQaStrategyTrendAccumulator)
    .map(withTrendRiskScore)
    .sort(sortQaStrategyBreakdownRows)
    .slice(0, 8);
  const anomalies = buildQaStrategyTrendAnomalies({
    strategies,
    byKnowledgeBase,
    byIntent,
    byDepartment,
    byPosition,
    currentStrategyId,
    currentStrategyLabel: strategyLabel(currentStrategyId, strategyLabels)
  });
  const comparison = buildQaStrategyTrendComparison({
    events: trendEvents,
    testById,
    currentStrategyId,
    currentStrategyLabel: strategyLabel(currentStrategyId, strategyLabels),
    strategyLabels
  });

  return {
    generated_at: new Date().toISOString(),
    event_count: trendEvents.length,
    window: {
      days: trendWindow.days,
      label: trendWindow.label,
      start_at: trendWindow.start_at,
      end_at: trendWindow.end_at,
      total_event_count: events.length,
      event_count: trendEvents.length
    },
    current_strategy_id: currentStrategyId,
    current_strategy_label: strategyLabel(currentStrategyId, strategyLabels),
    strategy_count: strategies.length,
    anomaly_count: anomalies.length,
    strategies,
    rows,
    by_knowledge_base: byKnowledgeBase,
    by_intent: byIntent,
    by_department: byDepartment,
    by_position: byPosition,
    anomalies,
    comparison,
    latest: latestRuns
  };
}

function normalizeStrategyTrendWindowDays(value: string | null) {
  const days = Number(value ?? 0);
  return [0, 7, 30, 90].includes(days) ? days : 0;
}

function buildQaStrategyTrendWindow(events: ModelUsageEvent[], days: number) {
  const timestamps = events
    .map((event) => new Date(event.created_at).getTime())
    .filter((time) => Number.isFinite(time));
  const endTime = timestamps.length > 0 ? Math.max(...timestamps) : null;

  if (!endTime) {
    return {
      days,
      label: days > 0 ? `近 ${days} 天` : "全部",
      start_at: null,
      end_at: null,
      events: []
    };
  }

  if (days <= 0) {
    return {
      days: 0,
      label: "全部",
      start_at: null,
      end_at: new Date(endTime).toISOString(),
      events
    };
  }

  const startTime = endTime - days * 24 * 60 * 60 * 1000;

  return {
    days,
    label: `近 ${days} 天`,
    start_at: new Date(startTime).toISOString(),
    end_at: new Date(endTime).toISOString(),
    events: events.filter((event) => {
      const time = new Date(event.created_at).getTime();
      return Number.isFinite(time) && time >= startTime && time <= endTime;
    })
  };
}

type QaStrategyTrendAccumulator = {
  date: string | null;
  dimension_id: string | null;
  dimension_label: string | null;
  strategy_id: string;
  strategy_label: string;
  run_count: number;
  pass_count: number;
  failed_count: number;
  no_citation_count: number;
  citation_total: number;
  citation_samples: number;
  coverage_total: number;
  coverage_samples: number;
  latency_total: number;
  latency_samples: number;
  total_tokens: number;
  cost_total: number;
  cost_samples: number;
  last_run_at: string | null;
  candidate_test_ids: Set<string>;
};

function createQaStrategyTrendAccumulator(
  date: string | null,
  strategyId: string,
  strategyLabelValue: string,
  dimension?: {
    dimension_id: string;
    dimension_label: string;
  }
): QaStrategyTrendAccumulator {
  return {
    date,
    dimension_id: dimension?.dimension_id ?? null,
    dimension_label: dimension?.dimension_label ?? null,
    strategy_id: strategyId,
    strategy_label: strategyLabelValue,
    run_count: 0,
    pass_count: 0,
    failed_count: 0,
    no_citation_count: 0,
    citation_total: 0,
    citation_samples: 0,
    coverage_total: 0,
    coverage_samples: 0,
    latency_total: 0,
    latency_samples: 0,
    total_tokens: 0,
    cost_total: 0,
    cost_samples: 0,
    last_run_at: null,
    candidate_test_ids: new Set<string>()
  };
}

function addQaStrategyTrendEvent(
  row: QaStrategyTrendAccumulator,
  event: ModelUsageEvent,
  test: QaTestCase | null
) {
  row.run_count += 1;

  const status = modelUsageStatus(event, test);
  if (status === "passed") {
    row.pass_count += 1;
  } else if (status === "failed") {
    row.failed_count += 1;
  }

  const citationCount = modelUsageCitationCount(event, test);
  if (typeof citationCount === "number") {
    row.citation_total += citationCount;
    row.citation_samples += 1;
    if (citationCount === 0) {
      row.no_citation_count += 1;
    }
  }

  const coverage = modelUsageCoverage(event, test);
  if (typeof coverage === "number") {
    row.coverage_total += coverage;
    row.coverage_samples += 1;
  }

  const latency = modelUsageLatency(event, test);
  if (typeof latency === "number") {
    row.latency_total += latency;
    row.latency_samples += 1;
  }

  row.total_tokens += event.total_tokens;
  if (typeof event.cost_usd === "number" && Number.isFinite(event.cost_usd)) {
    row.cost_total += event.cost_usd;
    row.cost_samples += 1;
  }

  if (!row.last_run_at || new Date(event.created_at).getTime() > new Date(row.last_run_at).getTime()) {
    row.last_run_at = event.created_at;
  }

  if (test && toRemediationCandidate(test)) {
    row.candidate_test_ids.add(test.id);
  }
}

function finalizeQaStrategyTrendAccumulator(row: QaStrategyTrendAccumulator) {
  const evaluatedCount = row.pass_count + row.failed_count;

  return {
    date: row.date,
    dimension_id: row.dimension_id,
    dimension_label: row.dimension_label,
    strategy_id: row.strategy_id,
    strategy_label: row.strategy_label,
    run_count: row.run_count,
    pass_count: row.pass_count,
    failed_count: row.failed_count,
    pass_rate: evaluatedCount > 0 ? Math.round((row.pass_count / evaluatedCount) * 100) : 0,
    no_citation_count: row.no_citation_count,
    no_citation_rate: row.citation_samples > 0 ? Math.round((row.no_citation_count / row.citation_samples) * 100) : 0,
    average_citations: row.citation_samples > 0 ? Number((row.citation_total / row.citation_samples).toFixed(1)) : 0,
    average_coverage: row.coverage_samples > 0 ? Math.round(row.coverage_total / row.coverage_samples) : null,
    average_latency_ms: row.latency_samples > 0 ? Math.round(row.latency_total / row.latency_samples) : null,
    total_tokens: row.total_tokens,
    cost_usd: row.cost_samples > 0 ? Number(row.cost_total.toFixed(8)) : null,
    last_run_at: row.last_run_at,
    candidate_test_ids: [...row.candidate_test_ids].slice(0, 12)
  };
}

function summarizeQaStrategyTrendEvents(input: {
  events: ModelUsageEvent[];
  testById: Map<string, QaTestCase>;
  strategyId: string;
  strategyLabel: string;
}) {
  const row = createQaStrategyTrendAccumulator(null, input.strategyId, input.strategyLabel);

  for (const event of input.events) {
    const test = event.source_id ? input.testById.get(event.source_id) ?? null : null;
    addQaStrategyTrendEvent(row, event, test);
  }

  return finalizeQaStrategyTrendAccumulator(row);
}

function buildQaStrategyTrendComparison(input: {
  events: ModelUsageEvent[];
  testById: Map<string, QaTestCase>;
  currentStrategyId: string;
  currentStrategyLabel: string;
  strategyLabels: Map<string, string>;
}) {
  const sortedEvents = [...input.events].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  const currentEvents = sortedEvents.filter((event) => modelUsageStrategyId(event) === input.currentStrategyId);
  const previousEvents = sortedEvents.filter((event) => modelUsageStrategyId(event) !== input.currentStrategyId);

  if (currentEvents.length === 0) {
    const before = previousEvents.length > 0
      ? summarizeQaStrategyTrendEvents({
        events: previousEvents,
        testById: input.testById,
        strategyId: "previous",
        strategyLabel: strategySetLabel(previousEvents, input.strategyLabels)
      })
      : null;

    return {
      mode: "no_current_samples" as const,
      cutover_at: null,
      before,
      after: null,
      deltas: null,
      notes: [
        "当前策略暂无 QA 运行样本，无法计算切换后表现。",
        "建议先复跑失败/低覆盖/无引用问题，形成当前策略基线。"
      ]
    };
  }

  let cutoverAt: string | null = null;
  for (const event of sortedEvents) {
    if (modelUsageStrategyId(event) === input.currentStrategyId) {
      const previous = sortedEvents.filter((item) =>
        new Date(item.created_at).getTime() < new Date(event.created_at).getTime() &&
        modelUsageStrategyId(item) !== input.currentStrategyId
      );

      if (previous.length > 0) {
        cutoverAt = event.created_at;
        break;
      }
    }
  }

  if (!cutoverAt) {
    const after = summarizeQaStrategyTrendEvents({
      events: currentEvents,
      testById: input.testById,
      strategyId: input.currentStrategyId,
      strategyLabel: input.currentStrategyLabel
    });

    return {
      mode: "no_previous_strategy" as const,
      cutover_at: null,
      before: null,
      after,
      deltas: null,
      notes: [
        "当前时间范围内没有检测到策略切换前样本。",
        "可以切到“全部”或“近 90 天”查看更早的历史样本。"
      ]
    };
  }

  const cutoverTime = new Date(cutoverAt).getTime();
  const beforeEvents = sortedEvents.filter((event) => new Date(event.created_at).getTime() < cutoverTime);
  const afterEvents = sortedEvents.filter((event) =>
    new Date(event.created_at).getTime() >= cutoverTime &&
    modelUsageStrategyId(event) === input.currentStrategyId
  );
  const before = summarizeQaStrategyTrendEvents({
    events: beforeEvents,
    testById: input.testById,
    strategyId: "previous",
    strategyLabel: strategySetLabel(beforeEvents, input.strategyLabels)
  });
  const after = summarizeQaStrategyTrendEvents({
    events: afterEvents,
    testById: input.testById,
    strategyId: input.currentStrategyId,
    strategyLabel: input.currentStrategyLabel
  });

  return {
    mode: "switch_detected" as const,
    cutover_at: cutoverAt,
    before,
    after,
    deltas: buildQaStrategyTrendDeltas(before, after),
    notes: [
      `检测到当前策略样本起点：${cutoverAt.slice(0, 10)}。`,
      "对比口径：切换前全部策略样本 vs 切换后当前策略样本。"
    ]
  };
}

function strategySetLabel(events: ModelUsageEvent[], strategyLabels: Map<string, string>) {
  const labels = [...new Set(events.map((event) => strategyLabel(modelUsageStrategyId(event), strategyLabels)))];

  if (labels.length === 0) {
    return "切换前基线";
  }

  if (labels.length === 1) {
    return labels[0];
  }

  return `${labels[0]}等 ${labels.length} 种策略`;
}

function buildQaStrategyTrendDeltas(
  before: ReturnType<typeof finalizeQaStrategyTrendAccumulator>,
  after: ReturnType<typeof finalizeQaStrategyTrendAccumulator>
) {
  return {
    run_count: after.run_count - before.run_count,
    pass_rate: after.pass_rate - before.pass_rate,
    no_citation_rate: after.no_citation_rate - before.no_citation_rate,
    average_coverage: nullableDelta(after.average_coverage, before.average_coverage),
    average_latency_ms: nullableDelta(after.average_latency_ms, before.average_latency_ms),
    average_citations: Number((after.average_citations - before.average_citations).toFixed(1)),
    total_tokens: after.total_tokens - before.total_tokens
  };
}

function nullableDelta(after: number | null, before: number | null) {
  if (typeof after !== "number" || typeof before !== "number") {
    return null;
  }

  return after - before;
}

function withTrendRiskScore<T extends ReturnType<typeof finalizeQaStrategyTrendAccumulator>>(row: T) {
  const coverageRisk = row.average_coverage === null ? 0 : Math.max(0, 60 - row.average_coverage);
  const passRisk = Math.max(0, 70 - row.pass_rate);
  const citationRisk = row.no_citation_rate;
  const latencyRisk = row.average_latency_ms && row.average_latency_ms > 15000 ? 12 : 0;

  return {
    ...row,
    risk_score: Math.round(passRisk * 0.7 + coverageRisk * 0.8 + citationRisk * 0.5 + latencyRisk)
  };
}

function sortQaStrategyBreakdownRows(
  a: ReturnType<typeof withTrendRiskScore>,
  b: ReturnType<typeof withTrendRiskScore>
) {
  return b.risk_score - a.risk_score ||
    b.run_count - a.run_count ||
    (a.dimension_label ?? "").localeCompare(b.dimension_label ?? "");
}

function buildQaStrategyTrendAnomalies(input: {
  strategies: Array<ReturnType<typeof finalizeQaStrategyTrendAccumulator>>;
  byKnowledgeBase: Array<ReturnType<typeof withTrendRiskScore>>;
  byIntent: Array<ReturnType<typeof withTrendRiskScore>>;
  byDepartment: Array<ReturnType<typeof withTrendRiskScore>>;
  byPosition: Array<ReturnType<typeof withTrendRiskScore>>;
  currentStrategyId: string;
  currentStrategyLabel: string;
}) {
  const anomalies: Array<{
    level: "warning" | "critical";
    title: string;
    description: string;
    metric: string;
    action_hint: string;
    suggested_test_ids: string[];
  }> = [];
  const currentStrategy = input.strategies.find((row) => row.strategy_id === input.currentStrategyId);

  if (!currentStrategy || currentStrategy.run_count === 0) {
    anomalies.push({
      level: "warning",
      title: "当前策略暂无 QA 样本",
      description: `当前策略「${input.currentStrategyLabel}」还没有可观察的 QA 运行记录。`,
      metric: "0 次运行",
      action_hint: "建议先复跑失败/低覆盖问题，形成策略切换后的基线。",
      suggested_test_ids: []
    });
  } else {
    if (currentStrategy.pass_rate < 60) {
      anomalies.push({
        level: currentStrategy.pass_rate < 45 ? "critical" : "warning",
        title: "当前策略通过率偏低",
        description: `当前策略「${currentStrategy.strategy_label}」通过率 ${currentStrategy.pass_rate}%，低于 60% 观察线。`,
        metric: `${currentStrategy.pass_rate}%`,
        action_hint: "优先查看低覆盖和不通过问题，必要时运行召回策略 A/B 对比。",
        suggested_test_ids: currentStrategy.candidate_test_ids
      });
    }
    if ((currentStrategy.average_coverage ?? 100) < 60) {
      anomalies.push({
        level: "warning",
        title: "当前策略覆盖率偏低",
        description: `当前策略平均期望覆盖 ${currentStrategy.average_coverage ?? 0}%，可能存在资料缺失或分片治理不足。`,
        metric: `${currentStrategy.average_coverage ?? 0}%`,
        action_hint: "优先处理缺失关键词集中出现的问题类型和命中文档。",
        suggested_test_ids: currentStrategy.candidate_test_ids
      });
    }
    if (currentStrategy.no_citation_rate > 0) {
      anomalies.push({
        level: currentStrategy.no_citation_rate >= 20 ? "critical" : "warning",
        title: "当前策略出现无引用回答",
        description: `当前策略无引用率 ${currentStrategy.no_citation_rate}%，需要关注知识库范围或召回阈值。`,
        metric: `${currentStrategy.no_citation_rate}%`,
        action_hint: "复跑无引用测试，并检查对应知识库是否有 ready/published 资料。",
        suggested_test_ids: currentStrategy.candidate_test_ids
      });
    }
  }

  for (const row of input.byKnowledgeBase.filter((item) => item.run_count >= 2 && item.risk_score >= 20).slice(0, 2)) {
    anomalies.push({
      level: row.risk_score >= 35 ? "critical" : "warning",
      title: "知识库策略效果需关注",
      description: `「${row.dimension_label}」在「${row.strategy_label}」下通过率 ${row.pass_rate}%，覆盖 ${row.average_coverage ?? 0}%。`,
      metric: `风险 ${row.risk_score}`,
      action_hint: "先查看该知识库的低覆盖题，再补资料或治理命中分片。",
      suggested_test_ids: row.candidate_test_ids
    });
  }

  for (const row of input.byIntent.filter((item) => item.run_count >= 2 && item.risk_score >= 20).slice(0, 2)) {
    anomalies.push({
      level: row.risk_score >= 35 ? "critical" : "warning",
      title: "问题类型策略效果需关注",
      description: `「${row.dimension_label}」类问题在「${row.strategy_label}」下通过率 ${row.pass_rate}%，覆盖 ${row.average_coverage ?? 0}%。`,
      metric: `风险 ${row.risk_score}`,
      action_hint: "把这类问题加入定向复测集，验证是否要调策略或补同义词。",
      suggested_test_ids: row.candidate_test_ids
    });
  }

  for (const row of input.byDepartment.filter((item) => item.run_count >= 2 && item.risk_score >= 20).slice(0, 1)) {
    anomalies.push({
      level: row.risk_score >= 35 ? "critical" : "warning",
      title: "部门样本策略效果需关注",
      description: `「${row.dimension_label}」部门在「${row.strategy_label}」下通过率 ${row.pass_rate}%，覆盖 ${row.average_coverage ?? 0}%。`,
      metric: `风险 ${row.risk_score}`,
      action_hint: "优先复跑该部门常问问题，确认是否需要补部门资料、调整可见范围或治理同义词。",
      suggested_test_ids: row.candidate_test_ids
    });
  }

  for (const row of input.byPosition.filter((item) => item.run_count >= 2 && item.risk_score >= 20).slice(0, 1)) {
    anomalies.push({
      level: row.risk_score >= 35 ? "critical" : "warning",
      title: "岗位样本策略效果需关注",
      description: `「${row.dimension_label}」岗位在「${row.strategy_label}」下通过率 ${row.pass_rate}%，覆盖 ${row.average_coverage ?? 0}%。`,
      metric: `风险 ${row.risk_score}`,
      action_hint: "把该岗位高频问题加入定向测试集，观察是否需要补岗位资料或提高对应知识库权重。",
      suggested_test_ids: row.candidate_test_ids
    });
  }

  return anomalies.slice(0, 7);
}

function modelUsageStrategyId(event: ModelUsageEvent) {
  const value = event.metadata.retrieval_strategy ?? event.metadata.strategy_id;
  return typeof value === "string" && value.trim() ? value : "untracked";
}

function strategyLabel(strategyId: string, strategyLabels: Map<string, string>) {
  if (strategyId === "untracked") {
    return "历史未记录";
  }

  return strategyLabels.get(strategyId) ?? strategyId;
}

function modelUsageStatus(event: ModelUsageEvent, test: QaTestCase | null) {
  const value = event.metadata.status;
  if (value === "passed" || value === "failed" || value === "untested") {
    return value;
  }

  return test?.status ?? "untested";
}

function modelUsageCitationCount(event: ModelUsageEvent, test: QaTestCase | null) {
  const value = numericMetadata(event.metadata.citation_count);
  if (typeof value === "number") {
    return value;
  }

  if (typeof test?.citation_count === "number") {
    return test.citation_count;
  }

  return test?.citations.length ?? null;
}

function modelUsageCoverage(event: ModelUsageEvent, test: QaTestCase | null) {
  const value = numericMetadata(event.metadata.expected_coverage);
  if (typeof value === "number") {
    return Math.max(0, Math.min(100, Math.round(value)));
  }

  if (test?.answer && test.expected_answer) {
    return expectedCoverage(test.answer, test.expected_answer).coverage;
  }

  return null;
}

function modelUsageLatency(event: ModelUsageEvent, test: QaTestCase | null) {
  return numericMetadata(event.metadata.latency_ms) ?? test?.latency_ms ?? null;
}

function modelUsageKnowledgeBaseIds(event: ModelUsageEvent, test: QaTestCase | null) {
  const metadataIds = Array.isArray(event.metadata.knowledge_base_ids)
    ? event.metadata.knowledge_base_ids.map((id) => String(id)).filter(Boolean)
    : [];
  const ids = metadataIds.length > 0 ? metadataIds : test?.knowledge_base_ids ?? [];

  return [...new Set(ids)];
}

function modelUsageUserDimension(
  event: ModelUsageEvent,
  test: QaTestCase | null,
  userById: Map<string, Awaited<ReturnType<typeof listUsers>>[number]>
) {
  const user = (event.user_id ? userById.get(event.user_id) : null) ??
    (test?.created_by ? userById.get(test.created_by) : null) ??
    null;
  const department = normalizeDimensionValue(user?.department, "未记录部门");
  const position = normalizeDimensionValue(user?.position, "未记录岗位");

  return {
    department_id: `department:${department}`,
    department_label: department,
    position_id: `position:${position}`,
    position_label: position
  };
}

function normalizeDimensionValue(value: string | null | undefined, fallback: string) {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

function classifyQaTrendIntent(question: string) {
  const text = question.toLowerCase();

  if (/登录|账号|密码|权限|sso|ldap|账户|用户/.test(text)) {
    return "账号权限";
  }
  if (/上传|资料|文档|知识库|pdf|ocr|图片|识别/.test(text)) {
    return "资料知识库";
  }
  if (/培训|课程|讲解|ppt|语音|视频|考试|测验/.test(text)) {
    return "培训学习";
  }
  if (/安全|劳保|消防|通道|防护|车间/.test(text)) {
    return "安全合规";
  }
  if (/质量|检验|首件|异常|尺寸|返工|批次/.test(text)) {
    return "质量生产";
  }
  if (/设备|点检|维修|保养|防护装置/.test(text)) {
    return "设备维护";
  }
  if (/请假|考勤|入职|离职|报销|审批|人事/.test(text)) {
    return "人事行政";
  }
  if (/反馈|工单|转人工|人工|投诉/.test(text)) {
    return "反馈工单";
  }

  return "综合咨询";
}

function numericMetadata(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
    return Number(value);
  }

  return null;
}

export async function POST(request: Request) {
  try {
    const user = await requireAdmin();
    const body = await request.json();
    const question = String(body.question ?? "").trim();
    const expectedAnswer = String(body.expected_answer ?? "").trim() || null;
    const knowledgeBaseIds = Array.isArray(body.knowledge_base_ids)
      ? body.knowledge_base_ids.map((id: unknown) => String(id)).filter(Boolean)
      : [];

    if (!question) {
      return NextResponse.json({ error: "测试问题不能为空" }, { status: 400 });
    }

    if (knowledgeBaseIds.length === 0) {
      return NextResponse.json({ error: "请至少选择一个知识库" }, { status: 400 });
    }

    const test = await createQaTestCase({
      question,
      expected_answer: expectedAnswer,
      knowledge_base_ids: knowledgeBaseIds,
      created_by: user.id
    });

    return NextResponse.json({ test });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "创建问答测试失败" },
      { status: 400 }
    );
  }
}
