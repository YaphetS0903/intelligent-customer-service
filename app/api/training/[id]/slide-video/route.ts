import { NextResponse } from "next/server";
import {
  createTrainingVideoJob,
  getTrainingJob,
  listTrainingVideoJobs,
  requireAdmin
} from "@/lib/db";
import { summarizeTrainingScript } from "@/lib/digital-human";
import { buildInitialSlideVideoMetadata, reconcileStaleSlideVideoJobs, startTrainingSlideVideoJob } from "@/lib/training-video-job";
import { mergeTrainingListSnapshot } from "@/lib/training-list-cache";

export const runtime = "nodejs";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireAdmin();
    const { id } = await params;
    const trainingJob = await getTrainingJob(id);

    if (!trainingJob) {
      return NextResponse.json({ error: "培训任务不存在" }, { status: 404 });
    }

    if (trainingJob.status !== "ready") {
      return NextResponse.json({ error: "课程讲稿未生成完成，暂不能生成课件视频" }, { status: 400 });
    }

    if (trainingJob.script_json.length === 0) {
      return NextResponse.json({ error: "该课程没有可用于生成视频的讲稿" }, { status: 400 });
    }

    const missingImage = trainingJob.script_json.find((slide) => !slide.image_path);
    if (missingImage) {
      return NextResponse.json(
        { error: `第 ${missingImage.page} 页还没有课件画面，请重新上传 PPTX 或确认 PPT 渲染工具已安装。` },
        { status: 400 }
      );
    }

    const existingVideoJobs = await reconcileStaleSlideVideoJobs(await listTrainingVideoJobs(id));
    const runningVideoJob = existingVideoJobs.find((item) =>
      item.provider === "slide-video" && (item.status === "queued" || item.status === "generating")
    );

    if (runningVideoJob) {
      await mergeTrainingListSnapshot({ trainingJob, videoJob: runningVideoJob });
      return NextResponse.json(
        { videoJob: runningVideoJob, message: "课件视频已在后台生成中，请刷新页面查看进度。" },
        { status: 202 }
      );
    }

    const videoJob = await createTrainingVideoJob({
      training_job_id: id,
      provider: "slide-video",
      provider_job_id: null,
      status: "queued",
      video_url: null,
      cover_url: null,
      error_message: null,
      avatar_id: null,
      voice_id: null,
      script_summary: summarizeTrainingScript(trainingJob).slice(0, 4000),
      metadata: buildInitialSlideVideoMetadata(trainingJob),
      created_by: user.id
    });

    await mergeTrainingListSnapshot({ trainingJob, videoJob });
    startTrainingSlideVideoJob({ trainingJob, videoJob });

    return NextResponse.json({ videoJob, message: "课件视频已进入后台生成队列。" }, { status: 202 });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "课件视频生成失败"
      },
      { status: 400 }
    );
  }
}
