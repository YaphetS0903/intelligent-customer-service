import { env } from "@/lib/config";
import { listDocumentChunksByScope } from "@/lib/db";
import type { Citation, CitationDominantMatchSignal, CitationMatchSignalKey, DocumentChunk, KnowledgeBase } from "@/lib/types";

export type LocalRagHit = {
  chunk: DocumentChunk;
  quote: string;
  score: number;
  matchedTerms: string[];
  scoreReason: string;
  matchSignals?: Citation["match_signals"];
  matchSignalTerms?: Citation["match_signal_terms"];
  dominantMatchSignal?: Citation["dominant_match_signal"];
};

export type LocalRagRetrievalDiagnostics = {
  hasEvidence: boolean;
  confidence: "none" | "low" | "medium" | "high";
  reason: string;
  hitCount: number;
  uniqueDocuments: number;
  topScore: number;
  averageTopScore: number;
  matchedTerms: string[];
};

const stopWords = new Set([
  "的",
  "了",
  "和",
  "是",
  "在",
  "有",
  "员工",
  "培训",
  "手册",
  "什么",
  "如何",
  "怎么",
  "需要",
  "哪些",
  "应该",
  "处理",
  "操作",
  "流程",
  "步骤",
  "页面",
  "功能",
  "系统",
  "可以",
  "是否",
  "有没有",
  "这里",
  "那里",
  "这个",
  "那个",
  "为什么",
  "回答",
  "根据",
  "一下",
  "一下子",
  "公司",
  "请问",
  "the",
  "and",
  "for",
  "with"
]);

type WeightedTerm = {
  value: string;
  weight: number;
  kind: "phrase" | "term" | "bigram" | "alias";
};

export type LocalRagStrategyId = "balanced" | "content_first" | "governance_enhanced" | "synonym_expanded";

type LocalRagStrategyWeights = {
  content: number;
  title: number;
  section: number;
  sheet: number;
  summary: number;
  keywords: number;
  synonyms: number;
  fileName: number;
  semantic: number;
  proximity: number;
  structural: number;
  page: number;
  parser: number;
  recency: number;
  coverage: number;
  candidateRatio: number;
  termKinds?: Partial<Record<WeightedTerm["kind"], number>>;
};

export type LocalRagStrategyDefinition = {
  id: LocalRagStrategyId;
  label: string;
  description: string;
  weights: LocalRagStrategyWeights;
};

export const localRagStrategies: LocalRagStrategyDefinition[] = [
  {
    id: "balanced",
    label: "当前平衡策略",
    description: "沿用线上默认权重，兼顾正文、结构信息、摘要、关键词、同义词和语义相似度。",
    weights: {
      content: 1,
      title: 4,
      section: 3,
      sheet: 2.5,
      summary: 2.2,
      keywords: 3,
      synonyms: 3,
      fileName: 0.25,
      semantic: 1,
      proximity: 1,
      structural: 1,
      page: 1,
      parser: 1,
      recency: 1,
      coverage: 1,
      candidateRatio: 0.28
    }
  },
  {
    id: "content_first",
    label: "正文优先",
    description: "提高正文命中权重，降低摘要和同义词干扰，适合制度原文表达清楚的资料。",
    weights: {
      content: 1.35,
      title: 3,
      section: 2.4,
      sheet: 2,
      summary: 1.45,
      keywords: 1.75,
      synonyms: 1.35,
      fileName: 0.18,
      semantic: 0.8,
      proximity: 1.1,
      structural: 0.75,
      page: 0.75,
      parser: 0.75,
      recency: 0.8,
      coverage: 1,
      candidateRatio: 0.3
    }
  },
  {
    id: "governance_enhanced",
    label: "摘要关键词增强",
    description: "提高治理后的摘要、关键词和结构信息权重，用于验证分片治理是否真的提升召回。",
    weights: {
      content: 0.85,
      title: 4.6,
      section: 3.5,
      sheet: 2.8,
      summary: 3.4,
      keywords: 4.5,
      synonyms: 3.2,
      fileName: 0.35,
      semantic: 1.05,
      proximity: 0.9,
      structural: 1.15,
      page: 1,
      parser: 1,
      recency: 1,
      coverage: 1.05,
      candidateRatio: 0.24
    }
  },
  {
    id: "synonym_expanded",
    label: "同义词扩展",
    description: "提高同义词和别名词权重，适合员工问法与资料原文不一致的场景。",
    weights: {
      content: 0.95,
      title: 3.6,
      section: 3,
      sheet: 2.4,
      summary: 2.5,
      keywords: 3.4,
      synonyms: 5,
      fileName: 0.28,
      semantic: 1.15,
      proximity: 1,
      structural: 1,
      page: 1,
      parser: 1,
      recency: 1,
      coverage: 1,
      candidateRatio: 0.23,
      termKinds: {
        alias: 1.7
      }
    }
  }
];

const defaultLocalRagStrategy = localRagStrategies[0];

