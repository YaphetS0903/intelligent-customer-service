import { NextResponse } from "next/server";
import { isLocalTextRag } from "@/lib/config";
import { listDocumentChunksByScope, listDocuments, listKnowledgeBases, listQaTestCases, requireAdmin } from "@/lib/db";
import {
  evaluateLocalRagHits,
  localRagStrategies,
  searchLocalTextRagInChunks,
  type LocalRagStrategyId
} from "@/lib/local-rag";
import type { CitationDominantMatchSignal, DocumentChunk, QaTestCase } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const recommendationReadTimeoutMs = 25000;

type GovernanceRecommendationType =
  | "supplement_knowledge"
  | "improve_chunk_governance"
  | "adjust_retrieval_strategy"
  | "review_false_positive";

type GovernanceRecommendationPriority = "high" | "medium" | "low";

type QaActionFilter = "all" | "untested" | "passed" | "failed" | "no_citation" | "low_coverage" | "knowledge_miss";

type GovernanceRecommendation = {
  id: string;
  type: GovernanceRecommendationType;
  type_label: string;
  priority: GovernanceRecommendationPriority;
  title: string;
  description: string;
  reason: string;
  action_label: string;
  action_filter: QaActionFilter | null;
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

type RecommendationTestResult = {
  strategy_id: LocalRagStrategyId;
  strategy_label: string;
  hit: boolean;
  has_evidence: boolean;
  confidence: "none" | "low" | "medium" | "high";
  coverage: number;
  matched_terms: string[];
  missing_terms: string[];
  top_score: number | null;
  top_source: string | null;
  top_chunk_id: string | null;
  top_document_id: string | null;
  dominant_signal: CitationDominantMatchSignal | null;
  false_positive_risk: boolean;
  top_chunk_has_governance: boolean;
  top_chunk_has_pending_suggestion: boolean;
};

export async function GET(request: Request) {
  try {
    await requireAdmin();

    if (!isLocalTextRag()) {
      return NextResponse.json(
        { error: "自动治理建议仅支持 local_text RAG。" },
        { status: 400 }
      );
    }

    const url = new URL(request.url);
    const limit = clampInt(Number(url.searchParams.get("limit") ?? 60), 5, 100);
    const [tests, knowledgeBases, documents] = await Promise.all([
      readRecommendationSource(
        () => listQaTestCases({ compactCitations: true }),
        "读取 QA 测试"
      ),
      readRecommendationSource(
        () => listKnowledgeBases(),
        "读取知识库"
      ),
      readRecommendationSource(
        () => listDocuments(),
        "读取资料文档"
      )
    ]);
    const sampledTests = tests
      .filter((test) => test.question.trim() && test.knowledge_base_ids.length > 0)
      .slice(0, limit);
    const sampledKnowledgeBaseIds = [...new Set(sampledTests.flatMap((test) => test.knowledge_base_ids))];
    const publishedDocumentIds = new Set(
      documents
        .filter((document) =>
          sampledKnowledgeBaseIds.includes(document.knowledge_base_id) &&
          document.status === "ready" &&
          document.publish_status === "published"
        )
        .map((document) => document.id)
    );
    const chunks = sampledKnowledgeBaseIds.length > 0 && publishedDocumentIds.size > 0
      ? await readRecommendationSource(
        () => listDocumentChunksByScope({
          knowledgeBaseIds: sampledKnowledgeBaseIds,
          documentIds: [...publishedDocumentIds]
        }),
        "读取知识分片"
      )
      : [];
    const chunksByKnowledgeBase = groupChunksByKnowledgeBase(chunks);
    const knowledgeBaseNameById = new Map(knowledgeBases.map((kb) => [kb.id, kb.name]));
    const evaluations = sampledTests.map((test) =>
      evaluateTestForRecommendations({
        test,
        chunks: test.knowledge_base_ids.flatMap((kbId) => chunksByKnowledgeBase.get(kbId) ?? []),
        knowledgeBaseNameById
      })
    );
    const strategyRows = localRagStrategies.map((strategy) =>
      summarizeStrategy(strategy.id, strategy.label, evaluations.map((item) => item.results[strategy.id]))
    );
    const recommendations = buildRecommendations(evaluations, strategyRows);

    return NextResponse.json({
      generated_at: new Date().toISOString(),
      read_only: true,
      sample_count: sampledTests.length,
      document_count: publishedDocumentIds.size,
      chunk_count: chunks.length,
      recommendation_count: recommendations.length,
      high_priority_count: recommendations.filter((item) => item.priority === "high").length,
      strategy_summary: {
        baseline_strategy_id: "balanced",
        best_strategy_id: bestStrategyRow(strategyRows)?.strategy_id ?? "balanced",
        strategies: strategyRows
      },
      type_counts: summarizeRecommendationTypes(recommendations),
      priority_counts: summarizeRecommendationPriorities(recommendations),
      recommendations,
      notes: [
        "只读分析，不调用模型，不修改 QA 测试或知识库。",
        "建议基于 QA 样本、已发布分片、召回覆盖率、待确认治理建议和策略对比自动生成。",
        "执行补知识、治理分片或调整策略前，建议先定位样本人工确认。"
      ]
    });
  } catch (error) {
    if (isTransientRecommendationReadError(error)) {
      return NextResponse.json(buildDegradedReport(error));
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "生成自动治理建议失败" },
      { status: 400 }
    );
  }
}

