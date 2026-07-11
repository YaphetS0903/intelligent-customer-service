import { randomUUID } from "crypto";
import { createModelUsageEvent, listKnowledgeBases, listQaTestCases, updateQaTestCase } from "@/lib/db";
import { modelNameFromLabel, modelProviderFromLabel, normalizeModelUsage } from "@/lib/model-usage";
import { evaluateQaAnswer, normalizeBatchRunMode, shouldRunQaCaseForMode } from "@/lib/qa-quality";
import { runQaQuestion } from "@/lib/qa-runner";

export type QaBatchJobStatus = "queued" | "running" | "completed" | "failed" | "canceled";

export type QaBatchJob = {
  id: string;
  mode: string;
  status: QaBatchJobStatus;
  limit: number;
  total: number;
  completed: number;
  ready: number;
  auto_failed: number;
  failed: number;
  current_question: string | null;
  errors: string[];
  results: Array<{
    id: string;
    status: "ready" | "failed";
    qa_status?: string;
    error?: string;
  }>;
  cancel_requested: boolean;
  created_by: string;
  created_at: string;
  started_at: string | null;
  updated_at: string;
  finished_at: string | null;
};

const jobs = new Map<string, QaBatchJob>();

export function createQaBatchJob(input: {
  mode: string;
  limit?: number;
  createdBy: string;
}) {
  cleanupQaBatchJobs();

  const now = new Date().toISOString();
  const job: QaBatchJob = {
    id: `qabatch-${randomUUID()}`,
    mode: normalizeBatchRunMode(input.mode),
    status: "queued",
    limit: Math.min(Math.max(Number(input.limit ?? 20), 1), 50),
    total: 0,
    completed: 0,
    ready: 0,
    auto_failed: 0,
    failed: 0,
    current_question: null,
    errors: [],
    results: [],
    cancel_requested: false,
    created_by: input.createdBy,
    created_at: now,
    started_at: null,
    updated_at: now,
    finished_at: null
  };

  jobs.set(job.id, job);
  void runQaBatchJob(job.id);

  return serializeQaBatchJob(job);
}

export function getQaBatchJob(id: string) {
  const job = jobs.get(id);
  return job ? serializeQaBatchJob(job) : null;
}

export function cancelQaBatchJob(id: string) {
  const job = jobs.get(id);

  if (!job) {
    return null;
  }

  if (job.status === "queued" || job.status === "running") {
    job.cancel_requested = true;
    touch(job);
  }

  return serializeQaBatchJob(job);
}

async function runQaBatchJob(jobId: string) {
  const job = jobs.get(jobId);

  if (!job) {
    return;
  }

  job.status = "running";
  job.started_at = new Date().toISOString();
  touch(job);

  try {
    const [allTests, knowledgeBases] = await Promise.all([
      listQaTestCases(),
      listKnowledgeBases()
    ]);
    const candidates = allTests
      .filter((test) => shouldRunQaCaseForMode({
        mode: job.mode,
        answer: test.answer,
        expected_answer: test.expected_answer,
        citations: test.citations,
        status: test.status,
        latency_ms: test.latency_ms
      }))
      .slice(0, job.limit);

    job.total = candidates.length;
    touch(job);

    for (const test of candidates) {
      if (job.cancel_requested) {
        finish(job, "canceled");
        return;
      }

      job.current_question = test.question;
      touch(job);

      try {
        const scopedKnowledgeBases = knowledgeBases.filter((kb) => test.knowledge_base_ids.includes(kb.id));

        if (scopedKnowledgeBases.length === 0) {
          throw new Error("未绑定可用知识库");
        }

        const result = await runQaQuestion({
          question: test.question,
          knowledgeBases: scopedKnowledgeBases
        });
        const evaluation = evaluateQaAnswer({
          answer: result.answer,
          expected_answer: test.expected_answer,
          citations: result.citations,
          latency_ms: result.latency_ms
        });
        const updated = await updateQaTestCase(test.id, {
          answer: result.answer,
          citations: result.citations,
          model: result.model,
          latency_ms: result.latency_ms,
          status: evaluation.status,
          reviewer_note: evaluation.reviewer_note
        });
        const usage = normalizeModelUsage({
          usage: result.usage,
          inputText: result.usage_input_text ?? test.question,
          outputText: result.answer
        });

        await createModelUsageEvent({
          source: "qa",
          source_id: test.id,
          conversation_id: null,
          user_id: job.created_by,
          provider: modelProviderFromLabel(result.model),
          model: modelNameFromLabel(result.model),
          ...usage,
          metadata: {
            batch_job_id: job.id,
            batch: true,
            mode: job.mode,
            status: evaluation.status,
            retrieval_strategy: result.retrieval_strategy,
            citation_count: result.citations.length,
            expected_coverage: evaluation.coverage.coverage,
            latency_ms: result.latency_ms,
            model_attempts: result.model_attempts ?? [],
            knowledge_base_ids: test.knowledge_base_ids
          }
        }).catch((error) => {
          console.error("[qa-batch-job:usage]", error);
        });

        job.ready += 1;
        if (updated.status === "failed") {
          job.auto_failed += 1;
        }
        job.results.push({
          id: test.id,
          status: "ready",
          qa_status: updated.status
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "运行失败";
        job.failed += 1;
        job.errors.push(`${test.question}：${message}`);
        job.errors = job.errors.slice(-10);
        job.results.push({
          id: test.id,
          status: "failed",
          error: message
        });
      } finally {
        job.completed += 1;
        touch(job);
      }
    }

    finish(job, job.cancel_requested ? "canceled" : "completed");
  } catch (error) {
    const message = error instanceof Error ? error.message : "批量运行失败";
    job.errors.push(message);
    finish(job, "failed");
  }
}

function touch(job: QaBatchJob) {
  job.updated_at = new Date().toISOString();
}

function finish(job: QaBatchJob, status: QaBatchJobStatus) {
  job.status = status;
  job.current_question = status === "completed"
    ? "批量运行完成"
    : status === "canceled"
      ? "批量运行已停止"
      : job.current_question;
  job.finished_at = new Date().toISOString();
  touch(job);
}

function serializeQaBatchJob(job: QaBatchJob): QaBatchJob {
  return {
    ...job,
    errors: [...job.errors],
    results: job.results.slice(-50).map((result) => ({ ...result }))
  };
}

function cleanupQaBatchJobs() {
  const now = Date.now();
  const terminalStatuses = new Set<QaBatchJobStatus>(["completed", "failed", "canceled"]);

  for (const [id, job] of jobs) {
    if (!terminalStatuses.has(job.status)) {
      continue;
    }

    const finishedAt = job.finished_at ? new Date(job.finished_at).getTime() : 0;
    if (finishedAt && now - finishedAt > 1000 * 60 * 60 * 12) {
      jobs.delete(id);
    }
  }

  const terminalJobs = [...jobs.values()]
    .filter((job) => terminalStatuses.has(job.status))
    .sort((a, b) => new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime());

  while (jobs.size > 30 && terminalJobs.length > 0) {
    const oldest = terminalJobs.shift();
    if (oldest) {
      jobs.delete(oldest.id);
    }
  }
}