export function normalizeLocalRagStrategyId(value: unknown): LocalRagStrategyId {
  return localRagStrategies.some((strategy) => strategy.id === value)
    ? value as LocalRagStrategyId
    : defaultLocalRagStrategy.id;
}

export function configuredLocalRagStrategyId() {
  return normalizeLocalRagStrategyId(env.ragRetrievalStrategy);
}

function getLocalRagStrategy(strategyId?: LocalRagStrategyId | string | null) {
  return localRagStrategies.find((strategy) => strategy.id === strategyId) ?? defaultLocalRagStrategy;
}

const aliasTerms: Record<string, string[]> = {
  劳保: ["劳保用品", "防护用品", "个人防护", "ppe"],
  劳保用品: ["劳保", "防护用品", "个人防护", "ppe"],
  安全: ["EHS", "安全生产", "安全培训"],
  质量: ["质检", "检验", "质量部"],
  检验: ["检查", "质检", "质量"],
  设备: ["点检", "设备点检", "保养"],
  报销: ["费用报销", "差旅", "付款"],
  请假: ["休假", "假期", "考勤"],
  入职: ["新员工", "试用期", "新人"],
  首件: ["首件确认", "首件检验", "首检"],
  异常: ["问题反馈", "质量异常", "设备异常", "不合格"],
  返工: ["返修", "不合格品", "纠正措施"],
  车间: ["生产现场", "现场", "工位"],
  考勤: ["打卡", "补卡", "请假", "出勤"],
  工单: ["人工协助", "转人工", "问题处理"],
  kass: ["开始云", "Kass", "KASS", "产品培训", "课程资料"],
  开始云: ["kass", "Kass", "KASS", "产品培训", "课程资料"],
  课件: ["课程", "培训资料", "讲解视频", "PPT"],
  课程: ["课件", "培训资料", "讲解视频", "PPT"],
  视频: ["讲解视频", "课件视频", "课程视频", "培训视频"]
};

export async function searchLocalTextRag(input: {
  question: string;
  knowledgeBases: KnowledgeBase[];
  limit?: number;
  allowedDocumentIds?: string[];
  strategyId?: LocalRagStrategyId;
}) {
  const knowledgeBaseIds = new Set(input.knowledgeBases.map((kb) => kb.id));
  const allowedDocumentIds = input.allowedDocumentIds ? new Set(input.allowedDocumentIds) : null;
  const profile = buildQueryProfile(input.question);
  const chunks = await listDocumentChunksByScope({
    knowledgeBaseIds: [...knowledgeBaseIds],
    documentIds: allowedDocumentIds ? [...allowedDocumentIds] : undefined
  });
  return searchLocalTextRagInChunks({
    question: input.question,
    chunks,
    limit: input.limit,
    strategyId: input.strategyId ?? configuredLocalRagStrategyId(),
    useOverview: true
  });
}

export function searchLocalTextRagInChunks(input: {
  question: string;
  chunks: DocumentChunk[];
  limit?: number;
  strategyId?: LocalRagStrategyId;
  useOverview?: boolean;
}) {
  const profile = buildQueryProfile(input.question);
  const limit = input.limit ?? 6;
  const strategy = getLocalRagStrategy(input.strategyId);
  const overviewHits = input.useOverview === false ? [] : selectDocumentOverviewHits({
    question: input.question,
    chunks: input.chunks,
    profile,
    limit
  });

  if (overviewHits.length > 0) {
    return overviewHits;
  }

  return rankLocalTextRagHits({
    chunks: input.chunks,
    profile,
    limit,
    strategy
  });
}

function rankLocalTextRagHits(input: {
  chunks: DocumentChunk[];
  profile: QueryProfile;
  limit: number;
  strategy: LocalRagStrategyDefinition;
}) {
  const scoredHits = input.chunks
    .map((chunk) => {
      const scored = scoreChunk(chunk, input.profile, input.strategy);
      return {
        chunk,
        quote: buildRelevantQuote(chunk.content, scored.matchedTerms),
        score: scored.score,
        matchedTerms: scored.matchedTerms,
        scoreReason: scored.scoreReason,
        matchSignals: scored.matchSignals,
        matchSignalTerms: scored.matchSignalTerms,
        dominantMatchSignal: scored.dominantMatchSignal
      };
    })
    .filter((hit) => hit.score > 0)
    .sort((a, b) => b.score - a.score || b.matchedTerms.length - a.matchedTerms.length);
  const maxScore = scoredHits[0]?.score ?? 0;
  const minScore = Math.max(2.5, maxScore * input.strategy.weights.candidateRatio);
  const candidates = scoredHits
    .filter((hit) => hit.score >= minScore)
    .slice(0, 24);
  const hits = selectDiverseHits(candidates, input.limit);

  return hits;
}

