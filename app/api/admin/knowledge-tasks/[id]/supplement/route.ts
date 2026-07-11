import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/db";
import { retestKnowledgeTask } from "@/lib/knowledge-task-retest";
import { supplementKnowledgeTask } from "@/lib/knowledge-task-supplement";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, { params }: RouteContext) {
  try {
    const user = await requireAdmin();
    const { id } = await params;
    const body = await request.json();
    const result = await supplementKnowledgeTask({
      taskId: id,
      knowledgeBaseId: String(body.knowledge_base_id ?? "").trim(),
      title: body.title ? String(body.title).trim() : null,
      content: String(body.content ?? "").trim(),
      createdBy: user.id
    });
    const retest = body.retest ? await retestKnowledgeTask(id) : null;

    return NextResponse.json({
      ...result,
      task: retest?.task ?? result.task,
      retest
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "补充知识失败" },
      { status: 400 }
    );
  }
}
