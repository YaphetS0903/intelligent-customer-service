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

type StrategyTestResult = {
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
  dominant_signal: CitationDominantMatchSignal | null;
};

export async function GET(request: Request) {
  try {
    await requireAdmin();

    if (!isLocalTextRag()) {
      return NextResponse.json(
        { error: "当前召回策略对比仅支持 local_text RAG。" },
        { status: 400 }
      );
    }

    const url = new URL(request.url);
    const limit = clampInt(Number(url.searchParams.get("limit") ?? 40), 5, 80);
    const [tests, knowledgeBases, documents] = await Promise.all([
      listQaTestCases({ compactCitations: true }),
      listKnowledgeBases(),
      listDocuments()
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
      ? await listDocumentChunksByScope({
        knowledgeBaseIds: sampledKnowledgeBaseIds,
        documentIds: [...publishedDocumentIds]
      })
      : [];
    const chunksByKnowledgeBaseId = groupChunksByKnowledgeBase(chunks);
    const knowledgeBaseNameById = new Map(knowledgeBases.map((kb) => [kb.id, kb.name]));
    const evaluations = sampledTests.map((test) =>
      evaluateTestAcrossStrategies({
        test,
        chunks: test.knowledge_base_ids.flatMap((kbId) => chunksByKnowledgeBaseId.get(kbId) ?? []),
        knowledgeBaseNameById
      })
    );
    const strategyRows = localRagStrategies.map((strategy) =>
      summarizeStrategy(strategy.id, strategy.label, evaluations.map((item) => item.results[strategy.id]))
    );
    const bestStrategy = [...strategyRows].sort((a, b) =>
      b.pass_rate - a.pass_rate ||
      b.average_coverage - a.average_coverage ||
      b.hit_rate - a.hit_rate ||
      b.average_top_score - a.average_top_score
    )[0];

    return NextResponse.json({
      generated_at: new Date().toISOString(),
      sample_count: sampledTests.length,
      document_count: publishedDocumentIds.size,
      chunk_count: chunks.length,
      baseline_strategy_id: "balanced",
      best_strategy_id: bestStrategy?.strategy_id ?? "balanced",
      strategies: strategyRows,
      comparison_rows: buildComparisonRows(evaluations),
      notes: [
        "只读评估，不调用模型，不修改 QA 测试或知识库。",
        "覆盖率基于期望答案关键词在召回分片正文中的出现情况估算。",
        "误召回风险表示召回有证据但期望关键词覆盖低于 25%。"
      ]
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "生成召回策略对比失败" },
      { status: 400 }
    );
  }
}

function evaluateTestAcrossStrategies(input: {
  test: QaTestCase;
  chunks: DocumentChunk[];
  knowledgeBaseNameById: Map<string, string>;
}) {
  const expectedTerms = extractEvaluationTerms(input.test.expected_answer ?? "", input.test.question);
  const results = Object.fromEntries(
    localRagStrategies.map((strategy) => {
      const hits = searchLocalTextRagInChunks({
        question: input.test.question,
        chunks: input.chunks,
        limit: 5,
        strategyId: strategy.id,
        useOverview: true
      });
      const diagnostics = evaluateLocalRagHits(hits);
      const coverage = expectedCoverageFromHits(hits, expectedTerms);
      const topHit = hits[0] ?? null;
      const result: StrategyTestResult = {
        strategy_id: strategy.id,
        strategy_label: strategy.label,
        hit: hits.length > 0,
        has_evidence: diagnostics.hasEvidence,
        confidence: diagnostics.confidence,
        coverage: coverage.coverage,
        matched_terms: coverage.matched,
        missing_terms: coverage.missing,
        top_score: topHit?.score ?? null,
        top_source: topHit ? hitSourceLabel(topHit.chunk) : null,
        top_chunk_id: topHit?.chunk.id ?? null,
        dominant_signal: topHit?.dominantMatchSignal ?? null
      };

      return [strategy.id, result];
    })
  ) as Record<LocalRagStrategyId, StrategyTestResult>;

  return {
    test_id: input.test.id,
    question: input.test.question,
    knowledge_bases: input.test.knowledge_base_ids
      .map((id) => input.knowledgeBaseNameById.get(id) ?? id)
      .join("、"),
    expected_term_count: expectedTerms.length,
    results
  };
}

function summarizeStrategy(
  strategyId: LocalRagStrategyId,
  strategyLabel: string,
  results: StrategyTestResult[]
) {
  const sampleCount = results.length;
  const hitCount = results.filter((result) => result.hit).length;
  const evidenceCount = results.filter((result) => result.has_evidence).length;
  const passCount = results.filter((result) => result.coverage >= 60).length;
  const noHitCount = results.filter((result) => !result.hit).length;
  const lowCoverageCount = results.filter((result) => result.hit && result.coverage < 60).length;
  const falsePositiveRiskCount = results.filter((result) => result.has_evidence && result.coverage < 25).length;
  const topScores = results
    .map((result) => result.top_score)
    .filter((score): score is number => typeof score === "number" && Number.isFinite(score));
  const dominantSignals = new Map<CitationDominantMatchSignal, number>();

  for (const result of results) {
    if (result.dominant_signal) {
      dominantSignals.set(result.dominant_signal, (dominantSignals.get(result.dominant_signal) ?? 0) + 1);
    }
  }

  return {
    strategy_id: strategyId,
    strategy_label: strategyLabel,
    description: localRagStrategies.find((strategy) => strategy.id === strategyId)?.description ?? "",
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
    average_top_score: average(topScores),
    dominant_signals: [...dominantSignals.entries()]
      .map(([signal, count]) => ({
        signal,
        label: dominantSignalLabel(signal),
        count
      }))
      .sort((a, b) => b.count - a.count)
  };
}

function buildComparisonRows(evaluations: ReturnType<typeof evaluateTestAcrossStrategies>[]) {
  return evaluations
    .map((evaluation) => {
      const baseline = evaluation.results.balanced;
      const best = Object.values(evaluation.results).sort((a, b) =>
        b.coverage - a.coverage ||
        Number(b.has_evidence) - Number(a.has_evidence) ||
        (b.top_score ?? 0) - (a.top_score ?? 0)
      )[0];
      return {
        test_id: evaluation.test_id,
        question: evaluation.question,
        knowledge_bases: evaluation.knowledge_bases,
        expected_term_count: evaluation.expected_term_count,
        baseline_coverage: baseline.coverage,
        best_strategy_id: best.strategy_id,
        best_strategy_label: best.strategy_label,
        best_coverage: best.coverage,
        delta: best.coverage - baseline.coverage,
        top_source: best.top_source,
        top_score: best.top_score,
        missing_terms: best.missing_terms.slice(0, 6)
      };
    })
    .filter((row) => row.expected_term_count > 0 && (row.delta !== 0 || row.best_coverage < 60))
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || a.best_coverage - b.best_coverage)
    .slice(0, 10);
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

function dominantSignalLabel(signal: CitationDominantMatchSignal) {
  const labels: Record<CitationDominantMatchSignal, string> = {
    content: "正文",
    summary: "摘要",
    keywords: "关键词",
    synonyms: "同义词",
    metadata: "元数据",
    semantic: "语义",
    mixed: "混合"
  };

  return labels[signal];
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

function clampInt(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.max(min, Math.min(max, Math.round(value)));
}