export function buildLocalRagPrompt(input: {
  question: string;
  hits: LocalRagHit[];
}) {
  const context = input.hits
    .map((hit, index) => {
      const source = hit.chunk.metadata.file_name ?? hit.chunk.metadata.title ?? hit.chunk.document_id;
      const meta = sourceMeta(hit.chunk.metadata);
      const relevance = `相关度 ${hit.score}${hit.matchedTerms.length > 0 ? `，命中：${hit.matchedTerms.slice(0, 6).join("、")}` : ""}`;
      return `[${index + 1}] ${source}${meta ? `（${meta}）` : ""}（${relevance}）\n${hit.chunk.content}`;
    })
    .join("\n\n");

  return `请只基于以下企业知识片段回答用户问题。如果片段中没有明确依据，请说明“未在知识库中找到明确依据”。回答末尾用“参考来源”列出用到的编号。\n\n企业知识片段：\n${context}\n\n用户问题：${input.question}`;
}

export function localRagCitations(hits: LocalRagHit[]): Citation[] {
  return hits.map((hit, index) => ({
    file_id: hit.chunk.document_id,
    file_name: hit.chunk.metadata.file_name ?? hit.chunk.metadata.title ?? "本地知识片段",
    chunk_id: hit.chunk.id,
    chunk_index: hit.chunk.chunk_index,
    quote: hit.quote,
    index: index + 1,
    page: hit.chunk.metadata.page,
    section: hit.chunk.metadata.section,
    sheet: hit.chunk.metadata.sheet,
    cell_range: hit.chunk.metadata.cell_range,
    score: hit.score,
    matched_terms: hit.matchedTerms,
    score_reason: hit.scoreReason,
    match_signals: hit.matchSignals,
    match_signal_terms: hit.matchSignalTerms,
    dominant_match_signal: hit.dominantMatchSignal
  }));
}

export function evaluateLocalRagHits(hits: LocalRagHit[]): LocalRagRetrievalDiagnostics {
  if (hits.length === 0) {
    return {
      hasEvidence: false,
      confidence: "none",
      reason: "没有召回知识片段",
      hitCount: 0,
      uniqueDocuments: 0,
      topScore: 0,
      averageTopScore: 0,
      matchedTerms: []
    };
  }

  const topHits = hits.slice(0, 3);
  const topScore = hits[0]?.score ?? 0;
  const averageTopScore = Math.round(
    (topHits.reduce((total, hit) => total + hit.score, 0) / Math.max(topHits.length, 1)) * 100
  ) / 100;
  const matchedTerms = uniquePreserveOrder(
    hits.flatMap((hit) => hit.matchedTerms)
      .map((term) => term.trim().toLowerCase())
      .filter((term) => term.length >= 2 && !stopWords.has(term))
  ).slice(0, 10);
  const strongTerms = matchedTerms.filter((term) => term.length >= 3 || /[a-z0-9]/i.test(term));
  const uniqueDocuments = new Set(hits.map((hit) => hit.chunk.document_id)).size;
  const hasStrongSingleHit = topScore >= 6.5;
  const hasMultiSignalHit = topScore >= 4.2 && (strongTerms.length >= 2 || averageTopScore >= 3.8 || uniqueDocuments >= 2);
  const hasModerateEvidence = topScore >= 3.2 && strongTerms.length >= 3 && hits.length >= 2;

  if (hasStrongSingleHit || hasMultiSignalHit) {
    return {
      hasEvidence: true,
      confidence: hasStrongSingleHit || topScore >= 7.5 ? "high" : "medium",
      reason: `召回可信：最高相关度 ${topScore}，命中 ${matchedTerms.slice(0, 5).join("、") || "结构信息"}`,
      hitCount: hits.length,
      uniqueDocuments,
      topScore,
      averageTopScore,
      matchedTerms
    };
  }

  if (hasModerateEvidence) {
    return {
      hasEvidence: true,
      confidence: "medium",
      reason: `多片段弱召回：最高相关度 ${topScore}，平均相关度 ${averageTopScore}`,
      hitCount: hits.length,
      uniqueDocuments,
      topScore,
      averageTopScore,
      matchedTerms
    };
  }

  return {
    hasEvidence: false,
    confidence: "low",
    reason: `召回置信度偏低：最高相关度 ${topScore}，命中 ${matchedTerms.slice(0, 5).join("、") || "较少"}`,
    hitCount: hits.length,
    uniqueDocuments,
    topScore,
    averageTopScore,
    matchedTerms
  };
}

export function localRagNoEvidenceAnswer(diagnostics: LocalRagRetrievalDiagnostics) {
  if (diagnostics.confidence === "none") {
    return "未在知识库中找到明确依据。请换一个资料范围或联系管理员补充资料。";
  }

  return "未在知识库中找到明确依据。系统只召回到弱相关片段，已避免基于不可靠资料生成正式回答。";
}

export function sourceMeta(metadata: DocumentChunk["metadata"]) {
  const parts: string[] = [];

  if (metadata.page) {
    parts.push(`第 ${metadata.page} 页`);
  }

  if (metadata.section && metadata.section !== metadata.title) {
    parts.push(metadata.section);
  }

  if (metadata.sheet) {
    parts.push(`工作表：${metadata.sheet}`);
  }

  if (metadata.cell_range) {
    parts.push(`范围：${metadata.cell_range}`);
  }

  return parts.join(" · ");
}

