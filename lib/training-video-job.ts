import { getTrainingJob, updateTrainingJob, updateTrainingVideoJob } from "@/lib/db";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { mergeTrainingListSnapshot } from "@/lib/training-list-cache";
import { recordTrainingTtsUsage, recordTrainingVideoUsage } from "@/lib/training-usage";
import { renderTrainingSlideVideo, type SlideVideoRenderProgress } from "@/lib/training-video-render";
import type { TrainingJob, TrainingVideoJob } from "@/lib/types";

const configuredSlideVideoStaleMinutes = Number(process.env.TRAINING_VIDEO_STALE_MINUTES ?? "20");
const slideVideoStaleMinutes = Number.isFinite(configuredSlideVideoStaleMinutes)
  ? Math.max(5, configuredSlideVideoStaleMinutes)
  : 20;
const slideVideoStaleMs = slideVideoStaleMinutes * 60 * 1000;

declare global {
  // eslint-disable-next-line no-var
  var __trainingSlideVideoRunningJobs: Set<string> | undefined;
}

const runningJobs = globalThis.__trainingSlideVideoRunningJobs ?? new Set<string>();
globalThis.__trainingSlideVideoRunningJobs = runningJobs;

type SlideVideoMetadata = Record<string, unknown>;

export function buildInitialSlideVideoMetadata(job: TrainingJob): SlideVideoMetadata {
  return {
    kind: "slide_video",
    stage: "queued",
    progress: 0,
    total_slides: job.script_json.length,
    slide_images_done: 0,
    audio_done: 0,
    video_done: 0,
    message: "课件视频任务已进入后台队列。",
    queued_at: new Date().toISOString()
  };
}

export async function reconcileStaleSlideVideoJobs(videoJobs: TrainingVideoJob[]) {
  const now = Date.now();
  const reconciled: TrainingVideoJob[] = [];

  for (const videoJob of videoJobs) {
    if (!isStaleSlideVideoJob(videoJob, now)) {
      reconciled.push(videoJob);
      continue;
    }

    const message = `后台视频任务中断或超过 ${slideVideoStaleMinutes} 分钟没有进度更新，可点击重新生成。`;
    const metadata = {
      ...videoJob.metadata,
      stage: "failed",
      message,
      stale_detected_at: new Date(now).toISOString()
    };

    try {
      const updated = await updateTrainingVideoJobAndSnapshot(videoJob.id, {
        status: "failed",
        error_message: message,
        metadata
      });
      reconciled.push(updated);
    } catch {
      reconciled.push(videoJob);
    }
  }

  return reconciled;
}

function isStaleSlideVideoJob(videoJob: TrainingVideoJob, now: number) {
  if (videoJob.provider !== "slide-video" || (videoJob.status !== "queued" && videoJob.status !== "generating")) {
    return false;
  }

  const updatedAt = new Date(videoJob.updated_at).getTime();
  if (!Number.isFinite(updatedAt)) {
    return false;
  }

  return now - updatedAt > slideVideoStaleMs;
}

export function startTrainingSlideVideoJob(input: {
  trainingJob: TrainingJob;
  videoJob: TrainingVideoJob;
}) {
  if (runningJobs.has(input.videoJob.id)) {
    return;
  }

  runningJobs.add(input.videoJob.id);
  void runTrainingSlideVideoJob(input).finally(() => {
    runningJobs.delete(input.videoJob.id);
  });
}

