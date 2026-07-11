import { NextResponse } from "next/server";
import {
  createTrainingVideoJob,
  getTrainingJob,
  listTrainingVideoJobs,
  requireAdmin
} from "@/lib/db";
import {
  buildInitialTrainingAudioMetadata,
  reconcileStaleTrainingAudioJobs,
  startTrainingAudioBuildJob
} from "@/lib/training-audio-job";
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
      return NextResponse.json({ error: "课程讲稿未生成完成，暂不能预生成语音" }, { status: 400 });
    }

    if (trainingJob.script_json.length === 0) {
      return NextResponse.json({ error: "该课程没有可用于生成语音的讲稿" }, { status: 400 });
    }

    const existingAudioJobs = await reconcileStaleTrainingAudioJobs(await listTrainingVideoJobs(id));
    const runningAudioJob = existingAudioJobs.find((item) =>
      item.provider === "training-audio" && (item.status === "queued" || item.status === "generating")
    );

    if (runningAudioJob) {
      await mergeTrainingListSnapshot({ trainingJob, videoJob: runningAudioJob });
      return NextResponse.json(
        { videoJob: runningAudioJob, message: "课程语音已在后台生成中，请刷新页面查看进度。" },
        { status: 202 }
      );
    }

    const audioJob = await createTrainingVideoJob({
      training_job_id: id,
      provider: "training-audio",
      provider_job_id: null,
      status: "queued",
      video_url: null,
      cover_url: null,
      error_message: null,
      avatar_id: null,
      voice_id: null,
      script_summary: trainingJob.script_json.map((slide) => slide.script).join("\n\n").slice(0, 4000),
      metadata: buildInitialTrainingAudioMetadata(trainingJob),
      created_by: user.id
    });

    await mergeTrainingListSnapshot({ trainingJob, videoJob: audioJob });
    startTrainingAudioBuildJob({ trainingJob, audioJob });

    return NextResponse.json({ videoJob: audioJob, message: "课程语音已进入后台生成队列。" }, { status: 202 });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "课程语音生成失败"
      },
      { status: 400 }
    );
  }
}
