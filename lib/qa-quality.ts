import type { Citation, QaTestStatus } from "@/lib/types";

export type QaQualityEvaluation = {
  status: QaTestStatus;
  reviewer_note: string | null;
  quality_score: number;
  reasons: string[];
  coverage: {
    coverage: number;
    missing: string[];
  };
};

export function evaluateQaAnswer(input: {
  answer: string | null;
  expected_answer: string | null;
  citations: Citation[];
  latency_ms?: number | null;
}): QaQualityEvaluation {
  const answer = input.answer?.trim() ?? "";
  const coverage = expectedCoverage(answer, input.expected_answer ?? "");
  const reasons: string[] = [];
  let qualityScore = answer ? 100 : 0;

  if (!answer) {
    reasons.push("模型未返回有效回答");
    qualityScore = 0;
  }

  if (answer && input.citations.length === 0) {
    reasons.push("回答没有引用来源");
    qualityScore -= 30;
  }

  if (answer.includes("未在知识库中找到明确依据")) {
    reasons.push("知识库未命中明确依据");
    qualityScore -= 30;
  }

  if (answer.includes("对话模型未返回有效回答") || answer.includes("当前问答测试第一版支持 local_text RAG")) {
    reasons.push("测试运行未得到可评审回答");
    qualityScore -= 30;
  }

  if (input.expected_answer && answer && coverage.coverage < 60) {
    reasons.push(`期望答案关键词覆盖偏低：${coverage.coverage}%`);
    qualityScore -= coverage.coverage < 40 ? 28 : 18;
  } else if (input.expected_answer && answer && coverage.coverage < 80) {
    qualityScore -= 8;
  }

  if ((input.latency_ms ?? 0) > 15000) {
    qualityScore -= 8;
  } else if ((input.latency_ms ?? 0) > 8000) {
    qualityScore -= 4;
  }

  qualityScore = Math.max(0, Math.min(100, Math.round(qualityScore)));

  return {
    status: reasons.length > 0 ? "failed" : "untested",
    reviewer_note: reasons.length > 0 ? `自动标记不通过：${reasons.join("；")}` : null,
    quality_score: qualityScore,
    reasons,
    coverage
  };
}

export function shouldRunQaCaseForMode(input: {
  mode: string;
  answer: string | null;
  expected_answer: string | null;
  citations: Citation[];
  status: QaTestStatus;
  latency_ms?: number | null;
}) {
  const mode = normalizeBatchRunMode(input.mode);
  const evaluation = evaluateQaAnswer({
    answer: input.answer,
    expected_answer: input.expected_answer,
    citations: input.citations,
    latency_ms: input.latency_ms
  });

  if (mode === "failed") {
    return input.status === "failed";
  }

  if (mode === "untested") {
    return input.status === "untested";
  }

  if (mode === "no_citation") {
    return Boolean(input.answer && input.citations.length === 0);
  }

  if (mode === "low_coverage") {
    return Boolean(input.answer && input.expected_answer && evaluation.coverage.coverage < 60);
  }

  if (mode === "knowledge_miss") {
    return Boolean(input.answer?.includes("未在知识库中找到明确依据"));
  }

  if (mode === "risky") {
    return evaluation.reasons.length > 0 || input.status === "failed";
  }

  return !input.answer;
}

export function normalizeBatchRunMode(mode: string) {
  if (
    mode === "failed" ||
    mode === "untested" ||
    mode === "no_citation" ||
    mode === "low_coverage" ||
    mode === "knowledge_miss" ||
    mode === "risky"
  ) {
    return mode;
  }

  return "unanswered";
}

export function expectedCoverage(answer: string, expected: string) {
  const terms = extractExpectedTerms(expected);

  if (terms.length === 0) {
    return {
      coverage: expected ? 0 : 100,
      missing: [] as string[]
    };
  }

  const normalizedAnswer = normalizeCoverageText(answer);
  const missing = terms.filter((term) => !normalizedAnswer.includes(normalizeCoverageText(term)));

  return {
    coverage: Math.round(((terms.length - missing.length) / terms.length) * 100),
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
