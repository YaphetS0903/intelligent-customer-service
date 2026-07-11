import { NextResponse } from "next/server";
import { isLocalTextRag } from "@/lib/config";
import { listDocumentChunksByScope, listDocuments, listKnowledgeBases, listQaTestCases, requireAdmin } from "@/lib/db";
import {
  evaluateLocalRagHits,
  searchLocalTextRagInChunks,
  type LocalRagStrategyId
} from "@/lib/local-rag";
import type { CitationDominantMatchSignal, DocumentChunk, QaTestCase } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type GovernanceImpactResult = {
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
  false_positive_risk: boolean;
};

export async function GET(request: Request) {
  try {
    await requireAdmin();

    if (!isLocalTextRag()) {
      return NextResponse.json(
        { error: "治理前后效果对比仅支持 local_text RAG。" },
        { status: 400 }
      );
    }

    const url = new URL(request.url);
    const limit = clampInt(Number(url.searchParams.get("limit") ?? 60), 5, 100);
    const strategyId = "balanced" satisfies LocalRagStrategyId;
    const tests = await readGovernanceSource(
      () => listQaTestCases({ compactCitations: true }),
      "读取 QA 测试"
    );
    const knowledgeBases = await readGovernanceSource(
      () => listKnowledgeBases(),
      "读取知识库"
    );
    const documents = await readGovernanceSource(
      () => listDocuments(),
      "读取资料文档"
    );
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
      ? await readGovernanceSource(
        () => listDocumentChunksByScope({
          knowledgeBaseIds: sampledKnowledgeBaseIds,
          documentIds: [...publishedDocumentIds]
        }),
        "读取知识分片"
      )
      : [];
    const pendingSuggestionCount = chunks.filter((chunk) => Boolean(chunk.metadata.pending_suggestion)).length;
    const currentGovernedCount = chunks.filter((chunk) => hasOfficialGovernanceMetadata(chunk)).length;
    const mode = pendingSuggestionCount > 0 ? "pending_suggestion_preview" : "current_governance_effect";
    const beforeChunks = mode === "pending_suggestion_preview" ? chunks : chunks.map(stripGovernanceMetadata);
    const afterChunks = mode === "pending_suggestion_preview" ? chunks.map(applyPendingSuggestion) : chunks;
    const beforeByKnowledgeBase = groupChunksByKnowledgeBase(beforeChunks);
    const afterByKnowledgeBase = groupChunksByKnowledgeBase(afterChunks);
    const knowledgeBaseNameById = new Map(knowledgeBases.map((kb) => [kb.id, kb.name]));
    const evaluations = sampledTests.map((test) =>
      evaluateGovernanceImpactForTest({
        test,
        beforeChunks: test.knowledge_base_ids.flatMap((kbId) => beforeByKnowledgeBase.get(kbId) ?? []),
        afterChunks: test.knowledge_base_ids.flatMap((kbId) => afterByKnowledgeBase.get(kbId) ?? []),
        knowledgeBaseNameById,
        strategyId
      })
    );
    const beforeSummary = summarizeResults(evaluations.map((row) => row.before));
    const afterSummary = summarizeResults(evaluations.map((row) => row.after));

    return NextResponse.json({
      generated_at: new Date().toISOString(),
      mode,
      mode_label: mode === "pending_suggestion_preview" ? "待确认建议应用预览" : "当前治理字段贡献",
      strategy_id: strategyId,
      sample_count: sampledTests.length,
      document_count: publishedDocumentIds.size,
      chunk_count: chunks.length,
      pending_suggestion_count: pendingSuggestionCount,
      governed_chunk_count: currentGovernedCount,
      before: beforeSummary,
      after: afterSummary,
      delta: {
        pass_rate: afterSummary.pass_rate - beforeSummary.pass_rate,
        average_coverage: afterSummary.average_coverage - beforeSummary.average_coverage,
        false_positive_risk_count: afterSummary.false_positive_risk_count - beforeSummary.false_positive_risk_count,
        newly_passed_count: evaluations.filter((row) => row.before.coverage < 60 && row.after.coverage >= 60).length,
        newly_risky_count: evaluations.filter((row) => !row.before.false_positive_risk && row.after.false_positive_risk).length,
        improved_count: evaluations.filter((row) => row.after.coverage > row.before.coverage).length,
        regressed_count: evaluations.filter((row) => row.after.coverage < row.before.coverage).length
      },
      comparison_rows: buildComparisonRows(evaluations),
      notes: [
        "只读评估，不调用模型，不修改 QA 测试或知识库。",
        mode === "pending_suggestion_preview"
          ? "对比当前知识分片与临时应用 pending_suggestion 后的召回效果。"
          : "当前没有待确认建议，改为对比关闭治理字段与当前治理字段的召回差异。",
        "覆盖率基于期望答案关键词在召回分片正文与治理字段中的出现情况估算。",
        "误召回风险表示召回有证据但期望关键词覆盖低于 25%。"
      ]
    });
  } catch (error) {
    if (isTransientGovernanceReadError(error)) {
      return NextResponse.json(buildDegradedReport(error));
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "生成治理前后效果对比失败" },
      { status: 400 }
    );
  }
}

