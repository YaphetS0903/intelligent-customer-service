import { NextResponse } from "next/server";
import { getCurrentUser, getTrainingJob, getTrainingProgress, upsertTrainingProgress } from "@/lib/db";
import { canAccessTrainingJob } from "@/lib/training-access";
import { applyTrainingHeartbeat } from "@/lib/training-progress";

type RouteContext = { params: Promise<{ id: string }> };

function boundedNumber(value: unknown, minimum: number, maximum: number) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(Math.max(number, minimum), maximum) : minimum;
}

export async function GET(_request: Request, { params }: RouteContext) {
  try {
    const user = await getCurrentUser();
    const { id } = await params;
    const job = await getTrainingJob(id);
    if (!job) return NextResponse.json({ error: "课程不存在" }, { status: 404 });
    if (!canAccessTrainingJob(user, job)) return NextResponse.json({ error: "无权访问该课程" }, { status: 403 });
    return NextResponse.json({ progress: await getTrainingProgress(id, user.id) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "读取学习进度失败" }, { status: 400 });
  }
}

export async function PATCH(request: Request, { params }: RouteContext) {
  try {
    const user = await getCurrentUser();
    const { id } = await params;
    const job = await getTrainingJob(id);
    if (!job) return NextResponse.json({ error: "课程不存在" }, { status: 404 });
    if (!canAccessTrainingJob(user, job)) return NextResponse.json({ error: "无权访问该课程" }, { status: 403 });

    const body = await request.json();
    const existing = await getTrainingProgress(id, user.id);
    const pageIndex = Math.round(boundedNumber(body.current_page, 0, Math.max(job.script_json.length - 1, 0)));
    const now = new Date().toISOString();
    const next = applyTrainingHeartbeat({
      job,
      existing,
      pageIndex,
      consumedSecondsDelta: boundedNumber(body.consumed_seconds_delta, 0, 30),
      activeSecondsDelta: boundedNumber(body.active_seconds_delta, 0, 15),
      playbackPositionSeconds: boundedNumber(body.playback_position_seconds, 0, 24 * 60 * 60),
      now: new Date(now)
    });
    const progress = await upsertTrainingProgress({
      training_job_id: id,
      user_id: user.id,
      ...next
    });
    return NextResponse.json({ progress });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "保存学习进度失败" }, { status: 400 });
  }
}