type QueryProfile = {
  normalizedQuestion: string;
  terms: WeightedTerm[];
  ngrams: Set<string>;
};

function buildQueryProfile(input: string): QueryProfile {
  const normalizedQuestion = normalizeSearchText(input);
  return {
    normalizedQuestion,
    terms: buildWeightedTerms(input),
    ngrams: buildNgrams(normalizedQuestion, 2)
  };
}

function buildWeightedTerms(input: string): WeightedTerm[] {
  const normalized = input.toLowerCase().replace(/[，。！？、；：,.!?;:]/g, " ");
  const phrases = normalized
    .split(/\s+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 3 && !stopWords.has(item))
    .map((value) => ({ value, weight: 3.5, kind: "phrase" as const }));
  const asciiTerms = input
    .toLowerCase()
    .match(/[a-z0-9\u4e00-\u9fa5]{2,}/g) ?? [];
  const chineseBigrams: string[] = [];
  const chineseText = input.match(/[\u4e00-\u9fa5]+/g)?.join("") ?? "";

  for (let index = 0; index < chineseText.length - 1; index += 1) {
    chineseBigrams.push(chineseText.slice(index, index + 2));
  }

  const baseTerms = [...new Set(asciiTerms.filter((term) => !stopWords.has(term)))]
    .map((value) => ({ value, weight: value.length >= 4 ? 2.2 : 1.8, kind: "term" as const }));
  const bigrams = [...new Set(chineseBigrams.filter((term) => !stopWords.has(term)))]
    .slice(0, 28)
    .map((value) => ({ value, weight: 1, kind: "bigram" as const }));
  const chineseTrigrams = buildChineseNgramTerms(chineseText, 3, 1.35, 24);
  const chineseQuadgrams = buildChineseNgramTerms(chineseText, 4, 1.75, 18);
  const aliases = expandAliases([...phrases, ...baseTerms, ...chineseQuadgrams, ...chineseTrigrams, ...bigrams].map((term) => term.value));

  return dedupeTerms([...phrases, ...baseTerms, ...chineseQuadgrams, ...chineseTrigrams, ...bigrams, ...aliases]).slice(0, 56);
}

function buildChineseNgramTerms(chineseText: string, size: number, weight: number, limit: number): WeightedTerm[] {
  const terms: string[] = [];

  for (let index = 0; index <= chineseText.length - size; index += 1) {
    const term = chineseText.slice(index, index + size);

    if (stopWords.has(term) || isLowSignalChineseTerm(term)) {
      continue;
    }

    terms.push(term);
  }

  return [...new Set(terms)]
    .slice(0, limit)
    .map((value) => ({ value, weight, kind: "term" as const }));
}

function isLowSignalChineseTerm(term: string) {
  return /^[的是了和在有可以需要应该如何怎么哪些什么是否]+$/.test(term);
}

function expandAliases(terms: string[]): WeightedTerm[] {
  const aliases: WeightedTerm[] = [];

  for (const term of terms) {
    for (const [key, values] of Object.entries(aliasTerms)) {
      if (!term.includes(key) && !key.includes(term)) {
        continue;
      }

      aliases.push(...values.map((value) => ({
        value: value.toLowerCase(),
        weight: 1.2,
        kind: "alias" as const
      })));
    }
  }

  return aliases;
}

function dedupeTerms(terms: WeightedTerm[]) {
  const byValue = new Map<string, WeightedTerm>();

  for (const term of terms) {
    const value = term.value.trim().toLowerCase();

    if (!value || stopWords.has(value)) {
      continue;
    }

    const previous = byValue.get(value);
    if (!previous || term.weight > previous.weight) {
      byValue.set(value, { ...term, value });
    }
  }

  return [...byValue.values()].sort((a, b) => b.weight - a.weight || b.value.length - a.value.length);
}

function uniquePreserveOrder(values: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    if (seen.has(value)) {
      continue;
    }

    seen.add(value);
    result.push(value);
  }

  return result;
}