async function readRecommendationSource<T>(loader: () => Promise<T>, label: string) {
  const pending = loader();
  pending.catch(() => undefined);

  return Promise.race([
    pending,
    sleep(recommendationReadTimeoutMs).then(() => {
      throw new Error(`${label}失败：Query inactivity timeout`);
    })
  ]);
}

function buildDegradedReport(error: unknown) {
  const message = error instanceof Error ? error.message : "数据库读取临时超时";

  return {
    generated_at: new Date().toISOString(),
    read_only: true,
    sample_count: 0,
    document_count: 0,
    chunk_count: 0,
    recommendation_count: 0,
    high_priority_count: 0,
    strategy_summary: {
      baseline_strategy_id: "balanced",
      best_strategy_id: "balanced",
      strategies: []
    },
    type_counts: summarizeRecommendationTypes([]),
    priority_counts: summarizeRecommendationPriorities([]),
    recommendations: [],
    notes: [
      "只读分析，不调用模型，不修改 QA 测试或知识库。",
      "远程数据库本次读取超时，已返回临时降级结果；请稍后重新生成建议。",
      message
    ]
  };
}

function evaluateTestForRecommendations(input: {
  test: QaTestCase;
  chunks: DocumentChunk[];
  knowledgeBaseNameById: Map<string, string>;
}) {
  const expectedTerms = extractEvaluationTerms(input.test.expected_answer ?? "", input.test.question);
  const results = Object.fromEntries(
    localRagStrategies.map((strategy) => [
      strategy.id,
      evaluateScenario(input.test.question, input.chunks, expectedTerms, strategy.id)
    ])
  ) as Record<LocalRagStrategyId, RecommendationTestResult>;
  const hasPendingSuggestion = input.chunks.some((chunk) => Boolean(chunk.metadata.pending_suggestion));
  const pendingResult = hasPendingSuggestion
    ? evaluateScenario(
      input.test.question,
      input.chunks.map(applyPendingSuggestion),
      expectedTerms,
      "balanced"
    )
    : null;

  return {
    test_id: input.test.id,
    question: input.test.question,
    knowledge_bases: input.test.knowledge_base_ids
      .map((id) => input.knowledgeBaseNameById.get(id) ?? id)
      .join("、"),
    expected_term_count: expectedTerms.length,
    results,
    pending_result: pendingResult
  };
}

