import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { getTrainingJob, updateTrainingJob, updateTrainingVideoJob } from "@/lib/db";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { textToSpeech } from "@/lib/tts";
import { mergeTrainingListSnapshot } from "@/lib/training-list-cache";
import { recordTrainingTtsUsage } from "@/lib/training-usage";
import type { TrainingJob, TrainingVideoJob } from "@/lib/types";

const configuredAudioStaleMinutes = Number(process.env.TRAINING_AUDIO_STALE_MINUTES ?? "20");
const audioStaleMinutes = Number.isFinite(configuredAudioStaleMinutes)
  ? Math.max(5, configuredAudioStaleMinutes)
  : 20;
const audioStaleMs = audioStaleMinutes * 60 * 1000;

type StorageClient = {
  storage: {
    from(bucket: string): {
      upload(
        storagePath: string,
        body: Buffer,
        options: { contentType: string; upsert: boolean }
      ): Promise<{ error: { message: string } | null }>;
    };
  };
};

type AudioJobMetadata = Record<string, unknown>;

declare global {
  // eslint-disable-next-line no-var
  var __trainingAudioRunningJobs: Set<string> | undefined;
}

const runningJobs = globalThis.__trainingAudioRunningJobs ?? new Set<string>();
globalThis.__trainingAudioRunningJobs = runningJobs;

export function buildInitialTrainingAudioMetadata(job: TrainingJob): AudioJobMetadata {
  const totalPages = job.script_json.length;
  const audioDone = countCachedAudio(job);

  return {
    kind: "training_audio",
    stage: "queued",
    progress: totalPages > 0 ? Math.round((audioDone / totalPages) * 100) : 0,
    total_pages: totalPages,
    audio_done: audioDone,
    audio_skipped: audioDone,
    generated_audio_pages: [],
    generated_audio_bytes: 0,
    message: "课程语音任务已进入后台队列。",
    queued_at: new Date().toISOString()
  };
}