function scoreChunk(chunk: DocumentChunk, profile: QueryProfile, strategy = defaultLocalRagStrategy) {
  if (profile.terms.length === 0 && profile.ngrams.size === 0) {
    return {
      score: 0,
      matchedTerms: [],
      scoreReason: "无有效检索词",
      matchSignals: {},
      matchSignalTerms: {},
      dominantMatchSignal: "mixed" as CitationDominantMatchSignal
    };
  }

  const content = stripChunkContextHeader(chunk.content).toLowerCase();
  const title = (chunk.metadata.title ?? "").toLowerCase();
  const fileName = (chunk.metadata.file_name ?? "").toLowerCase();
  const section = (chunk.metadata.section ?? "").toLowerCase();
  const sheet = (chunk.metadata.sheet ?? "").toLowerCase();
  const summary = (chunk.metadata.summary ?? "").toLowerCase();
  const keywords = (chunk.metadata.keywords ?? []).join(" ").toLowerCase();
  const synonyms = (chunk.metadata.synonyms ?? []).join(" ").toLowerCase();
  let lexicalScore = 0;
  const matchedTerms: string[] = [];
  const lexicalSignals: NonNullable<Citation["match_signals"]> = {};
  const matchSignalTerms: NonNullable<Citation["match_signal_terms"]> = {};

  for (const term of profile.terms) {
    const value = term.value.toLowerCase();
    const termWeight = term.weight * (strategy.weights.termKinds?.[term.kind] ?? 1);
    const contentOccurrences = occurrences(content, value);
    const titleOccurrences = occurrences(title, value);
    const sectionOccurrences = occurrences(section, value);
    const sheetOccurrences = occurrences(sheet, value);
    const fileOccurrences = occurrences(fileName, value);
    const summaryOccurrences = occurrences(summary, value);
    const keywordOccurrences = occurrences(keywords, value);
    const synonymOccurrences = occurrences(synonyms, value);
    const contentScore = Math.min(contentOccurrences, 8) * termWeight * strategy.weights.content;
    const titleScore = titleOccurrences * termWeight * strategy.weights.title;
    const sectionScore = sectionOccurrences * termWeight * strategy.weights.section;
    const sheetScore = sheetOccurrences * termWeight * strategy.weights.sheet;
    const summaryScore = summaryOccurrences * termWeight * strategy.weights.summary;
    const keywordScore = keywordOccurrences * termWeight * strategy.weights.keywords;
    const synonymScore = synonymOccurrences * termWeight * strategy.weights.synonyms;
    const contentFieldScore =
      contentScore +
      titleScore +
      sectionScore +
      sheetScore +
      summaryScore +
      keywordScore +
      synonymScore;
    const fileScore = Math.min(fileOccurrences, 2) * termWeight * strategy.weights.fileName;
    const fieldScore = contentFieldScore + fileScore;

    if (fieldScore > 0) {
      lexicalScore += fieldScore;
      addSignal(lexicalSignals, "content", contentScore);
      addSignal(lexicalSignals, "title", titleScore);
      addSignal(lexicalSignals, "section", sectionScore);
      addSignal(lexicalSignals, "sheet", sheetScore);
      addSignal(lexicalSignals, "file_name", fileScore);
      addSignal(lexicalSignals, "summary", summaryScore);
      addSignal(lexicalSignals, "keywords", keywordScore);
      addSignal(lexicalSignals, "synonyms", synonymScore);
      addMatchTerm(matchSignalTerms, "content", contentOccurrences, value);
      addMatchTerm(matchSignalTerms, "title", titleOccurrences, value);
      addMatchTerm(matchSignalTerms, "section", sectionOccurrences, value);
      addMatchTerm(matchSignalTerms, "sheet", sheetOccurrences, value);
      addMatchTerm(matchSignalTerms, "file_name", fileOccurrences, value);
      addMatchTerm(matchSignalTerms, "summary", summaryOccurrences, value);
      addMatchTerm(matchSignalTerms, "keywords", keywordOccurrences, value);
      addMatchTerm(matchSignalTerms, "synonyms", synonymOccurrences, value);
      if (contentFieldScore > 0 || (term.kind !== "bigram" && value.length >= 3)) {
        matchedTerms.push(value);
      }
    }
  }

  const coverage = matchedTerms.length / Math.max(profile.terms.filter((term) => term.kind !== "alias").length, 1);
  const titleMatched = matchedTerms.some((term) =>
    title.includes(term) ||
    section.includes(term) ||
    keywords.includes(term) ||
    synonyms.includes(term)
  );
  const semanticScore = scoreSemanticSimilarity(profile, chunk) * strategy.weights.semantic;
  const proximityBonus = scoreTermProximity(content, matchedTerms) * strategy.weights.proximity;
  const pageBonus = chunk.metadata.page ? 0.3 * strategy.weights.page : 0;
  const parserBonus = chunk.metadata.parser === "excel" || chunk.metadata.parser === "pdf_text" ? 0.2 * strategy.weights.parser : 0;
  const structuralBonus = (titleMatched ? 2 * strategy.weights.structural : 0) + pageBonus + parserBonus;
  const recencyBonus = scoreRecency(chunk.created_at) * strategy.weights.recency;
  const metadataBonus = structuralBonus + recencyBonus;
  const coverageMultiplier = 1 + Math.min(coverage, 0.8) * strategy.weights.coverage;
  const matchSignals = buildFinalMatchSignals(lexicalSignals, coverageMultiplier, {
    semantic: semanticScore,
    proximity: proximityBonus,
    structural: structuralBonus,
    recency: recencyBonus
  });
  const score = lexicalScore * coverageMultiplier + semanticScore + proximityBonus + metadataBonus;

  return {
    score: Math.round(score * 100) / 100,
    matchedTerms: [...new Set(matchedTerms)].slice(0, 12),
    scoreReason: buildScoreReason({
      lexicalScore,
      semanticScore,
      proximityBonus,
      structuralBonus,
      recencyBonus,
      matchedTerms
    }),
    matchSignals,
    matchSignalTerms: compactMatchSignalTerms(matchSignalTerms),
    dominantMatchSignal: getDominantMatchSignal(matchSignals)
  };
}

