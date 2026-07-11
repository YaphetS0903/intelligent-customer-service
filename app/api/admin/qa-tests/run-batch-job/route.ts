import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/db";
import { createQaBatchJob } from "@/lib/qa-batch-job";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const user = await requireAdmin();
    const body = await request.json().catch(() => ({}));
    const job = createQaBatchJob({
      mode: String(body.mode ?? "unanswered"),
      limit: Number(body.limit ?? 20),
      createdBy: user.id
    });

    return NextResponse.json({ job });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "创建批量运行任务失败" },
      { status: 400 }
    );
  }
}
