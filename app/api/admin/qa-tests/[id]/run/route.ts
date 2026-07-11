import { NextResponse } from "next/server";
import { createModelUsageEvent, getQaTestCase, listKnowledgeBases, requireAdmin, updateQaTestCase } from "@/lib/db";
import { modelNameFromLabel, modelProviderFromLabel, normalizeModelUsage } from "@/lib/model-usage";
import { evaluateQaAnswer } from "@/lib/qa-quality";
import { runQaQuestion } from "@/lib/qa-runner";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(_request: Request, { params }: RouteContext) {
  try {
    const user = await requireAdmin();
    const { id } = await params;
    const test = await getQaTestCase(id);

    if (!test) {
      return NextResponse.json({ error: "测试用例不存在" }, { status: 404 });
    }

    const knowledgeBases = (await listKnowledgeBases()).filter((kb) =>
      test.knowledge_base_ids.includes(kb.id)
    );

    if (knowledgeBases.length === 0) {
      return NextResponse.json({ error: "测试用例未绑定可用知识库" }, { status: 400 });
    }

    const result = await runQaQuestion({
      question: test.question,
      knowledgeBases
    });
    const evaluation = evaluateQaAnswer({
      answer: result.answer,
      expected_answer: test.expected_answer,
      citations: result.citations,
      latency_ms: result.latency_ms
    });
    const updated = await updateQaTestCase(id, {
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
        status: evaluation.status,
        retrieval_strategy: result.retrieval_strategy,
        citation_count: result.citations.length,
        expected_coverage: evaluation.coverage.coverage,
        latency_ms: result.latency_ms,
        model_attempts: result.model_attempts ?? [],
        knowledge_base_ids: test.knowledge_base_ids
      }
    }).catch((error) => {
      console.error("[qa-test:usage]", error);
    });

    return NextResponse.json({ test: updated, evaluation });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "运行问答测试失败" },
      { status: 400 }
    );
  }
}