function addSignal(
  signals: NonNullable<Citation["match_signals"]>,
  key: CitationMatchSignalKey,
  value: number
) {
  if (!Number.isFinite(value) || value <= 0) {
    return;
  }

  signals[key] = (signals[key] ?? 0) + value;
}

function addMatchTerm(
  terms: NonNullable<Citation["match_signal_terms"]>,
  key: keyof NonNullable<Citation["match_signal_terms"]>,
  occurrencesCount: number,
  value: string
) {
  if (occurrencesCount <= 0 || !value) {
    return;
  }

  const current = terms[key] ?? [];
  if (current.includes(value)) {
    return;
  }

  terms[key] = [...current, value].slice(0, 8);
}

function buildFinalMatchSignals(
  lexicalSignals: NonNullable<Citation["match_signals"]>,
  lexicalMultiplier: number,
  bonuses: Pick<NonNullable<Citation["match_signals"]>, "semantic" | "proximity" | "structural" | "recency">
) {
  const result: NonNullable<Citation["match_signals"]> = {};

  for (const key of Object.keys(lexicalSignals) as CitationMatchSignalKey[]) {
    const value = lexicalSignals[key];
    if (typeof value === "number") {
      setRoundedSignal(result, key, value * lexicalMultiplier);
    }
  }

  setRoundedSignal(result, "semantic", bonuses.semantic);
  setRoundedSignal(result, "proximity", bonuses.proximity);
  setRoundedSignal(result, "structural", bonuses.structural);
  setRoundedSignal(result, "recency", bonuses.recency);

  return result;
}

function setRoundedSignal(
  signals: NonNullable<Citation["match_signals"]>,
  key: CitationMatchSignalKey,
  value: number | undefined
) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return;
  }

  signals[key] = Math.round(value * 100) / 100;
}

function compactMatchSignalTerms(terms: NonNullable<Citation["match_signal_terms"]>) {
  return Object.fromEntries(
    Object.entries(terms)
      .map(([key, values]) => [key, [...new Set(values)].slice(0, 8)])
      .filter(([, values]) => Array.isArray(values) && values.length > 0)
  ) as Citation["match_signal_terms"];
}

function getDominantMatchSignal(signals: NonNullable<Citation["match_signals"]>): CitationDominantMatchSignal {
  const groups: Array<{ signal: CitationDominantMatchSignal; score: number }> = [
    { signal: "content" as const, score: signalTotal(signals, ["content"]) },
    { signal: "summary" as const, score: signalTotal(signals, ["summary"]) },
    { signal: "keywords" as const, score: signalTotal(signals, ["keywords"]) },
    { signal: "synonyms" as const, score: signalTotal(signals, ["synonyms"]) },
    { signal: "metadata" as const, score: signalTotal(signals, ["title", "file_name", "section", "sheet", "structural", "recency"]) },
    { signal: "semantic" as const, score: signalTotal(signals, ["semantic", "proximity"]) }
  ].filter((group) => group.score > 0);

  if (groups.length === 0) {
    return "mixed";
  }

  const ranked = groups.sort((a, b) => b.score - a.score);
  const total = ranked.reduce((sum, group) => sum + group.score, 0);
  const top = ranked[0];

  if (ranked.length > 1 && top.score < total * 0.42) {
    return "mixed";
  }

  return top.signal;
}

function signalTotal(signals: NonNullable<Citation["match_signals"]>, keys: CitationMatchSignalKey[]) {
  return keys.reduce((total, key) => total + (signals[key] ?? 0), 0);
}

function occurrences(content: string, term: string) {
  if (!content || !term) {
    return 0;
  }

  return content.split(term).length - 1;
}

function normalizeSearchText(input: string) {
  return input
    .toLowerCase()
    .replace(/[^\da-z\u4e00-\u9fa5]+/g, "")
    .trim();
}

function buildNgrams(input: string, size: number) {
  const grams = new Set<string>();
  if (input.length < size) {
    if (input) {
      grams.add(input);
    }
    return grams;
  }

  for (let index = 0; index <= input.length - size; index += 1) {
    grams.add(input.slice(index, index + size));
  }

  return grams;
}

function scoreSemanticSimilarity(profile: QueryProfile, chunk: DocumentChunk) {
  if (profile.ngrams.size === 0) {
    return 0;
  }

  const metadataText = [
    chunk.metadata.title,
    chunk.metadata.file_name,
    chunk.metadata.section,
    chunk.metadata.sheet,
    chunk.metadata.summary,
    ...(chunk.metadata.keywords ?? []),
    ...(chunk.metadata.synonyms ?? [])
  ].filter(Boolean).join("");
  const chunkText = normalizeSearchText(`${metadataText}${stripChunkContextHeader(chunk.content).slice(0, 3200)}`);
  const chunkNgrams = buildNgrams(chunkText, 2);

  if (chunkNgrams.size === 0) {
    return 0;
  }

  let overlap = 0;
  for (const gram of profile.ngrams) {
    if (chunkNgrams.has(gram)) {
      overlap += 1;
    }
  }

  const queryCoverage = overlap / profile.ngrams.size;
  const dice = (2 * overlap) / (profile.ngrams.size + chunkNgrams.size);
  const metadataCoverage = scoreMetadataCoverage(profile.ngrams, normalizeSearchText(metadataText));

  if (queryCoverage < 0.18 && metadataCoverage < 0.25) {
    return 0;
  }

  return Math.round((queryCoverage * 7 + dice * 10 + metadataCoverage * 3) * 100) / 100;
}

