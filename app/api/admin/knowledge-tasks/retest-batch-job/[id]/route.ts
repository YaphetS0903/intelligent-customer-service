import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/db";
import {
  cancelKnowledgeTaskRetestBatchJob,
  getKnowledgeTaskRetestBatchJob
} from "@/lib/knowledge-task-retest-batch-job";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: RouteContext) {
  try {
    await requireAdmin();
    const { id } = await params;
    const job = getKnowledgeTaskRetestBatchJob(id);

    if (!job) {
      return NextResponse.json({ error: "整改复测队列不存在或已过期" }, { status: 404 });
    }

    return NextResponse.json({ job });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "获取整改复测队列失败" },
      { status: 400 }
    );
  }
}

export async function DELETE(_request: Request, { params }: RouteContext) {
  try {
    await requireAdmin();
    const { id } = await params;
    const job = cancelKnowledgeTaskRetestBatchJob(id);

    if (!job) {
      return NextResponse.json({ error: "整改复测队列不存在或已过期" }, { status: 404 });
    }

    return NextResponse.json({ job });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "停止整改复测队列失败" },
      { status: 400 }
    );
  }
}
