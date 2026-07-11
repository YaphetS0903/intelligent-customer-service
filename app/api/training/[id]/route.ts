import { NextResponse } from "next/server";
import { deleteTrainingJob, getCurrentUser, getTrainingJob, listTrainingVideoJobs, requireAdmin, updateTrainingJob } from "@/lib/db";
import { cleanupTrainingJobFiles } from "@/lib/training-file-cleanup";

function normalizeAction(value: unknown) {
  if (value === "publish" || value === "unpublish" || value === "archive") {
    return value;
  }

  return null;
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser();
    const { id } = await params;
    const trainingJob = await getTrainingJob(id);

    if (!trainingJob) {
      return NextResponse.json({ error: "培训任务不存在" }, { status: 404 });
    }

    if (user.role !== "admin" && (trainingJob.publish_status !== "published" || trainingJob.status !== "ready")) {
      return NextResponse.json({ error: "课程未发布" }, { status: 403 });
    }

    return NextResponse.json({ trainingJob });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "无权访问" },
      { status: 401 }
    );
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireAdmin();
    const { id } = await params;
    const body = await request.json();
    const action = normalizeAction(body.action);
    const trainingJob = await getTrainingJob(id);

    if (!trainingJob) {
      return NextResponse.json({ error: "培训任务不存在" }, { status: 404 });
    }

    if (!action) {
      return NextResponse.json({ error: "课程发布动作不正确" }, { status: 400 });
    }

    if (action === "publish" && trainingJob.status !== "ready") {
      return NextResponse.json({ error: "课程讲稿未生成完成，暂不能发布" }, { status: 400 });
    }

    const next = action === "publish"
      ? {
          publish_status: "published" as const,
          published_by: user.id,
          published_at: new Date().toISOString()
        }
      : {
          publish_status: action === "archive" ? "archived" as const : "draft" as const,
          published_by: null,
          published_at: null
        };
    const updated = await updateTrainingJob(id, next);

    return NextResponse.json({ trainingJob: updated });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "更新课程发布状态失败" },
      { status: 400 }
    );
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin();
    const { id } = await params;
    const [trainingJob, videoJobs] = await Promise.all([
      getTrainingJob(id),
      listTrainingVideoJobs(id)
    ]);

    if (!trainingJob) {
      return NextResponse.json({ error: "培训任务不存在" }, { status: 404 });
    }

    if (trainingJob.publish_status === "published") {
      return NextResponse.json({ error: "已发布课程不能直接删除，请先归档后再删除。" }, { status: 400 });
    }

    try {
      await cleanupTrainingJobFiles({
        trainingJob,
        videoJobs
      });
    } catch (error) {
      console.error("[training:cleanup-files]", error);
    }

    await deleteTrainingJob(id, { skipExistingCheck: true });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "删除课程失败" },
      { status: 400 }
    );
  }
}
