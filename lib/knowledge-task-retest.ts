import {
  getQaTestCase,
  listKnowledgeBases,
  listKnowledgeTasks,
  updateKnowledgeTask,
  updateQaTestCase
} from "@/lib/db";
import { expectedCoverage } from "@/lib/qa-quality";
import { runQaQuestion } from "@/lib/qa-runner";
import type { Citation, KnowledgeTask, WorkStatus } from "@/lib/types";

export type KnowledgeTaskRetestResult = {
  task: KnowledgeTask;
  status: WorkStatus;
  answer: string;
  citations: Citation[];
  latency_ms: number | null;
  summary: string;
};

export async function retestKnowledgeTask(taskId: string): Promise<KnowledgeTaskRetestResult> {
  const task = (await listKnowledgeTasks()).find((item) => item.id === taskId);

  if (!task) {
    throw new Error("整改任务不存在");
  }

  if (task.source === "manual" && task.source_id?.startsWith("qa:")) {
    return retestQaTask(task);
  }

  return retestGeneralTask(task);
}

async function retestQaTask(task: KnowledgeTask): Promise<KnowledgeTaskRetestResult> {
  const qaTestId = task.source_id?.replace(/^qa:/, "") ?? task.conversation_id;
  const test = await getQaTestCase(qaTestId);

  if (!test) {
    throw new Error("关联 QA 测试不存在");
  }

  const knowledgeBases = (await listKnowledgeBases()).filter((kb) => test.knowledge_base_ids.includes(kb.id));

  if (knowledgeBases.length === 0) {
    throw new Error("关联 QA 测试未绑定可用知识库");
  }

  const result = await runQaQuestion({
    question: test.question,
    knowledgeBases
  });
  const coverage = expectedCoverage(result.answer, test.expected_answer ?? "");
  const nextStatus = qaRetestStatus({
    answer: result.answer,
    citationCount: result.citations.length,
    coverage
  });
  const updatedTest = await updateQaTestCase(test.id, {
    answer: result.answer,
    citations: result.citations,
    model: result.model,
    latency_ms: result.latency_ms,
    status: nextStatus === "resolved" ? "passed" : "failed",
    reviewer_note: `整改复测：${statusText(nextStatus)}，引用 ${result.citations.length} 个，期望覆盖 ${coverage.coverage}%。`
  });
  const summary = [
    `复测对象：QA ${updatedTest.id}`,
    `复测结论：${statusText(nextStatus)}`,
    `引用数量：${result.citations.length}`,
    `期望覆盖：${coverage.coverage}%`,
    coverage.missing.length > 0 ? `仍缺关键词：${coverage.missing.join("、")}` : "缺失关键词：无",
    `耗时：${result.latency_ms}ms`
  ].join("\n");
  const updatedTask = await updateKnowledgeTask(task.id, {
    status: nextStatus,
    note: appendRetestNote(task.note, summary)
  });

  return {
    task: updatedTask,
    status: nextStatus,
    answer: result.answer,
    citations: result.citations,
    latency_ms: result.latency_ms,
    summary
  };
}

async function retestGeneralTask(task: KnowledgeTask): Promise<KnowledgeTaskRetestResult> {
  const knowledgeBases = await listKnowledgeBases();

  if (knowledgeBases.length === 0) {
    throw new Error("暂无可用知识库，无法复测");
  }

  const result = await runQaQuestion({
    question: task.question,
    knowledgeBases
  });
  const nextStatus: WorkStatus = result.citations.length > 0 && !isNoHitAnswer(result.answer) ? "resolved" : "processing";
  const summary = [
    `复测对象：${task.source === "feedback" ? "员工反馈" : "无引用回答"}`,
    `复测结论：${statusText(nextStatus)}`,
    `引用数量：${result.citations.length}`,
    `耗时：${result.latency_ms}ms`,
    `复测回答：${result.answer.slice(0, 240)}${result.answer.length > 240 ? "..." : ""}`
  ].join("\n");
  const updatedTask = await updateKnowledgeTask(task.id, {
    status: nextStatus,
    note: appendRetestNote(task.note, summary)
  });

  return {
    task: updatedTask,
    status: nextStatus,
    answer: result.answer,
    citations: result.citations,
    latency_ms: result.latency_ms,
    summary
  };
}

function qaRetestStatus(input: {
  answer: string;
  citationCount: number;
  coverage: { coverage: number; missing: string[] };
}): WorkStatus {
  if (input.citationCount === 0 || isNoHitAnswer(input.answer)) {
    return "processing";
  }

  if (input.coverage.coverage >= 60) {
    return "resolved";
  }

  return "processing";
}

function appendRetestNote(note: string | null, summary: string) {
  const timestamp = new Date().toLocaleString("zh-CN");
  return [note?.trim(), `复测时间：${timestamp}`, summary].filter(Boolean).join("\n\n");
}

function statusText(status: WorkStatus) {
  if (status === "resolved") {
    return "复测通过，任务可关闭";
  }

  if (status === "processing") {
    return "复测未通过，仍需整改";
  }

  if (status === "ignored") {
    return "已忽略";
  }

  return "待处理";
}

function isNoHitAnswer(answer: string) {
  return answer.includes("未在知识库中找到明确依据");
}
