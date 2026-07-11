import { readFile, mkdir, writeFile } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";
import { getCurrentUser, getTrainingJob, updateTrainingJob } from "@/lib/db";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { textToSpeech } from "@/lib/tts";
import { recordTrainingTtsUsage } from "@/lib/training-usage";
import { canAccessTrainingJob } from "@/lib/training-access";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser();
    const { id } = await params;
    const body = await request.json();
    const pageIndex = Number(body.page_index ?? 0);
    const job = await getTrainingJob(id);

    if (!job) {
      return NextResponse.json({ error: "培训任务不存在" }, { status: 404 });
    }

    if (!canAccessTrainingJob(user, job)) {
      return NextResponse.json({ error: "无权访问该课程" }, { status: 403 });
    }

    const slide = job.script_json[pageIndex];
    if (!slide) {
      return NextResponse.json({ error: "讲稿页不存在" }, { status: 400 });
    }

    const supabase = createSupabaseAdminClient();
    const cachedPath = job.audio_paths[pageIndex];

    const cachedAudio = await readCachedAudio(cachedPath, supabase);
    if (cachedAudio) {
      return new Response(cachedAudio, {
        headers: {
          "Content-Type": "audio/mpeg",
          "Cache-Control": "private, max-age=3600",
          "X-Audio-Cache": "hit"
        }
      });
    }

    const audio = await textToSpeech(slide.script);
    if (!audio) {
      return NextResponse.json({ error: "未配置可用 TTS。请在配置页填写 OpenAI 或自定义 TTS 配置。" }, { status: 400 });
    }

    const storedAudioPath = await writeCachedAudio({
      jobId: job.id,
      pageIndex,
      audio: Buffer.from(audio.audio),
      contentType: audio.contentType,
      supabase
    });

    if (storedAudioPath) {
      const audioPaths = [...job.audio_paths];
      audioPaths[pageIndex] = storedAudioPath;
      await updateTrainingJob(job.id, { audio_paths: audioPaths });
    }

    await recordTrainingTtsUsage({
      sourceId: `${job.id}:page-${pageIndex + 1}`,
      trainingJobId: job.id,
      userId: user.id,
      text: slide.script,
      audioBytes: audio.audio.byteLength,
      contentType: audio.contentType,
      metadata: {
        trigger: "page_audio",
        page_index: pageIndex,
        page: slide.page,
        cache: "miss",
        stored_audio_path: storedAudioPath
      }
    }).catch((error) => {
      console.error("[training-audio:usage]", error);
    });

    return new Response(audio.audio, {
      headers: {
        "Content-Type": audio.contentType,
        "Cache-Control": "no-store",
        "X-Audio-Cache": "miss"
      }
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "生成语音失败" },
      { status: 400 }
    );
  }
}

async function readCachedAudio(
  storagePath: string | undefined,
  supabase: ReturnType<typeof createSupabaseAdminClient>
) {
  if (!storagePath) {
    return null;
  }

  if (supabase && !isPublicGeneratedPath(storagePath)) {
    const { data, error } = await supabase.storage.from("documents").download(storagePath);
    if (!error && data) {
      return await data.arrayBuffer();
    }
  }

  const localPath = resolveLocalGeneratedAudioPath(storagePath);
  if (!localPath) {
    return null;
  }

  try {
    const buffer = await readFile(localPath);
    return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
  } catch {
    return null;
  }
}

async function writeCachedAudio(input: {
  jobId: string;
  pageIndex: number;
  audio: Buffer;
  contentType: string;
  supabase: ReturnType<typeof createSupabaseAdminClient>;
}) {
  const storagePath = `training-audio/${input.jobId}/page-${input.pageIndex + 1}.mp3`;

  if (input.supabase) {
    const { error } = await input.supabase.storage
      .from("documents")
      .upload(storagePath, input.audio, {
        contentType: input.contentType,
        upsert: true
      });

    return error ? null : storagePath;
  }

  const publicPath = resolveLocalGeneratedAudioPath(storagePath);
  if (!publicPath) {
    return null;
  }

  await mkdir(path.dirname(publicPath), { recursive: true });
  await writeFile(publicPath, input.audio);
  return `/generated/${storagePath}`;
}

function isPublicGeneratedPath(storagePath: string) {
  return storagePath.startsWith("/generated/");
}

function resolveLocalGeneratedAudioPath(storagePath: string) {
  const normalizedStoragePath = isPublicGeneratedPath(storagePath)
    ? storagePath.replace(/^\/+/, "")
    : path.join("generated", storagePath.replace(/^\/+/, ""));
  const publicDir = path.join(process.cwd(), "public");
  const filePath = path.normalize(path.join(publicDir, normalizedStoragePath));

  if (!filePath.startsWith(`${publicDir}${path.sep}`)) {
    return null;
  }

  return filePath;
}
