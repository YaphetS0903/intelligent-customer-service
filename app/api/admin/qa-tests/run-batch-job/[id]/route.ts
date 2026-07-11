import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/db";
import { cancelQaBatchJob, getQaBatchJob } from "@/lib/qa-batch-job";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: RouteContext) {
  try {
    await requireAdmin();
    const { id } = await params;
    const job = getQaBatchJob(id);

    if (!job) {
      return NextResponse.json({ error: "批量运行任务不存在或已过期" }, { status: 404 });
    }

    return NextResponse.json({ job });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "获取批量运行任务失败" },
      { status: 400 }
    );
  }
}

export async function DELETE(_request: Request, { params }: RouteContext) {
  try {
    await requireAdmin();
    const { id } = await params;
    const job = cancelQaBatchJob(id);

    if (!job) {
      return NextResponse.json({ error: "批量运行任务不存在或已过期" }, { status: 404 });
    }

    return NextResponse.json({ job });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "停止批量运行任务失败" },
      { status: 400 }
    );
  }
}
