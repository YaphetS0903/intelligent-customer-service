import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/db";
import { createKnowledgeTaskRetestBatchJob } from "@/lib/knowledge-task-retest-batch-job";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const user = await requireAdmin();
    const body = await request.json().catch(() => ({}));
    const job = createKnowledgeTaskRetestBatchJob({
      mode: String(body.mode ?? "open"),
      limit: Number(body.limit ?? 20),
      createdBy: user.id
    });

    return NextResponse.json({ job });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "创建整改复测队列失败" },
      { status: 400 }
    );
  }
}
