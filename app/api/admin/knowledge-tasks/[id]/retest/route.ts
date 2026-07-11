import { NextResponse } from "next/server";
import { retestKnowledgeTask } from "@/lib/knowledge-task-retest";
import { requireAdmin } from "@/lib/db";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(_request: Request, { params }: RouteContext) {
  try {
    await requireAdmin();
    const { id } = await params;
    const result = await retestKnowledgeTask(id);

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "复测失败" },
      { status: 400 }
    );
  }
}