function evaluateScenario(
  question: string,
  chunks: DocumentChunk[],
  expectedTerms: string[],
  strategyId: LocalRagStrategyId
): RecommendationTestResult {
  const strategy = localRagStrategies.find((item) => item.id === strategyId) ?? localRagStrategies[0];
  const hits = searchLocalTextRagInChunks({
    question,
    chunks,
    limit: 5,
    strategyId,
    useOverview: true
  });
  const diagnostics = evaluateLocalRagHits(hits);
  const coverage = expectedCoverageFromHits(hits, expectedTerms);
  const topHit = hits[0] ?? null;
  const topChunk = topHit?.chunk ?? null;

  return {
    strategy_id: strategy.id,
    strategy_label: strategy.label,
    hit: hits.length > 0,
    has_evidence: diagnostics.hasEvidence,
    confidence: diagnostics.confidence,
    coverage: coverage.coverage,
    matched_terms: coverage.matched,
    missing_terms: coverage.missing,
    top_score: topHit?.score ?? null,
    top_source: topChunk ? hitSourceLabel(topChunk) : null,
    top_chunk_id: topChunk?.id ?? null,
    top_document_id: topChunk?.document_id ?? null,
    dominant_signal: topHit?.dominantMatchSignal ?? null,
    false_positive_risk: diagnostics.hasEvidence && coverage.coverage < 25,
    top_chunk_has_governance: topChunk ? hasOfficialGovernanceMetadata(topChunk) : false,
    top_chunk_has_pending_suggestion: topChunk ? Boolean(topChunk.metadata.pending_suggestion) : false
  };
}

function summarizeStrategy(
  strategyId: LocalRagStrategyId,
  strategyLabel: string,
  results: RecommendationTestResult[]
) {
  const sampleCount = results.length;
  const hitCount = results.filter((result) => result.hit).length;
  const evidenceCount = results.filter((result) => result.has_evidence).length;
  const passCount = results.filter((result) => result.coverage >= 60).length;
  const noHitCount = results.filter((result) => !result.hit).length;
  const lowCoverageCount = results.filter((result) => result.hit && result.coverage < 60).length;
  const falsePositiveRiskCount = results.filter((result) => result.false_positive_risk).length;
  const topScores = results
    .map((result) => result.top_score)
    .filter((score): score is number => typeof score === "number" && Number.isFinite(score));

  return {
    strategy_id: strategyId,
    strategy_label: strategyLabel,
    sample_count: sampleCount,
    hit_count: hitCount,
    hit_rate: percent(hitCount, sampleCount),
    evidence_count: evidenceCount,
    evidence_rate: percent(evidenceCount, sampleCount),
    pass_count: passCount,
    pass_rate: percent(passCount, sampleCount),
    no_hit_count: noHitCount,
    low_coverage_count: lowCoverageCount,
    false_positive_risk_count: falsePositiveRiskCount,
    average_coverage: average(results.map((result) => result.coverage)),
    average_top_score: average(topScores)
  };
}

