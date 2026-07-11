import { listKnowledgeTasks, listQaTestCases } from "@/lib/db";
import {
  createKnowledgeTaskRetestBatchJob,
  type KnowledgeTaskRetestBatchJob
} from "@/lib/knowledge-task-retest-batch-job";

export type GovernanceRetestQueueResult = {
  affected_knowledge_base_ids: string[];
  candidate_task_count: number;
  queued_task_count: number;
  skipped_reason: string | null;
  job: KnowledgeTaskRetestBatchJob | null;
};

export async function queueQaRetestsForGovernance(input: {
  knowledgeBaseIds: string[];
  createdBy: string;
  reason: string;
  limit?: number;
}): Promise<GovernanceRetestQueueResult> {
  const knowledgeBaseIds = uniqueStrings(input.knowledgeBaseIds);

  if (knowledgeBaseIds.length === 0) {
    return emptyResult(knowledgeBaseIds, "没有受影响知识库");
  }

  try {
    const [tasks, tests] = await Promise.all([
      listKnowledgeTasks(),
      listQaTestCases({ compactCitations: true })
    ]);
    const testById = new Map(tests.map((test) => [test.id, test]));
    const candidates = tasks
      .filter((task) => task.source === "manual" && task.source_id?.startsWith("qa:"))
      .filter((task) => task.status === "pending" || task.status === "processing")
      .filter((task) => {
        const testId = task.source_id?.replace(/^qa:/, "") ?? "";
        const test = testById.get(testId);
        return Boolean(test?.knowledge_base_ids.some((id) => knowledgeBaseIds.includes(id)));
      });

    if (candidates.length === 0) {
      return emptyResult(knowledgeBaseIds, "没有待处理或处理中的关联 QA 整改任务");
    }

    const limit = Math.min(Math.max(Number(input.limit ?? 20), 1), 50);
    const taskIds = candidates.slice(0, limit).map((task) => task.id);
    const job = createKnowledgeTaskRetestBatchJob({
      mode: "open",
      limit,
      taskIds,
      createdBy: input.createdBy,
      trigger: "governance",
      triggerReason: input.reason
    });

    return {
      affected_knowledge_base_ids: knowledgeBaseIds,
      candidate_task_count: candidates.length,
      queued_task_count: taskIds.length,
      skipped_reason: null,
      job
    };
  } catch (error) {
    return emptyResult(
      knowledgeBaseIds,
      error instanceof Error ? `复测排队失败：${error.message}` : "复测排队失败"
    );
  }
}

export async function queueQaRetestsForStrategyChange(input: {
  createdBy: string;
  previousProvider: string;
  nextProvider: string;
  previousStrategy: string;
  nextStrategy: string;
  limit?: number;
}): Promise<GovernanceRetestQueueResult> {
  if (input.nextProvider !== "local_text") {
    return emptyResult([], "当前不是本地文本 RAG，策略变更不触发自动复测");
  }

  if (input.previousProvider === input.nextProvider && input.previousStrategy === input.nextStrategy) {
    return emptyResult([], "RAG 检索策略未变化");
  }

  try {
    const [tasks, tests] = await Promise.all([
      listKnowledgeTasks(),
      listQaTestCases({ compactCitations: true })
    ]);
    const testById = new Map(tests.map((test) => [test.id, test]));
    const candidates = tasks
      .filter((task) => task.source === "manual" && task.source_id?.startsWith("qa:"))
      .filter((task) => task.status === "pending" || task.status === "processing")
      .filter((task) => {
        const testId = task.source_id?.replace(/^qa:/, "") ?? "";
        return Boolean(testById.get(testId));
      });

    if (candidates.length === 0) {
      return emptyResult([], "没有待处理或处理中的 QA 整改任务");
    }

    const limit = Math.min(Math.max(Number(input.limit ?? 20), 1), 50);
    const taskIds = candidates.slice(0, limit).map((task) => task.id);
    const affectedKnowledgeBaseIds = uniqueStrings(
      taskIds.flatMap((taskId) => {
        const task = candidates.find((item) => item.id === taskId);
        const testId = task?.source_id?.replace(/^qa:/, "") ?? "";
        return testById.get(testId)?.knowledge_base_ids ?? [];
      })
    );
    const job = createKnowledgeTaskRetestBatchJob({
      mode: "open",
      limit,
      taskIds,
      createdBy: input.createdBy,
      trigger: "strategy",
      triggerReason: `RAG 检索策略变更：${input.previousProvider}/${input.previousStrategy} -> ${input.nextProvider}/${input.nextStrategy}`
    });

    return {
      affected_knowledge_base_ids: affectedKnowledgeBaseIds,
      candidate_task_count: candidates.length,
      queued_task_count: taskIds.length,
      skipped_reason: null,
      job
    };
  } catch (error) {
    return emptyResult(
      [],
      error instanceof Error ? `策略复测排队失败：${error.message}` : "策略复测排队失败"
    );
  }
}

function emptyResult(knowledgeBaseIds: string[], skippedReason: string): GovernanceRetestQueueResult {
  return {
    affected_knowledge_base_ids: knowledgeBaseIds,
    candidate_task_count: 0,
    queued_task_count: 0,
    skipped_reason: skippedReason,
    job: null
  };
}

function uniqueStrings(values: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const rawValue of values) {
    const value = String(rawValue ?? "").trim();

    if (!value || seen.has(value)) {
      continue;
    }

    seen.add(value);
    result.push(value);
  }

  return result;
}