async function runTrainingSlideVideoJob({
  trainingJob,
  videoJob
}: {
  trainingJob: TrainingJob;
  videoJob: TrainingVideoJob;
}) {
  let metadata: SlideVideoMetadata = {
    ...buildInitialSlideVideoMetadata(trainingJob),
    ...videoJob.metadata,
    stage: "generating",
    progress: 1,
    message: "后台任务已启动，正在准备生成课件视频。",
    started_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  const mergeProgress = async (progress: Partial<SlideVideoRenderProgress> & { message?: string }) => {
    metadata = {
      ...metadata,
      ...progress,
      updated_at: new Date().toISOString()
    };

    await updateTrainingVideoJobAndSnapshot(videoJob.id, {
      status: "generating",
      error_message: null,
      metadata
    });
  };

  try {
    await updateTrainingVideoJobAndSnapshot(videoJob.id, {
      provider_job_id: videoJob.id,
      status: "generating",
      error_message: null,
      metadata
    });

    const latestTrainingJob = await getTrainingJob(trainingJob.id);
    if (!latestTrainingJob) {
      throw new Error("培训任务不存在，无法生成课件视频。");
    }

    const result = await renderTrainingSlideVideo({
      job: latestTrainingJob,
      videoJob,
      supabase: createSupabaseAdminClient(),
      onProgress: mergeProgress,
      onAudioPaths: async (audioPaths) => {
        const updatedTrainingJob = await updateTrainingJob(latestTrainingJob.id, { audio_paths: audioPaths });
        await mergeTrainingListSnapshot({ trainingJob: updatedTrainingJob }).catch((error) => {
          console.warn("[training-video:training-snapshot]", error);
        });
      }
    });

    const updatedTrainingJob = await updateTrainingJob(latestTrainingJob.id, { audio_paths: result.audio_paths });
    await mergeTrainingListSnapshot({ trainingJob: updatedTrainingJob }).catch((error) => {
      console.warn("[training-video:training-snapshot]", error);
    });

    metadata = {
      ...metadata,
      ...result.metadata,
      message: "课件视频已生成，可进入预览页播放。",
      updated_at: new Date().toISOString()
    };

    await updateTrainingVideoJobAndSnapshot(videoJob.id, {
      provider_job_id: videoJob.id,
      status: "ready",
      video_url: result.video_url,
      cover_url: result.cover_url,
      error_message: null,
      metadata
    });

    await recordTrainingVideoUsage({
      sourceId: videoJob.id,
      trainingJobId: latestTrainingJob.id,
      userId: videoJob.created_by,
      slideCount: latestTrainingJob.script_json.length,
      videoBytes: typeof result.metadata.video_bytes === "number" ? result.metadata.video_bytes : null,
      metadata: {
        trigger: "slide_video",
        video_job_id: videoJob.id,
        video_path: result.video_path,
        total_slides: result.metadata.total_slides,
        slide_images_done: result.metadata.slide_images_done,
        audio_done: result.metadata.audio_done,
        video_done: result.metadata.video_done
      }
    }).catch((error) => {
      console.error("[training-video:usage]", error);
    });

    const generatedAudioPages = Array.isArray(result.metadata.generated_audio_pages)
      ? result.metadata.generated_audio_pages.map((page) => Number(page)).filter((page) => Number.isFinite(page))
      : [];
    if (generatedAudioPages.length > 0) {
      const generatedScripts = latestTrainingJob.script_json
        .filter((slide) => generatedAudioPages.includes(slide.page))
        .map((slide) => slide.script)
        .join("\n\n");

      await recordTrainingTtsUsage({
        sourceId: `${videoJob.id}:slide-video-tts`,
        trainingJobId: latestTrainingJob.id,
        userId: videoJob.created_by,
        text: generatedScripts,
        audioBytes: typeof result.metadata.generated_audio_bytes === "number" ? result.metadata.generated_audio_bytes : null,
        contentType: "audio/mpeg",
        metadata: {
          trigger: "slide_video",
          video_job_id: videoJob.id,
          generated_audio_pages: generatedAudioPages,
          generated_audio_count: generatedAudioPages.length
        }
      }).catch((error) => {
        console.error("[training-video:tts-usage]", error);
      });
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "课件视频生成失败";
    metadata = {
      ...metadata,
      stage: "failed",
      message: errorMessage,
      failed_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    await updateTrainingVideoJobAndSnapshot(videoJob.id, {
      status: "failed",
      error_message: errorMessage,
      metadata
    });
  }
}

async function updateTrainingVideoJobAndSnapshot(
  id: string,
  input: Parameters<typeof updateTrainingVideoJob>[1]
) {
  const updated = await updateTrainingVideoJob(id, input);
  await mergeTrainingListSnapshot({ videoJob: updated }).catch((error) => {
    console.warn("[training-video:snapshot]", error);
  });
  return updated;
}