function buildRecommendations(
  evaluations: ReturnType<typeof evaluateTestForRecommendations>[],
  strategyRows: ReturnType<typeof summarizeStrategy>[]
) {
  const recommendations: GovernanceRecommendation[] = [];
  const baselineStrategy = strategyRows.find((row) => row.strategy_id === "balanced") ?? null;
  const bestStrategy = bestStrategyRow(strategyRows);

  if (baselineStrategy && bestStrategy && bestStrategy.strategy_id !== "balanced") {
    const passRateDelta = bestStrategy.pass_rate - baselineStrategy.pass_rate;
    const coverageDelta = bestStrategy.average_coverage - baselineStrategy.average_coverage;

    if (passRateDelta >= 5 || coverageDelta >= 5) {
      const affectedCount = evaluations.filter((evaluation) =>
        evaluation.results[bestStrategy.strategy_id].coverage > evaluation.results.balanced.coverage
      ).length;
      recommendations.push({
        id: `strategy-${bestStrategy.strategy_id}`,
        type: "adjust_retrieval_strategy",
        type_label: "调召回策略",
        priority: passRateDelta >= 10 || coverageDelta >= 10 ? "high" : "medium",
        title: `灰度验证「${bestStrategy.strategy_label}」策略`,
        description: `当前样本中该策略高覆盖率提升 ${formatSignedPercent(passRateDelta)}，平均覆盖提升 ${formatSignedPercent(coverageDelta)}。建议先对风险题复测，再决定是否调整线上默认权重。`,
        reason: "策略对比显示非默认策略在 QA 样本上表现更好。",
        action_label: "复跑低覆盖",
        action_filter: "low_coverage",
        action_href: null,
        test_id: null,
        question: null,
        knowledge_bases: null,
        target_document_id: null,
        target_chunk_id: null,
        target_source: null,
        current_coverage: baselineStrategy.average_coverage,
        expected_coverage: bestStrategy.average_coverage,
        missing_terms: [],
        affected_count: affectedCount,
        impact_score: Math.max(passRateDelta, coverageDelta) + affectedCount
      });
    }
  }

  for (const evaluation of evaluations) {
    const baseline = evaluation.results.balanced;
    const best = Object.values(evaluation.results).sort((a, b) =>
      b.coverage - a.coverage ||
      Number(b.has_evidence) - Number(a.has_evidence) ||
      (b.top_score ?? 0) - (a.top_score ?? 0)
    )[0];

    if (!baseline.hit || !baseline.has_evidence) {
      recommendations.push({
        id: `supplement-${evaluation.test_id}`,
        type: "supplement_knowledge",
        type_label: "补知识",
        priority: "high",
        title: "补充缺失知识或检查知识库范围",
        description: "当前问题没有命中可信分片，优先补充标准依据，或确认该问题绑定的知识库范围是否正确。",
        reason: baseline.hit ? "召回分片证据不足。" : "没有召回到可用分片。",
        action_label: "定位题目",
        action_filter: "knowledge_miss",
        action_href: null,
        test_id: evaluation.test_id,
        question: evaluation.question,
        knowledge_bases: evaluation.knowledge_bases,
        target_document_id: null,
        target_chunk_id: null,
        target_source: null,
        current_coverage: baseline.coverage,
        expected_coverage: 60,
        missing_terms: baseline.missing_terms.slice(0, 6),
        affected_count: 1,
        impact_score: 120 - baseline.coverage
      });
      continue;
    }

    if (baseline.false_positive_risk) {
      recommendations.push({
        id: `false-positive-${evaluation.test_id}`,
        type: "review_false_positive",
        type_label: "复核误召回",
        priority: baseline.coverage < 15 ? "high" : "medium",
        title: "人工复核疑似误召回来源",
        description: "系统命中了资料，但期望关键词覆盖很低，可能是分片看起来相关但无法支撑答案。",
        reason: `当前覆盖 ${baseline.coverage}%，低于误召回风险阈值。`,
        action_label: "打开资料治理",
        action_filter: "low_coverage",
        action_href: buildDocumentHref(baseline),
        test_id: evaluation.test_id,
        question: evaluation.question,
        knowledge_bases: evaluation.knowledge_bases,
        target_document_id: baseline.top_document_id,
        target_chunk_id: baseline.top_chunk_id,
        target_source: baseline.top_source,
        current_coverage: baseline.coverage,
        expected_coverage: 60,
        missing_terms: baseline.missing_terms.slice(0, 6),
        affected_count: 1,
        impact_score: 105 - baseline.coverage
      });
    }

    if (evaluation.pending_result) {
      const pendingDelta = evaluation.pending_result.coverage - baseline.coverage;

      if (pendingDelta >= 10 && baseline.coverage < 80) {
        recommendations.push({
          id: `pending-governance-${evaluation.test_id}`,
          type: "improve_chunk_governance",
          type_label: "治理分片",
          priority: pendingDelta >= 25 || evaluation.pending_result.coverage >= 60 ? "high" : "medium",
          title: "确认待治理建议后复测",
          description: `临时应用待确认摘要/关键词/同义词后，覆盖率预计从 ${baseline.coverage}% 到 ${evaluation.pending_result.coverage}%。`,
          reason: "已有 pending_suggestion 可能改善召回，可先在资料治理页确认。",
          action_label: "打开资料治理",
          action_filter: "low_coverage",
          action_href: buildDocumentHref(evaluation.pending_result) ?? buildDocumentHref(baseline),
          test_id: evaluation.test_id,
          question: evaluation.question,
          knowledge_bases: evaluation.knowledge_bases,
          target_document_id: evaluation.pending_result.top_document_id ?? baseline.top_document_id,
          target_chunk_id: evaluation.pending_result.top_chunk_id ?? baseline.top_chunk_id,
          target_source: evaluation.pending_result.top_source ?? baseline.top_source,
          current_coverage: baseline.coverage,
          expected_coverage: evaluation.pending_result.coverage,
          missing_terms: evaluation.pending_result.missing_terms.slice(0, 6),
          affected_count: 1,
          impact_score: 90 + pendingDelta
        });
      }
    }

    if (baseline.coverage < 60 && baseline.top_chunk_id) {
      const needsGovernance = !baseline.top_chunk_has_governance || baseline.top_chunk_has_pending_suggestion;

      if (needsGovernance) {
        recommendations.push({
          id: `chunk-governance-${evaluation.test_id}`,
          type: "improve_chunk_governance",
          type_label: "治理分片",
          priority: baseline.coverage < 40 ? "high" : "medium",
          title: baseline.top_chunk_has_pending_suggestion ? "处理分片待确认建议" : "补充分片摘要、关键词和同义词",
          description: "当前已命中来源，但覆盖不足。优先完善命中分片的治理字段，让员工问法和资料原文更容易对齐。",
          reason: baseline.top_chunk_has_pending_suggestion ? "命中分片存在待确认治理建议。" : "命中分片缺少治理字段。",
          action_label: "打开资料治理",
          action_filter: "low_coverage",
          action_href: buildDocumentHref(baseline),
          test_id: evaluation.test_id,
          question: evaluation.question,
          knowledge_bases: evaluation.knowledge_bases,
          target_document_id: baseline.top_document_id,
          target_chunk_id: baseline.top_chunk_id,
          target_source: baseline.top_source,
          current_coverage: baseline.coverage,
          expected_coverage: 60,
          missing_terms: baseline.missing_terms.slice(0, 6),
          affected_count: 1,
          impact_score: 80 - baseline.coverage
        });
      }
    }

    if (
      best.strategy_id !== "balanced" &&
      best.coverage - baseline.coverage >= 20 &&
      baseline.coverage < 60
    ) {
      recommendations.push({
        id: `test-strategy-${evaluation.test_id}-${best.strategy_id}`,
        type: "adjust_retrieval_strategy",
        type_label: "调召回策略",
        priority: best.coverage >= 60 ? "medium" : "low",
        title: `该题更适合「${best.strategy_label}」策略`,
        description: `当前策略覆盖 ${baseline.coverage}%，${best.strategy_label} 可到 ${best.coverage}%。建议把这类问题加入复测集，验证是否需要调权重。`,
        reason: "单题策略对比存在明显差异。",
        action_label: "定位题目",
        action_filter: "low_coverage",
        action_href: null,
        test_id: evaluation.test_id,
        question: evaluation.question,
        knowledge_bases: evaluation.knowledge_bases,
        target_document_id: best.top_document_id,
        target_chunk_id: best.top_chunk_id,
        target_source: best.top_source,
        current_coverage: baseline.coverage,
        expected_coverage: best.coverage,
        missing_terms: best.missing_terms.slice(0, 6),
        affected_count: 1,
        impact_score: 40 + best.coverage - baseline.coverage
      });
    }
  }

  return recommendations
    .sort((a, b) =>
      priorityScore(b.priority) - priorityScore(a.priority) ||
      b.impact_score - a.impact_score ||
      typeScore(b.type) - typeScore(a.type)
    )
    .slice(0, 18);
}