function scoreMetadataCoverage(queryNgrams: Set<string>, metadataText: string) {
  if (!metadataText || queryNgrams.size === 0) {
    return 0;
  }

  const metadataNgrams = buildNgrams(metadataText, 2);
  let overlap = 0;
  for (const gram of queryNgrams) {
    if (metadataNgrams.has(gram)) {
      overlap += 1;
    }
  }

  return overlap / queryNgrams.size;
}

function scoreTermProximity(content: string, matchedTerms: string[]) {
  const terms = [...new Set(matchedTerms)].filter((term) => term.length >= 2).slice(0, 8);
  if (terms.length < 2) {
    return 0;
  }

  const positions = terms
    .map((term) => content.indexOf(term))
    .filter((position) => position >= 0)
    .sort((a, b) => a - b);

  if (positions.length < 2) {
    return 0;
  }

  let bestSpan = Number.POSITIVE_INFINITY;
  for (let start = 0; start < positions.length; start += 1) {
    for (let end = start + 1; end < positions.length; end += 1) {
      bestSpan = Math.min(bestSpan, positions[end] - positions[start]);
    }
  }

  if (bestSpan <= 80) {
    return 2.5;
  }

  if (bestSpan <= 180) {
    return 1.4;
  }

  return 0.5;
}

function buildScoreReason(input: {
  lexicalScore: number;
  semanticScore: number;
  proximityBonus: number;
  structuralBonus: number;
  recencyBonus: number;
  matchedTerms: string[];
}) {
  const parts: string[] = [];

  if (input.matchedTerms.length > 0) {
    parts.push(`关键词命中 ${[...new Set(input.matchedTerms)].slice(0, 5).join("、")}`);
  }

  if (input.semanticScore >= 2) {
    parts.push("语义相似度较高");
  }

  if (input.proximityBonus > 0) {
    parts.push("命中词位置接近");
  }

  if (input.structuralBonus > 0) {
    parts.push("标题/页码/结构加权");
  }

  if (input.recencyBonus > 0) {
    parts.push("资料较新");
  }

  if (parts.length === 0 && input.lexicalScore > 0) {
    parts.push("文本匹配");
  }

  return parts.join("；") || "低置信召回";
}

function scoreRecency(createdAt: string) {
  const createdTime = new Date(createdAt).getTime();
  if (!Number.isFinite(createdTime)) {
    return 0;
  }

  const ageDays = (Date.now() - createdTime) / (1000 * 60 * 60 * 24);
  if (ageDays <= 30) {
    return 0.5;
  }

  if (ageDays <= 120) {
    return 0.25;
  }

  return 0;
}

function selectDocumentOverviewHits(input: {
  question: string;
  chunks: DocumentChunk[];
  profile: QueryProfile;
  limit: number;
}): LocalRagHit[] {
  if (!isDocumentOverviewQuestion(input.question)) {
    return [];
  }

  const documentScores = new Map<string, { score: number; terms: string[]; chunks: DocumentChunk[] }>();

  for (const chunk of input.chunks) {
    const metadataText = normalizeSearchText([
      chunk.metadata.file_name,
      chunk.metadata.title
    ].filter(Boolean).join(""));
    let score = 0;
    const terms: string[] = [];

    for (const term of input.profile.terms) {
      const value = normalizeSearchText(term.value);
      if (!value || value.length < 3 || stopWords.has(value)) {
        continue;
      }

      if (metadataText.includes(value)) {
        score += term.weight;
        terms.push(term.value);
      }
    }

    const current = documentScores.get(chunk.document_id) ?? { score: 0, terms: [], chunks: [] };
    current.score = Math.max(current.score, score);
    current.terms.push(...terms);
    current.chunks.push(chunk);
    documentScores.set(chunk.document_id, current);
  }

  const best = [...documentScores.entries()]
    .map(([documentId, value]) => ({
      documentId,
      score: value.score,
      terms: uniquePreserveOrder(value.terms),
      chunks: value.chunks
    }))
    .filter((item) => item.score >= 2.5 && item.terms.length > 0)
    .sort((a, b) => b.score - a.score || b.chunks.length - a.chunks.length)[0];

  if (!best) {
    return [];
  }

  return sampleOverviewChunks(best.chunks, input.limit).map((chunk, index) => {
    const structuralScore = Math.max(0, 3 - index * 0.25);
    const score = Math.round((best.score + structuralScore) * 100) / 100;
    return {
      chunk,
      quote: buildRelevantQuote(chunk.content, best.terms),
      score,
      matchedTerms: best.terms.slice(0, 8),
      scoreReason: "文档名称匹配；概览问题按页抽样",
      matchSignals: {
        file_name: Math.round(best.score * 100) / 100,
        structural: Math.round(structuralScore * 100) / 100
      },
      matchSignalTerms: {
        file_name: best.terms.slice(0, 8)
      },
      dominantMatchSignal: "metadata" as const
    };
  });
}

