import { NextResponse } from "next/server";
import { getCurrentUser, getTrainingJob, getTrainingProgress, upsertTrainingProgress } from "@/lib/db";

type RouteContext = {
  params: Promise<{ id: string }>;
};

function normalizePages(value: unknown, totalPages: number) {
  const values = Array.isArray(value) ? value : [];
  return [...new Set(values.map((item) => Number(item)).filter((item) => Number.isInteger(item) && item >= 0 && item < totalPages))]
    .sort((a, b) => a - b);
}

export async function GET(_request: Request, { params }: RouteContext) {
  try {
    const user = await getCurrentUser();
    const { id } = await params;
    const job = await getTrainingJob(id);

    if (!job) {
      return NextResponse.json({ error: "课程不存在" }, { status: 404 });
    }

    if (user.role !== "admin" && (job.publish_status !== "published" || job.status !== "ready")) {
      return NextResponse.json({ error: "课程未发布" }, { status: 403 });
    }

    const progress = await getTrainingProgress(id, user.id);

    return NextResponse.json({ progress });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "读取学习进度失败" },
      { status: 400 }
    );
  }
}

export async function PATCH(request: Request, { params }: RouteContext) {
  try {
    const user = await getCurrentUser();
    const { id } = await params;
    const job = await getTrainingJob(id);

    if (!job) {
      return NextResponse.json({ error: "课程不存在" }, { status: 404 });
    }

    if (user.role !== "admin" && (job.publish_status !== "published" || job.status !== "ready")) {
      return NextResponse.json({ error: "课程未发布" }, { status: 403 });
    }

    const body = await request.json();
    const currentPage = Math.min(Math.max(Number(body.current_page ?? 0), 0), Math.max(job.script_json.length - 1, 0));
    const completedPages = normalizePages(body.completed_pages, job.script_json.length);
    const progressPercent = job.script_json.length === 0
      ? 0
      : Math.round((completedPages.length / job.script_json.length) * 100);
    const progress = await upsertTrainingProgress({
      training_job_id: id,
      user_id: user.id,
      completed_pages: completedPages,
      current_page: currentPage,
      progress_percent: progressPercent,
      completed_at: progressPercent >= 100 ? new Date().toISOString() : null
    });

    return NextResponse.json({ progress });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "保存学习进度失败" },
      { status: 400 }
    );
  }
}
