import type { KnowledgeTask } from "@/lib/types";

export type KnowledgeTaskRetestSummary = {
  time: string;
  conclusion: string;
  citationCount: string | null;
  coverage: string | null;
  missingKeywords: string;
};

export type KnowledgeTaskRetestOutcome = "resolved" | "processing" | "ignored" | "failed";

export type QaRemediationTaskSummary = {
  id: string;
  qa_test_id: string;
  question: string;
  status: KnowledgeTask["status"];
  reason: string;
  suggestion: string;
  missing_keywords: string[];
  expected_answer: string | null;
  updated_at: string;
  latest_retest: KnowledgeTaskRetestSummary | null;
};

export type QaRemediationRetestTrend = {
  task_count: number;
  retested_task_count: number;
  total_retests: number;
  resolved: number;
  processing: number;
  ignored: number;
  failed: number;
  latest: Array<KnowledgeTaskRetestSummary & {
    id: string;
    qa_test_id: string;
    question: string;
    outcome: KnowledgeTaskRetestOutcome;
  }>;
  daily: Array<{
    date: string;
    total: number;
    resolved: number;
    processing: number;
    ignored: number;
    failed: number;
  }>;
};

export function buildQaRemediationTaskSummary(task: KnowledgeTask): QaRemediationTaskSummary {
  const parsed = parseTaskNote(task.note);

  return {
    id: task.id,
    qa_test_id: task.source_id?.replace(/^qa:/, "") ?? task.conversation_id,
    question: task.question,
    status: task.status,
    reason: parsed["原因"] ?? "未记录原因",
    suggestion: parsed["建议"] ?? "复核知识库资料和期望答案，补充缺失依据后重新运行测试。",
    missing_keywords: splitKeywords(parsed["缺失关键词"] ?? ""),
    expected_answer: parsed["期望答案"] ?? null,
    updated_at: task.updated_at,
    latest_retest: parseLatestRetestSummary(task.note)
  };
}

export function parseLatestRetestSummary(note: string | null): KnowledgeTaskRetestSummary | null {
  return parseRetestSummaries(note).at(-1) ?? null;
}

export function parseRetestSummaries(note: string | null): KnowledgeTaskRetestSummary[] {
  if (!note) {
    return [];
  }

  return note
    .split(/(?=复测时间：)/)
    .filter((block) => block.trim().startsWith("复测时间："))
    .map(parseRetestSummaryBlock)
    .filter((summary): summary is KnowledgeTaskRetestSummary => Boolean(summary));
}

export function buildQaRemediationRetestTrend(tasks: KnowledgeTask[]): QaRemediationRetestTrend {
  const qaTasks = tasks.filter((task) => task.source === "manual" && task.source_id?.startsWith("qa:"));
  const records = qaTasks.flatMap((task) => {
    const qaTestId = task.source_id?.replace(/^qa:/, "") ?? task.conversation_id;

    return parseRetestSummaries(task.note).map((summary) => ({
      ...summary,
      id: task.id,
      qa_test_id: qaTestId,
      question: task.question,
      outcome: inferRetestOutcome(summary.conclusion),
      sort_time: parseRetestTime(summary.time)
    }));
  });
  const daily = new Map<string, QaRemediationRetestTrend["daily"][number]>();

  for (const record of records) {
    const date = retestDateKey(record.time);
    const bucket = daily.get(date) ?? {
      date,
      total: 0,
      resolved: 0,
      processing: 0,
      ignored: 0,
      failed: 0
    };
    bucket.total += 1;
    bucket[record.outcome] += 1;
    daily.set(date, bucket);
  }

  const sortedRecords = [...records].sort((a, b) => b.sort_time - a.sort_time);
  const sortedDaily = [...daily.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-7);

  return {
    task_count: qaTasks.length,
    retested_task_count: qaTasks.filter((task) => parseRetestSummaries(task.note).length > 0).length,
    total_retests: records.length,
    resolved: records.filter((record) => record.outcome === "resolved").length,
    processing: records.filter((record) => record.outcome === "processing").length,
    ignored: records.filter((record) => record.outcome === "ignored").length,
    failed: records.filter((record) => record.outcome === "failed").length,
    latest: sortedRecords.slice(0, 5).map(({ sort_time: _sortTime, ...record }) => record),
    daily: sortedDaily
  };
}

function parseRetestSummaryBlock(block: string): KnowledgeTaskRetestSummary | null {
  const lines = block
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const fields = new Map<string, string>();

  for (const line of lines) {
    const separatorIndex = line.indexOf("：");

    if (separatorIndex === -1) {
      continue;
    }

    fields.set(line.slice(0, separatorIndex), line.slice(separatorIndex + 1));
  }

  const conclusion = fields.get("复测结论");
  if (!conclusion) {
    return null;
  }

  return {
    time: fields.get("复测时间") ?? "未知时间",
    conclusion,
    citationCount: fields.get("引用数量") ?? null,
    coverage: fields.get("期望覆盖") ?? null,
    missingKeywords: normalizeMissingKeywords(fields.get("仍缺关键词") ?? fields.get("缺失关键词") ?? "")
  };
}

function inferRetestOutcome(conclusion: string): KnowledgeTaskRetestOutcome {
  if (conclusion.includes("通过") && !conclusion.includes("未通过")) {
    return "resolved";
  }

  if (conclusion.includes("忽略")) {
    return "ignored";
  }

  if (conclusion.includes("失败") || conclusion.includes("异常")) {
    return "failed";
  }

  return "processing";
}

function parseRetestTime(value: string) {
  const parsed = new Date(value).getTime();

  return Number.isFinite(parsed) ? parsed : 0;
}

function retestDateKey(value: string) {
  const matched = value.match(/(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);

  if (matched) {
    return [
      matched[1],
      matched[2].padStart(2, "0"),
      matched[3].padStart(2, "0")
    ].join("-");
  }

  const parsed = new Date(value);

  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }

  return "未知日期";
}

function parseTaskNote(note: string | null) {
  const fields: Record<string, string> = {};

  for (const line of note?.split(/\r?\n/) ?? []) {
    const index = line.indexOf("：");

    if (index === -1) {
      continue;
    }

    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim();

    if (key && value) {
      fields[key] = value;
    }
  }

  return fields;
}

function splitKeywords(value: string) {
  return value
    .split(/[、,，]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeMissingKeywords(value: string) {
  if (!value || value === "无") {
    return "";
  }

  return value;
}
