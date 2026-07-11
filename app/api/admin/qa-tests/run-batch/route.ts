import { NextResponse } from "next/server";
import { createModelUsageEvent, listKnowledgeBases, listQaTestCases, requireAdmin, updateQaTestCase } from "@/lib/db";
import { modelNameFromLabel, modelProviderFromLabel, normalizeModelUsage } from "@/lib/model-usage";
import { evaluateQaAnswer, normalizeBatchRunMode, shouldRunQaCaseForMode } from "@/lib/qa-quality";
import { runQaQuestion } from "@/lib/qa-runner";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const user = await requireAdmin();
    const body = await request.json().catch(() => ({}));
    const mode = normalizeBatchRunMode(String(body.mode ?? "unanswered"));
    const limit = Math.min(Math.max(Number(body.limit ?? 20), 1), 50);
    const allTests = await listQaTestCases();
    const knowledgeBases = await listKnowledgeBases();
    const candidates = allTests
      .filter((test) => shouldRunQaCaseForMode({
        mode,
        answer: test.answer,
        expected_answer: test.expected_answer,
        citations: test.citations,
        status: test.status,
        latency_ms: test.latency_ms
      }))
      .slice(0, limit);
    const results = [];

    for (const test of candidates) {
      try {
        const scopedKnowledgeBases = knowledgeBases.filter((kb) => test.knowledge_base_ids.includes(kb.id));

        if (scopedKnowledgeBases.length === 0) {
          results.push({
            id: test.id,
            status: "failed",
            error: "未绑定可用知识库"
          });
          continue;
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
          user_id: user.id,
          provider: modelProviderFromLabel(result.model),
          model: modelNameFromLabel(result.model),
          ...usage,
          metadata: {
            batch: true,
            mode,
            status: evaluation.status,
            retrieval_strategy: result.retrieval_strategy,
            citation_count: result.citations.length,
            expected_coverage: evaluation.coverage.coverage,
            latency_ms: result.latency_ms,
            model_attempts: result.model_attempts ?? [],
            knowledge_base_ids: test.knowledge_base_ids
          }
        }).catch((error) => {
          console.error("[qa-tests:batch-usage]", error);
        });

        results.push({
          id: test.id,
          status: "ready",
          test: updated,
          evaluation
        });
      } catch (error) {
        results.push({
          id: test.id,
          status: "failed",
          error: error instanceof Error ? error.message : "运行失败"
        });
      }
    }

    return NextResponse.json({
      total: candidates.length,
      ready: results.filter((item) => item.status === "ready").length,
      auto_failed: results.filter((item) => item.status === "ready" && item.test?.status === "failed").length,
      failed: results.filter((item) => item.status === "failed").length,
      results
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "批量运行失败" },
      { status: 400 }
    );
  }
}
