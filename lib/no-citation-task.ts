import { createKnowledgeTask, listKnowledgeTasks } from "@/lib/db";
import type { Citation, KnowledgeTask } from "@/lib/types";

const transientFailurePatterns = [
  "智能客服服务暂不可用",
  "对话暂时失败",
  "回答生成失败",
  "未能生成回答"
];

const noHitAnswerPatterns = [
  "未在知识库中找到明确依据",
  "没有在知识库中找到明确依据",
  "未找到明确依据",
  "暂无明确依据"
];

export function isNoCitationKnowledgeGap(input: {
  answer: string;
  citations: Citation[];
}) {
  const answer = input.answer.trim();

  if (!answer) {
    return false;
  }

  if (transientFailurePatterns.some((pattern) => answer.includes(pattern))) {
    return false;
  }

  return input.citations.length === 0 || noHitAnswerPatterns.some((pattern) => answer.includes(pattern));
}

export async function createNoCitationKnowledgeTask(input: {
  conversation_id: string;
  message_id: string;
  question: string;
  answer: string;
  created_by: string | null;
  citations: Citation[];
  knowledge_base_names?: string[];
  model?: string | null;
  retrieval_note?: string | null;
}): Promise<KnowledgeTask | null> {
  if (!isNoCitationKnowledgeGap({ answer: input.answer, citations: input.citations })) {
    return null;
  }

  const existingTask = (await listKnowledgeTasks()).find(
    (task) => task.source === "no_citation" && task.source_id === input.message_id
  );

  if (existingTask) {
    return existingTask;
  }

  const noteParts = [
    input.citations.length === 0
      ? "系统自动创建：这条回答没有可引用来源，需要管理员确认是否补充资料或优化检索。"
      : "系统自动创建：模型已检索到相关片段，但仍判断没有明确依据，需要管理员补充资料或优化分片。",
    input.knowledge_base_names?.length
      ? `资料范围：${input.knowledge_base_names.join("、")}`
      : null,
    input.citations.length > 0 ? `引用数量：${input.citations.length}` : null,
    input.model ? `模型：${input.model}` : null,
    input.retrieval_note ? `召回诊断：${input.retrieval_note}` : null
  ].filter(Boolean);

  return createKnowledgeTask({
    source: "no_citation",
    source_id: input.message_id,
    conversation_id: input.conversation_id,
    question: input.question,
    answer: input.answer,
    status: "pending",
    note: noteParts.join("\n"),
    created_by: input.created_by
  });
}