function bestStrategyRow(strategyRows: ReturnType<typeof summarizeStrategy>[]) {
  return [...strategyRows].sort((a, b) =>
    b.pass_rate - a.pass_rate ||
    b.average_coverage - a.average_coverage ||
    b.hit_rate - a.hit_rate ||
    b.average_top_score - a.average_top_score
  )[0] ?? null;
}

function summarizeRecommendationTypes(recommendations: GovernanceRecommendation[]) {
  return {
    supplement_knowledge: recommendations.filter((item) => item.type === "supplement_knowledge").length,
    improve_chunk_governance: recommendations.filter((item) => item.type === "improve_chunk_governance").length,
    adjust_retrieval_strategy: recommendations.filter((item) => item.type === "adjust_retrieval_strategy").length,
    review_false_positive: recommendations.filter((item) => item.type === "review_false_positive").length
  };
}

function summarizeRecommendationPriorities(recommendations: GovernanceRecommendation[]) {
  return {
    high: recommendations.filter((item) => item.priority === "high").length,
    medium: recommendations.filter((item) => item.priority === "medium").length,
    low: recommendations.filter((item) => item.priority === "low").length
  };
}

function priorityScore(priority: GovernanceRecommendationPriority) {
  if (priority === "high") {
    return 3;
  }

  if (priority === "medium") {
    return 2;
  }

  return 1;
}