async function readGovernanceSource<T>(loader: () => Promise<T>, label: string) {
  const pending = loader();
  pending.catch(() => undefined);

  return Promise.race([
    pending,
    sleep(8000).then(() => {
      throw new Error(`${label}失败：Query inactivity timeout`);
    })
  ]);
}

function buildDegradedReport(error: unknown) {
  const message = error instanceof Error ? error.message : "数据库读取临时超时";
  const emptySummary = summarizeResults([]);

  return {
    generated_at: new Date().toISOString(),
    mode: "current_governance_effect",
    mode_label: "数据库读取临时超时",
    strategy_id: "balanced",
    sample_count: 0,
    document_count: 0,
    chunk_count: 0,
    pending_suggestion_count: 0,
    governed_chunk_count: 0,
    before: emptySummary,
    after: emptySummary,
    delta: {
      pass_rate: 0,
      average_coverage: 0,
      false_positive_risk_count: 0,
      newly_passed_count: 0,
      newly_risky_count: 0,
      improved_count: 0,
      regressed_count: 0
    },
    comparison_rows: [],
    notes: [
      "只读评估，不调用模型，不修改 QA 测试或知识库。",
      "远程数据库本次读取超时，已返回临时降级结果；请稍后重新对比。",
      message
    ]
  };
}

function evaluateGovernanceImpactForTest(input: {
  test: QaTestCase;
  beforeChunks: DocumentChunk[];
  afterChunks: DocumentChunk[];
  knowledgeBaseNameById: Map<string, string>;
  strategyId: LocalRagStrategyId;
}) {
  const expectedTerms = extractEvaluationTerms(input.test.expected_answer ?? "", input.test.question);
  const before = evaluateScenario(input.test.question, input.beforeChunks, expectedTerms, input.strategyId);
  const after = evaluateScenario(input.test.question, input.afterChunks, expectedTerms, input.strategyId);

  return {
    test_id: input.test.id,
    question: input.test.question,
    knowledge_bases: input.test.knowledge_base_ids
      .map((id) => input.knowledgeBaseNameById.get(id) ?? id)
      .join("、"),
    expected_term_count: expectedTerms.length,
    before,
    after
  };
}

function evaluateScenario(
  question: string,
  chunks: DocumentChunk[],
  expectedTerms: string[],
  strategyId: LocalRagStrategyId
): GovernanceImpactResult {
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

  return {
    hit: hits.length > 0,
    has_evidence: diagnostics.hasEvidence,
    confidence: diagnostics.confidence,
    coverage: coverage.coverage,
    matched_terms: coverage.matched,
    missing_terms: coverage.missing,
    top_score: topHit?.score ?? null,
    top_source: topHit ? hitSourceLabel(topHit.chunk) : null,
    top_chunk_id: topHit?.chunk.id ?? null,
    dominant_signal: topHit?.dominantMatchSignal ?? null,
    false_positive_risk: diagnostics.hasEvidence && coverage.coverage < 25
  };
}

function summarizeResults(results: GovernanceImpactResult[]) {
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

function buildComparisonRows(evaluations: ReturnType<typeof evaluateGovernanceImpactForTest>[]) {
  return evaluations
    .map((evaluation) => {
      const delta = evaluation.after.coverage - evaluation.before.coverage;
      const riskDelta = Number(evaluation.after.false_positive_risk) - Number(evaluation.before.false_positive_risk);
      const sourceChanged = evaluation.before.top_chunk_id !== evaluation.after.top_chunk_id;

      return {
        test_id: evaluation.test_id,
        question: evaluation.question,
        knowledge_bases: evaluation.knowledge_bases,
        expected_term_count: evaluation.expected_term_count,
        before_coverage: evaluation.before.coverage,
        after_coverage: evaluation.after.coverage,
        delta,
        before_top_source: evaluation.before.top_source,
        after_top_source: evaluation.after.top_source,
        before_top_score: evaluation.before.top_score,
        after_top_score: evaluation.after.top_score,
        before_false_positive_risk: evaluation.before.false_positive_risk,
        after_false_positive_risk: evaluation.after.false_positive_risk,
        risk_delta: riskDelta,
        source_changed: sourceChanged,
        missing_terms: evaluation.after.missing_terms.slice(0, 6)
      };
    })
    .filter((row) =>
      row.expected_term_count > 0 &&
      (row.delta !== 0 || row.risk_delta !== 0 || row.source_changed || row.after_coverage < 60)
    )
    .sort((a, b) =>
      Math.abs(b.delta) - Math.abs(a.delta) ||
      Math.abs(b.risk_delta) - Math.abs(a.risk_delta) ||
      a.after_coverage - b.after_coverage
    )
    .slice(0, 12);
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

function stripGovernanceMetadata(chunk: DocumentChunk): DocumentChunk {
  const metadata = { ...chunk.metadata };
  delete metadata.summary;
  delete metadata.keywords;
  delete metadata.synonyms;

  return {
    ...chunk,
    metadata
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

function clampInt(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.max(min, Math.min(max, Math.round(value)));
}

function isTransientGovernanceReadError(error: unknown) {
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