export async function reconcileStaleTrainingAudioJobs(videoJobs: TrainingVideoJob[]) {
  const now = Date.now();
  const reconciled: TrainingVideoJob[] = [];

  for (const videoJob of videoJobs) {
    if (!isStaleTrainingAudioJob(videoJob, now)) {
      reconciled.push(videoJob);
      continue;
    }

    const message = `后台语音任务中断或超过 ${audioStaleMinutes} 分钟没有进度更新，可点击重新生成。`;
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

export function startTrainingAudioBuildJob(input: {
  trainingJob: TrainingJob;
  audioJob: TrainingVideoJob;
}) {
  if (runningJobs.has(input.audioJob.id)) {
    return;
  }

  runningJobs.add(input.audioJob.id);
  void runTrainingAudioBuildJob(input).finally(() => {
    runningJobs.delete(input.audioJob.id);
  });
}

async function runTrainingAudioBuildJob({
  trainingJob,
  audioJob
}: {
  trainingJob: TrainingJob;
  audioJob: TrainingVideoJob;
}) {
  let metadata: AudioJobMetadata = {
    ...buildInitialTrainingAudioMetadata(trainingJob),
    ...audioJob.metadata,
    stage: "generating",
    progress: Math.max(1, numberFromMetadata(audioJob.metadata.progress)),
    message: "后台任务已启动，正在预生成课程语音。",
    started_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  const mergeProgress = async (progress: Partial<AudioJobMetadata>) => {
    metadata = {
      ...metadata,
      ...progress,
      updated_at: new Date().toISOString()
    };

    await updateTrainingVideoJobAndSnapshot(audioJob.id, {
      provider_job_id: audioJob.id,
      status: "generating",
      error_message: null,
      metadata
    });
  };

  try {
    await mergeProgress({});

    const latestTrainingJob = await getTrainingJob(trainingJob.id);
    if (!latestTrainingJob) {
      throw new Error("培训任务不存在，无法生成课程语音。");
    }

    if (latestTrainingJob.script_json.length === 0) {
      throw new Error("该课程没有可用于生成语音的讲稿。");
    }

    const supabase = createSupabaseAdminClient();
    const audioPaths = [...latestTrainingJob.audio_paths];
    const totalPages = latestTrainingJob.script_json.length;
    let audioDone = 0;
    let audioSkipped = 0;
    let generatedAudioBytes = 0;
    let generatedAudioContentType = "audio/mpeg";
    const generatedAudioPages: number[] = [];

    for (let index = 0; index < latestTrainingJob.script_json.length; index += 1) {
      const slide = latestTrainingJob.script_json[index];

      if (audioPaths[index]) {
        audioDone += 1;
        audioSkipped += 1;
        await mergeProgress({
          total_pages: totalPages,
          audio_done: audioDone,
          audio_skipped: audioSkipped,
          progress: progressPercent(audioDone, totalPages),
          message: `第 ${index + 1} 页语音已缓存，已跳过。`
        });
        continue;
      }

      const generatedAudio = await withTimeout(
        textToSpeech(slide.script),
        120000,
        `第 ${index + 1} 页 TTS 生成超时，请稍后重试。`
      );
      if (!generatedAudio) {
        throw new Error("未配置可用 TTS，无法预生成课程语音。");
      }

      const audioBuffer = Buffer.from(generatedAudio.audio);
      const storedAudioPath = await writeTrainingAudio({
        jobId: latestTrainingJob.id,
        pageIndex: index,
        audio: audioBuffer,
        contentType: generatedAudio.contentType,
        supabase
      });

      audioPaths[index] = storedAudioPath;
      audioDone += 1;
      generatedAudioBytes += audioBuffer.byteLength;
      generatedAudioContentType = generatedAudio.contentType;
      generatedAudioPages.push(slide.page);

      const updatedTrainingJob = await updateTrainingJob(latestTrainingJob.id, { audio_paths: audioPaths });
      await mergeTrainingListSnapshot({ trainingJob: updatedTrainingJob }).catch((error) => {
        console.warn("[training-audio:training-snapshot]", error);
      });

      await mergeProgress({
        total_pages: totalPages,
        audio_done: audioDone,
        audio_skipped: audioSkipped,
        generated_audio_pages: generatedAudioPages,
        generated_audio_bytes: generatedAudioBytes,
        progress: progressPercent(audioDone, totalPages),
        message: `第 ${index + 1} 页语音已生成。`
      });
    }

    const finalTrainingJob = await updateTrainingJob(latestTrainingJob.id, { audio_paths: audioPaths });
    await mergeTrainingListSnapshot({ trainingJob: finalTrainingJob }).catch((error) => {
      console.warn("[training-audio:training-snapshot]", error);
    });

    metadata = {
      ...metadata,
      kind: "training_audio",
      stage: "ready",
      progress: 100,
      total_pages: totalPages,
      audio_done: audioDone,
      audio_skipped: audioSkipped,
      generated_audio_pages: generatedAudioPages,
      generated_audio_bytes: generatedAudioBytes,
      message: "课程语音已预生成完成。",
      generated_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    await updateTrainingVideoJobAndSnapshot(audioJob.id, {
      provider_job_id: audioJob.id,
      status: "ready",
      error_message: null,
      metadata
    });

    if (generatedAudioPages.length > 0) {
      const generatedScripts = latestTrainingJob.script_json
        .filter((slide) => generatedAudioPages.includes(slide.page))
        .map((slide) => slide.script)
        .join("\n\n");

      await recordTrainingTtsUsage({
        sourceId: `${audioJob.id}:audio-prebuild`,
        trainingJobId: latestTrainingJob.id,
        userId: audioJob.created_by,
        text: generatedScripts,
        audioBytes: generatedAudioBytes,
        contentType: generatedAudioContentType,
        metadata: {
          trigger: "audio_prebuild",
          audio_job_id: audioJob.id,
          generated_audio_pages: generatedAudioPages,
          generated_audio_count: generatedAudioPages.length
        }
      }).catch((error) => {
        console.error("[training-audio:usage]", error);
      });
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "课程语音生成失败";
    metadata = {
      ...metadata,
      stage: "failed",
      message: errorMessage,
      failed_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    await updateTrainingVideoJobAndSnapshot(audioJob.id, {
      status: "failed",
      error_message: errorMessage,
      metadata
    });
  }
}

async function writeTrainingAudio(input: {
  jobId: string;
  pageIndex: number;
  audio: Buffer;
  contentType: string;
  supabase: StorageClient | null;
}) {
  const storagePath = `training-audio/${input.jobId}/page-${input.pageIndex + 1}.mp3`;

  if (input.supabase) {
    const { error } = await input.supabase.storage
      .from("documents")
      .upload(storagePath, input.audio, {
        contentType: input.contentType,
        upsert: true
      });

    if (error) {
      throw new Error(error.message);
    }

    return storagePath;
  }

  const publicPath = path.join(process.cwd(), "public", "generated", ...storagePath.split("/"));
  await mkdir(path.dirname(publicPath), { recursive: true });
  await writeFile(publicPath, input.audio);
  return `/generated/${storagePath}`;
}

async function updateTrainingVideoJobAndSnapshot(
  id: string,
  input: Parameters<typeof updateTrainingVideoJob>[1]
) {
  const updated = await updateTrainingVideoJob(id, input);
  await mergeTrainingListSnapshot({ videoJob: updated }).catch((error) => {
    console.warn("[training-audio:snapshot]", error);
  });
  return updated;
}

function isStaleTrainingAudioJob(videoJob: TrainingVideoJob, now: number) {
  if (videoJob.provider !== "training-audio" || (videoJob.status !== "queued" && videoJob.status !== "generating")) {
    return false;
  }

  const updatedAt = new Date(videoJob.updated_at).getTime();
  if (!Number.isFinite(updatedAt)) {
    return false;
  }

  return now - updatedAt > audioStaleMs;
}

function countCachedAudio(job: TrainingJob) {
  return Math.min(job.script_json.length, job.audio_paths.filter(Boolean).length);
}

function progressPercent(done: number, total: number) {
  return total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
}

function numberFromMetadata(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
    return Number(value);
  }

  return 0;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;

  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      })
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}