function typeScore(type: GovernanceRecommendationType) {
  if (type === "supplement_knowledge") {
    return 4;
  }

  if (type === "review_false_positive") {
    return 3;
  }

  if (type === "improve_chunk_governance") {
    return 2;
  }

  return 1;
}

function buildDocumentHref(result: RecommendationTestResult) {
  if (!result.top_document_id) {
    return null;
  }

  const chunkQuery = result.top_chunk_id ? `&chunk=${encodeURIComponent(result.top_chunk_id)}` : "";
  return `/admin/documents?document=${encodeURIComponent(result.top_document_id)}${chunkQuery}`;
}

function applyPendingSuggestion(chunk: DocumentChunk): DocumentChunk {
  const suggestion = chunk.metadata.pending_suggestion;
  if (!suggestion) {
    return chunk;
  }

  return {
    ...chunk,
    metadata: {
      ...chunk.metadata,
      summary: cleanText(suggestion.summary, 600),
      keywords: cleanList(suggestion.keywords, 24, 36),
      synonyms: cleanList(suggestion.synonyms, 36, 36)
    }
  };
}

function hasOfficialGovernanceMetadata(chunk: DocumentChunk) {
  return Boolean(chunk.metadata.summary || chunk.metadata.keywords?.length || chunk.metadata.synonyms?.length);
}

function expectedCoverageFromHits(hits: ReturnType<typeof searchLocalTextRagInChunks>, expectedTerms: string[]) {
  if (expectedTerms.length === 0) {
    return {
      coverage: hits.length > 0 ? 100 : 0,
      matched: [] as string[],
      missing: [] as string[]
    };
  }

  const context = normalizeCoverageText(
    hits.map((hit) => [
      hit.chunk.content,
      hit.chunk.metadata.title,
      hit.chunk.metadata.file_name,
      hit.chunk.metadata.section,
      hit.chunk.metadata.summary,
      ...(hit.chunk.metadata.keywords ?? []),
      ...(hit.chunk.metadata.synonyms ?? [])
    ].filter(Boolean).join(" ")).join(" ")
  );
  const matched = expectedTerms.filter((term) => context.includes(normalizeCoverageText(term)));
  const missing = expectedTerms.filter((term) => !matched.includes(term));

  return {
    coverage: Math.round((matched.length / expectedTerms.length) * 100),
    matched,
    missing
  };
}

function extractEvaluationTerms(expectedAnswer: string, question: string) {
  const primary = extractTerms(expectedAnswer);
  if (primary.length > 0) {
    return primary;
  }

  return extractTerms(question);
}

