import { NextResponse } from "next/server";
import {
  createTrainingVideoJob,
  getCurrentUser,
  getTrainingJob,
  listTrainingVideoJobs,
  requireAdmin,
  updateTrainingVideoJob
} from "@/lib/db";
import { env, hasDigitalHumanConfig } from "@/lib/config";
import { queryDigitalHumanVideoStatus, submitDigitalHumanVideo, summarizeTrainingScript } from "@/lib/digital-human";
import { mergeTrainingListSnapshot } from "@/lib/training-list-cache";
import { startTrainingSlideVideoJob } from "@/lib/training-video-job";
import type { TrainingVideoJob } from "@/lib/types";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    const user = await getCurrentUser();
    const { id } = await context.params;
    const trainingJob = await getTrainingJob(id);

    if (!trainingJob) {
      return NextResponse.json({ error: "培训任务不存在" }, { status: 404 });
    }

    if (user.role !== "admin" && (trainingJob.publish_status !== "published" || trainingJob.status !== "ready")) {
      return NextResponse.json({ error: "课程未发布" }, { status: 403 });
    }

    const videoJobs = await refreshPendingVideoJobs(trainingJob, await listTrainingVideoJobs(id));
    return NextResponse.json({ videoJobs, configured: env.digitalHumanProvider === "custom" });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "读取数字人视频任务失败" },
      { status: 400 }
    );
  }
}

export async function POST(_request: Request, context: RouteContext) {
  let videoJob: TrainingVideoJob | null = null;

  try {
    const user = await requireAdmin();
    const { id } = await context.params;
    const trainingJob = await getTrainingJob(id);

    if (!trainingJob) {
      return NextResponse.json({ error: "培训任务不存在" }, { status: 404 });
    }

    if (trainingJob.script_json.length === 0) {
      return NextResponse.json({ error: "该课程没有可用于生成视频的讲稿" }, { status: 400 });
    }

    if (!hasDigitalHumanConfig()) {
      return NextResponse.json(
        { error: "未配置数字人服务。请先在系统配置中填写数字人 API URL 和 API Key。" },
        { status: 400 }
      );
    }

    videoJob = await createTrainingVideoJob({
      training_job_id: id,
      provider: env.digitalHumanProvider,
      provider_job_id: null,
      status: "queued",
      video_url: null,
      cover_url: null,
      error_message: null,
      avatar_id: env.digitalHumanAvatarId || null,
      voice_id: env.digitalHumanVoiceId || null,
      script_summary: summarizeTrainingScript(trainingJob).slice(0, 4000),
      metadata: {},
      created_by: user.id
    });

    await mergeTrainingListSnapshot({ trainingJob, videoJob });
    const providerResult = await submitDigitalHumanVideo(trainingJob);
    videoJob = await updateTrainingVideoJob(videoJob.id, providerResult);
    await mergeTrainingListSnapshot({ trainingJob, videoJob });

    return NextResponse.json({ videoJob });
  } catch (error) {
    if (videoJob) {
      videoJob = await updateTrainingVideoJob(videoJob.id, {
        status: "failed",
        error_message: error instanceof Error ? error.message : "数字人视频生成失败"
      });
      await mergeTrainingListSnapshot({ videoJob });
    }

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "数字人视频生成失败",
        videoJob
      },
      { status: 400 }
    );
  }
}

async function refreshPendingVideoJobs(trainingJob: Awaited<ReturnType<typeof getTrainingJob>>, videoJobs: TrainingVideoJob[]) {
  const refreshed: TrainingVideoJob[] = [];

  for (const videoJob of videoJobs) {
    if (!["queued", "generating"].includes(videoJob.status)) {
      refreshed.push(videoJob);
      continue;
    }

    if (videoJob.provider === "slide-video") {
      if (trainingJob) {
        startTrainingSlideVideoJob({ trainingJob, videoJob });
      }
      refreshed.push(videoJob);
      continue;
    }

    try {
      const status = await queryDigitalHumanVideoStatus(videoJob);
      if (Object.keys(status).length === 0) {
        refreshed.push(videoJob);
        continue;
      }

      const updated = await updateTrainingVideoJob(videoJob.id, status);
      await mergeTrainingListSnapshot({ trainingJob, videoJob: updated });
      refreshed.push(updated);
    } catch {
      refreshed.push(videoJob);
    }
  }

  return refreshed;
}
