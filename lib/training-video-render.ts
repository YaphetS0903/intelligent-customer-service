import { execFile } from "child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { promisify } from "util";
import { textToSpeech } from "@/lib/tts";
import type { TrainingJob, TrainingVideoJob } from "@/lib/types";

const execFileAsync = promisify(execFile);

type StorageClient = {
  storage: {
    from(bucket: string): {
      download(storagePath: string): Promise<{ data: Blob | null; error: { message: string } | null }>;
      upload(
        storagePath: string,
        body: Buffer,
        options: { contentType: string; upsert: boolean }
      ): Promise<{ error: { message: string } | null }>;
    };
  };
};

export type SlideVideoRenderResult = {
  video_path: string;
  video_url: string;
  cover_url: string | null;
  audio_paths: string[];
  metadata: Record<string, unknown>;
};

export type SlideVideoRenderStage =
  | "preparing"
  | "slide_image"
  | "audio"
  | "video"
  | "concat"
  | "upload"
  | "ready";

export type SlideVideoRenderProgress = {
  stage: SlideVideoRenderStage;
  message: string;
  total_slides: number;
  slide_images_done: number;
  audio_done: number;
  video_done: number;
  progress: number;
};

export async function renderTrainingSlideVideo(input: {
  job: TrainingJob;
  videoJob: TrainingVideoJob;
  supabase: StorageClient | null;
  onProgress?: (progress: SlideVideoRenderProgress) => Promise<void> | void;
  onAudioPaths?: (audioPaths: string[]) => Promise<void> | void;
}): Promise<SlideVideoRenderResult> {
  const ffmpeg = await resolveCommand("FFMPEG_BIN", ["ffmpeg"]);

  if (!ffmpeg) {
    throw new Error("服务器未安装 ffmpeg，无法合成课程视频。");
  }

  const slides = input.job.script_json;
  if (slides.length === 0) {
    throw new Error("该课程没有可用于生成视频的讲稿。");
  }

  const missingImage = slides.find((slide) => !slide.image_path);
  if (missingImage) {
    throw new Error(`第 ${missingImage.page} 页还没有课件画面，请重新上传 PPTX 或确认 PPT 渲染工具已安装。`);
  }

  const totalSlides = slides.length;
  let slideImagesDone = 0;
  let audioDone = 0;
  let videoDone = 0;
  let generatedAudioBytes = 0;
  const generatedAudioPages: number[] = [];
  const emitProgress = async (stage: SlideVideoRenderStage, message: string) => {
    const weighted = totalSlides > 0
      ? Math.round(((slideImagesDone + audioDone + videoDone) / (totalSlides * 3)) * 90)
      : 0;
    const stageMinimum: Record<SlideVideoRenderStage, number> = {
      preparing: 3,
      slide_image: weighted,
      audio: weighted,
      video: weighted,
      concat: 92,
      upload: 96,
      ready: 100
    };

    await input.onProgress?.({
      stage,
      message,
      total_slides: totalSlides,
      slide_images_done: slideImagesDone,
      audio_done: audioDone,
      video_done: videoDone,
      progress: stage === "ready" ? 100 : Math.min(99, Math.max(weighted, stageMinimum[stage]))
    });
  };

  await emitProgress("preparing", "正在准备课件视频素材。");
  const workDir = await mkdtemp(path.join(tmpdir(), "training-video-"));

  try {
    const imageDir = path.join(workDir, "images");
    const audioDir = path.join(workDir, "audio");
    const segmentDir = path.join(workDir, "segments");
    await Promise.all([
      mkdir(imageDir, { recursive: true }),
      mkdir(audioDir, { recursive: true }),
      mkdir(segmentDir, { recursive: true })
    ]);

    const audioPaths = [...input.job.audio_paths];
    const segmentPaths: string[] = [];

    for (let index = 0; index < slides.length; index += 1) {
      const slide = slides[index];
      const imagePath = path.join(imageDir, `page-${index + 1}.png`);
      const audioPath = path.join(audioDir, `page-${index + 1}.mp3`);
      const segmentPath = path.join(segmentDir, `segment-${String(index + 1).padStart(3, "0")}.mp4`);

      await writeFile(imagePath, await readStoredBinary(slide.image_path ?? "", input.supabase));
      slideImagesDone += 1;
      await emitProgress("slide_image", `第 ${index + 1} 页课件画面已准备。`);

      const cachedAudioPath = audioPaths[index];
      const cachedAudio = cachedAudioPath ? await tryReadStoredBinary(cachedAudioPath, input.supabase) : null;
      if (cachedAudio) {
        await writeFile(audioPath, cachedAudio);
      } else {
        const generatedAudio = await withTimeout(
          textToSpeech(slide.script),
          120000,
          `第 ${index + 1} 页 TTS 生成超时，请稍后重试。`
        );
        if (!generatedAudio) {
          throw new Error("未配置可用 TTS，无法为课程视频生成语音。");
        }

        const audioBuffer = Buffer.from(generatedAudio.audio);
        await writeFile(audioPath, audioBuffer);
        const storedAudioPath = `training-audio/${input.job.id}/page-${index + 1}.mp3`;
        await writeStoredBinary(input.supabase, storedAudioPath, audioBuffer, "audio/mpeg");
        audioPaths[index] = storedAudioPath;
        generatedAudioBytes += audioBuffer.byteLength;
        generatedAudioPages.push(slide.page);
        await input.onAudioPaths?.([...audioPaths]);
      }
      audioDone += 1;
      await emitProgress("audio", `第 ${index + 1} 页语音已准备。`);

      await execFileAsync(
        ffmpeg,
        [
          "-y",
          "-loop",
          "1",
          "-i",
          imagePath,
          "-i",
          audioPath,
          "-vf",
          "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,format=yuv420p",
          "-c:v",
          "libx264",
          "-preset",
          "veryfast",
          "-tune",
          "stillimage",
          "-c:a",
          "aac",
          "-b:a",
          "128k",
          "-shortest",
          "-movflags",
          "+faststart",
          segmentPath
        ],
        { timeout: 180000, maxBuffer: 1024 * 1024 * 16 }
      );
      segmentPaths.push(segmentPath);
      videoDone += 1;
      await emitProgress("video", `第 ${index + 1} 页视频片段已生成。`);
    }

    await emitProgress("concat", "正在合并全部课件视频片段。");
    const concatFile = path.join(workDir, "segments.txt");
    await writeFile(
      concatFile,
      segmentPaths.map((item) => `file '${item.replace(/'/g, "'\\''")}'`).join("\n")
    );

    const outputPath = path.join(workDir, "course.mp4");
    await execFileAsync(
      ffmpeg,
      ["-y", "-f", "concat", "-safe", "0", "-i", concatFile, "-c", "copy", "-movflags", "+faststart", outputPath],
      { timeout: 180000, maxBuffer: 1024 * 1024 * 16 }
    );

    await emitProgress("upload", "正在保存课程视频文件。");
    const videoBuffer = await readFile(outputPath);
    const storedVideoPath = await writeStoredBinary(
      input.supabase,
      `training-videos/${input.job.id}/${input.videoJob.id}.mp4`,
      videoBuffer,
      "video/mp4"
    );

    return {
      video_path: storedVideoPath,
      video_url: `/api/training/${input.job.id}/slide-video/${input.videoJob.id}`,
      cover_url: slides[0]?.image_path ? `/api/training/${input.job.id}/slides/${slides[0].page}` : null,
      audio_paths: audioPaths,
      metadata: {
        kind: "slide_video",
        stage: "ready",
        progress: 100,
        total_slides: totalSlides,
        slide_images_done: slideImagesDone,
        audio_done: audioDone,
        video_done: videoDone,
        video_path: storedVideoPath,
        video_bytes: videoBuffer.byteLength,
        slide_count: slides.length,
        generated_audio_pages: generatedAudioPages,
        generated_audio_bytes: generatedAudioBytes,
        generated_at: new Date().toISOString()
      }
    };
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

export async function readTrainingVideoBinary(input: {
  videoJob: TrainingVideoJob;
  supabase: StorageClient | null;
}) {
  const videoPath = typeof input.videoJob.metadata.video_path === "string" ? input.videoJob.metadata.video_path : "";
  if (!videoPath) {
    throw new Error("课程视频文件不存在。");
  }

  return readStoredBinary(videoPath, input.supabase);
}

async function readStoredBinary(storagePath: string, supabase: StorageClient | null) {
  if (storagePath.startsWith("/")) {
    const publicDir = path.join(process.cwd(), "public");
    const filePath = path.normalize(path.join(publicDir, storagePath.replace(/^\/+/, "")));

    if (!filePath.startsWith(`${publicDir}${path.sep}`)) {
      throw new Error("文件路径不合法。");
    }

    return readFile(filePath);
  }

  if (!supabase) {
    throw new Error("文件存储未配置，无法读取课程视频素材。");
  }

  const { data, error } = await withTimeout(
    supabase.storage.from("documents").download(storagePath),
    60000,
    `读取文件超时：${storagePath}`
  );
  if (error || !data) {
    throw new Error(error?.message ?? "文件不存在。");
  }

  return Buffer.from(await data.arrayBuffer());
}

async function tryReadStoredBinary(storagePath: string, supabase: StorageClient | null) {
  try {
    return await readStoredBinary(storagePath, supabase);
  } catch {
    return null;
  }
}

async function writeStoredBinary(
  supabase: StorageClient | null,
  storagePath: string,
  body: Buffer,
  contentType: string
) {
  if (supabase) {
    const { error } = await withTimeout(
      supabase.storage.from("documents").upload(storagePath, body, {
        contentType,
        upsert: true
      }),
      60000,
      `保存文件超时：${storagePath}`
    );

    if (error) {
      throw new Error(error.message);
    }

    return storagePath;
  }

  const publicPath = path.join(process.cwd(), "public", "generated", ...storagePath.split("/"));
  await mkdir(path.dirname(publicPath), { recursive: true });
  await writeFile(publicPath, body);

  return `/generated/${storagePath}`;
}

async function resolveCommand(envName: string, candidates: string[]) {
  const configured = process.env[envName]?.trim();
  if (configured) {
    return configured;
  }

  try {
    const command = `${candidates.map((candidate) => `command -v ${candidate}`).join(" || ")} || true`;
    const { stdout } = await execFileAsync("sh", ["-lc", command], { timeout: 5000, maxBuffer: 1024 * 1024 });
    return stdout.trim().split(/\s+/)[0] || null;
  } catch {
    return null;
  }
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
