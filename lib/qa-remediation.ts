import { createKnowledgeTask, getQaTestCase, listKnowledgeTasks, listQaTestCases } from "@/lib/db";
import { expectedCoverage } from "@/lib/qa-quality";
import type { QaTestCase } from "@/lib/types";

export type QaRemediationCandidate = {
  test: QaTestCase;
  reasons: string[];
  coverage: {
    coverage: number;
    missing: string[];
  };
  action: string;
};

export async function generateQaRemediationTasks(input: {
  createdBy: string;
  limit?: number;
  testIds?: string[];
}) {
  const uniqueTestIds = input.testIds?.length ? [...new Set(input.testIds)] : [];
  const [tests, existingTasks] = await Promise.all([
    uniqueTestIds.length > 0
      ? Promise.all(uniqueTestIds.map((id) => getQaTestCase(id))).then((items) =>
        items.filter((item): item is QaTestCase => Boolean(item))
      )
      : listQaTestCases({ compactCitations: true }),
    listKnowledgeTasks()
  ]);
  const existingQaTaskIds = new Set(
    existingTasks
      .filter((task) => task.source === "manual" && task.source_id?.startsWith("qa:"))
      .map((task) => task.source_id)
  );
  const candidates = tests
    .map(toRemediationCandidate)
    .filter((item): item is QaRemediationCandidate => Boolean(item))
    .slice(0, input.limit ?? 50);
  const created = [];
  const skipped = [];

  for (const candidate of candidates) {
    const sourceId = `qa:${candidate.test.id}`;

    if (existingQaTaskIds.has(sourceId)) {
      skipped.push({
        test_id: candidate.test.id,
        question: candidate.test.question,
        reason: "已存在整改任务"
      });
      continue;
    }

    const task = await createKnowledgeTask({
      source: "manual",
      source_id: sourceId,
      conversation_id: candidate.test.id,
      question: candidate.test.question,
      answer: candidate.test.answer ?? "未生成回答",
      status: "pending",
      note: buildTaskNote(candidate),
      created_by: input.createdBy
    });
    created.push(task);
    existingQaTaskIds.add(sourceId);
  }

  return {
    candidates,
    created,
    skipped,
    totalCandidates: candidates.length
  };
}

export async function generateQaRemediationTaskForTest(input: {
  testId: string;
  createdBy: string;
}) {
  const [test, existingTasks] = await Promise.all([
    getQaTestCase(input.testId),
    listKnowledgeTasks()
  ]);

  if (!test) {
    throw new Error("测试用例不存在");
  }

  const candidate = toRemediationCandidate(test);

  if (!candidate) {
    return {
      candidate: null,
      task: null,
      skipped: {
        test_id: test.id,
        question: test.question,
        reason: "当前测试暂无明显整改原因"
      }
    };
  }

  const sourceId = `qa:${test.id}`;
  const existingTask = existingTasks.find((task) => task.source === "manual" && task.source_id === sourceId);

  if (existingTask) {
    return {
      candidate,
      task: existingTask,
      skipped: {
        test_id: test.id,
        question: test.question,
        reason: "已存在整改任务"
      }
    };
  }

  const task = await createKnowledgeTask({
    source: "manual",
    source_id: sourceId,
    conversation_id: test.id,
    question: test.question,
    answer: test.answer ?? "未生成回答",
    status: "pending",
    note: buildTaskNote(candidate),
    created_by: input.createdBy
  });

  return {
    candidate,
    task,
    skipped: null
  };
}

export function toRemediationCandidate(test: QaTestCase): QaRemediationCandidate | null {
  const reasons: string[] = [];
  const coverage = expectedCoverage(test.answer ?? "", test.expected_answer ?? "");

  if (!test.answer) {
    reasons.push("尚未运行测试");
  }

  if (test.answer && test.citations.length === 0) {
    reasons.push("回答没有引用来源");
  }

  if (test.answer?.includes("未在知识库中找到明确依据")) {
    reasons.push("知识库未命中明确依据");
  }

  if (test.expected_answer && test.answer && coverage.coverage < 60) {
    reasons.push(`期望答案关键词覆盖偏低：${coverage.coverage}%`);
  }

  if (test.status === "failed") {
    reasons.push("人工评审不通过");
  }

  if (reasons.length === 0) {
    return null;
  }

  return {
    test,
    reasons,
    coverage,
    action: suggestedAction(test, reasons, coverage.missing)
  };
}

function buildTaskNote(candidate: QaRemediationCandidate) {
  const parts = [
    `来源：QA 测试 ${candidate.test.id}`,
    `问题：${candidate.test.question}`,
    `原因：${candidate.reasons.join("；")}`,
    candidate.coverage.missing.length > 0 ? `缺失关键词：${candidate.coverage.missing.join("、")}` : "",
    `建议：${candidate.action}`,
    candidate.test.expected_answer ? `期望答案：${candidate.test.expected_answer}` : ""
  ].filter(Boolean);

  return parts.join("\n");
}

function suggestedAction(test: QaTestCase, reasons: string[], missing: string[]) {
  if (reasons.some((reason) => reason.includes("未运行"))) {
    return "先运行该测试问题，再根据回答和引用判断是否需要补充资料。";
  }

  if (reasons.some((reason) => reason.includes("没有引用") || reason.includes("未命中"))) {
    return "检查对应知识库是否已有明确资料；如资料缺失，补充 FAQ 或制度片段；如资料已存在，调整标题、章节或关键词。";
  }

  if (missing.length > 0) {
    return `核对资料中是否包含 ${missing.slice(0, 6).join("、")} 等要点，必要时补充标准问答或优化文档表述。`;
  }

  if (test.status === "failed") {
    return "查看人工评审备注，补充标准答案依据，重新运行测试并复核。";
  }

  return "复核知识库资料和期望答案，补充缺失依据后重新运行测试。";
}