function extractTerms(value: string) {
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
    "回归",
    "什么",
    "如何",
    "怎么",
    "哪些",
    "是否"
  ]);

  return [
    ...new Set(
      value
        .replace(/资料「[^」]+」/g, " ")
        .replace(/文档「[^」]+」/g, " ")
        .replace(/主要内容应(?:包括|包含)/g, " ")
        .replace(/应(?:概括|说明|包括|包含|提到)/g, " ")
        .replace(/并?至少提到/g, " ")
        .replace(/目录(?:包括|包含)/g, " ")
        .replace(/(?:参考|标准)?答案/g, " ")
        .replace(/[，。！？、；：,.!?;:]/g, " ")
        .split(/\s+/)
        .flatMap((part) => part.match(/[a-z0-9\u4e00-\u9fa5]{2,}/gi) ?? [])
        .map((term) => term.trim())
        .flatMap(expandLongEvaluationTerm)
        .filter((term) => term.length >= 2 && !stopWords.has(term) && !stopWords.has(term.toLowerCase()))
    )
  ].slice(0, 12);
}

function expandLongEvaluationTerm(term: string) {
  if (!/^[\u4e00-\u9fa5]+$/.test(term) || term.length <= 8) {
    return [term];
  }

  const normalized = term
    .replace(/不得|必须|需要|应该|可以|进行|处理|需由|需按|之前|以后|之后|并且|以及|或者|如果|时候/g, "")
    .trim();

  if (normalized.length <= 8) {
    return [normalized || term];
  }

  const grams: string[] = [];
  for (let index = 0; index <= normalized.length - 4; index += 2) {
    const gram = normalized.slice(index, index + 4);
    if (!isLowSignalEvaluationTerm(gram)) {
      grams.push(gram);
    }
  }

  return grams.length > 0 ? grams.slice(0, 6) : [term];
}

function isLowSignalEvaluationTerm(term: string) {
  return /^[的是了和在有可需应按后前再或与及]+$/.test(term);
}

function normalizeCoverageText(value: string) {
  return value
    .toLowerCase()
    .replace(/[^\da-z\u3400-\u9fff]+/g, "")
    .trim();
}

function groupChunksByKnowledgeBase(chunks: DocumentChunk[]) {
  const groups = new Map<string, DocumentChunk[]>();

  for (const chunk of chunks) {
    groups.set(chunk.knowledge_base_id, [...(groups.get(chunk.knowledge_base_id) ?? []), chunk]);
  }

  return groups;
}

function hitSourceLabel(chunk: DocumentChunk) {
  const source = chunk.metadata.file_name ?? chunk.metadata.title ?? chunk.document_id;
  const parts = [source];

  if (chunk.metadata.page) {
    parts.push(`第 ${chunk.metadata.page} 页`);
  }
  if (chunk.metadata.section) {
    parts.push(chunk.metadata.section);
  }

  return parts.join(" · ");
}

function cleanText(value: unknown, maxLength: number) {
  if (typeof value !== "string") {
    return "";
  }

  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function cleanList(value: unknown, maxItems: number, maxLength: number) {
  const source = Array.isArray(value) ? value : [];
  const seen = new Set<string>();
  const result: string[] = [];

  for (const rawItem of source) {
    const item = cleanText(rawItem, maxLength);
    const key = item.toLowerCase();
    if (!item || seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(item);

    if (result.length >= maxItems) {
      break;
    }
  }

  return result;
}

function average(values: number[]) {
  if (values.length === 0) {
    return 0;
  }

  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 100) / 100;
}

function percent(value: number, total: number) {
  return total > 0 ? Math.round((value / total) * 100) : 0;
}

function formatSignedPercent(value: number) {
  return `${value > 0 ? "+" : ""}${value}%`;
}

function clampInt(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.max(min, Math.min(max, Math.round(value)));
}

function isTransientRecommendationReadError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);

  return [
    "Query inactivity timeout",
    "Pool is closed",
    "ETIMEDOUT",
    "ECONNRESET",
    "PROTOCOL_CONNECTION_LOST",
    "Can't add new command when connection is in closed state"
  ].some((keyword) => message.includes(keyword));
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