function isDocumentOverviewQuestion(question: string) {
  return /(主要|大概|概括|总结|介绍|内容|目录|包括|包含|讲了|讲的|有哪些|是什么)/.test(question) &&
    /(资料|文档|ppt|课件|课程|培训|手册|文件|kass|开始云)/i.test(question);
}

function sampleOverviewChunks(chunks: DocumentChunk[], limit: number) {
  const sorted = [...chunks]
    .filter((chunk) => stripChunkContextHeader(chunk.content).replace(/\s/g, "").length >= 12)
    .sort((a, b) => {
      const pageA = Number(a.metadata.page);
      const pageB = Number(b.metadata.page);

      if (Number.isFinite(pageA) && Number.isFinite(pageB) && pageA !== pageB) {
        return pageA - pageB;
      }

      return a.chunk_index - b.chunk_index;
    });

  if (sorted.length <= limit) {
    return sorted;
  }

  const candidateIndexes = [
    0,
    1,
    2,
    Math.floor(sorted.length * 0.25),
    Math.floor(sorted.length * 0.5),
    Math.floor(sorted.length * 0.75),
    sorted.length - 1
  ];
  const selected: DocumentChunk[] = [];
  const seenPages = new Set<number | string>();

  for (const index of candidateIndexes) {
    const chunk = sorted[Math.max(0, Math.min(sorted.length - 1, index))];
    if (!chunk) {
      continue;
    }

    const pageKey = Number.isFinite(Number(chunk.metadata.page)) ? Number(chunk.metadata.page) : chunk.id;
    if (seenPages.has(pageKey)) {
      continue;
    }

    selected.push(chunk);
    seenPages.add(pageKey);

    if (selected.length >= limit) {
      break;
    }
  }

  for (const chunk of sorted) {
    if (selected.length >= limit) {
      break;
    }

    if (selected.includes(chunk)) {
      continue;
    }

    selected.push(chunk);
  }

  return selected;
}

function selectDiverseHits(hits: LocalRagHit[], limit: number) {
  const selected: LocalRagHit[] = [];
  const seenContent = new Set<string>();
  const documentCounts = new Map<string, number>();

  for (const hit of hits) {
    const fingerprint = hit.chunk.content.replace(/\s+/g, "").slice(0, 220);
    const documentCount = documentCounts.get(hit.chunk.document_id) ?? 0;

    if (seenContent.has(fingerprint)) {
      continue;
    }

    if (documentCount >= 3 && selected.length >= Math.ceil(limit / 2)) {
      continue;
    }

    selected.push(hit);
    seenContent.add(fingerprint);
    documentCounts.set(hit.chunk.document_id, documentCount + 1);

    if (selected.length >= limit) {
      break;
    }
  }

  if (selected.length < limit) {
    for (const hit of hits) {
      if (selected.includes(hit)) {
        continue;
      }

      selected.push(hit);

      if (selected.length >= limit) {
        break;
      }
    }
  }

  return selected;
}

function buildRelevantQuote(content: string, terms: string[]) {
  const normalized = stripChunkContextHeader(content).replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "";
  }

  const lower = normalized.toLowerCase();
  const matched = terms
    .map((term) => {
      const normalizedTerm = term.toLowerCase();
      const index = lower.indexOf(normalizedTerm);
      const occurrences = index >= 0 ? lower.split(normalizedTerm).length - 1 : 0;
      return {
        index,
        occurrences,
        length: normalizedTerm.length
      };
    })
    .filter((item) => item.index >= 0)
    .sort((a, b) => a.occurrences - b.occurrences || b.length - a.length || a.index - b.index)[0];
  const matchedIndex = matched?.index;

  if (matchedIndex === undefined) {
    return normalized.slice(0, 180);
  }

  const start = Math.max(0, matchedIndex - 70);
  const end = Math.min(normalized.length, matchedIndex + 140);
  const prefix = start > 0 ? "..." : "";
  const suffix = end < normalized.length ? "..." : "";

  return `${prefix}${normalized.slice(start, end)}${suffix}`;
}

function stripChunkContextHeader(content: string) {
  const lines = content.split(/\r?\n/);
  let index = 0;

  while (index < lines.length) {
    const line = lines[index]?.trim() ?? "";

    if (!line || /^资料[:：]/.test(line) || /^标题[:：]/.test(line) || /^位置[:：]/.test(line)) {
      index += 1;
      continue;
    }

    break;
  }

  return lines.slice(index).join("\n").trim() || content;
}
