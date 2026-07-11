import { createReadStream } from "fs";
import { stat } from "fs/promises";
import path from "path";
import { Readable } from "stream";
import { NextResponse } from "next/server";
import { getCurrentUser, getTrainingJob, getTrainingVideoJob } from "@/lib/db";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { loadTrainingListSnapshot } from "@/lib/training-list-cache";
import { readTrainingVideoBinary } from "@/lib/training-video-render";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ id: string; videoId: string }> }) {
  try {
    const user = await getCurrentUser();
    const { id, videoId } = await params;
    const snapshot = await loadTrainingListSnapshot();
    const [trainingJob, videoJob] = await Promise.all([
      withFallback(
        getTrainingJob(id),
        snapshot?.trainingJobs.find((item) => item.id === id) ?? null,
        5000,
        "training job"
      ),
      withFallback(
        getTrainingVideoJob(videoId),
        snapshot?.videoJobs.find((item) => item.id === videoId) ?? null,
        5000,
        "training video job"
      )
    ]);

    if (!trainingJob || !videoJob || videoJob.training_job_id !== id) {
      return NextResponse.json({ error: "课程视频不存在" }, { status: 404 });
    }

    if (user.role !== "admin" && (trainingJob.publish_status !== "published" || trainingJob.status !== "ready")) {
      return NextResponse.json({ error: "课程未发布" }, { status: 403 });
    }

    if (videoJob.status !== "ready") {
      return NextResponse.json({ error: "课程视频尚未生成完成" }, { status: 404 });
    }

    const videoPath = typeof videoJob.metadata.video_path === "string" ? videoJob.metadata.video_path : "";
    const localVideoPath = resolvePublicGeneratedPath(videoPath);
    if (localVideoPath) {
      return await localVideoResponse(localVideoPath, request.headers.get("range"));
    }

    const video = await readTrainingVideoBinary({
      videoJob,
      supabase: createSupabaseAdminClient()
    });
    return videoResponse(video, request.headers.get("range"));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "读取课程视频失败" },
      { status: 400 }
    );
  }
}

function withFallback<T>(promise: Promise<T>, fallback: T, timeoutMs: number, label: string): Promise<T> {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) {
        return;
      }

      settled = true;
      console.warn(`[training-video:stream] ${label} timed out, using snapshot fallback`);
      resolve(fallback);
    }, timeoutMs);

    promise
      .then((value) => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(timer);
        console.warn(`[training-video:stream] ${label} failed, using snapshot fallback`, error);
        resolve(fallback);
      });
  });
}

function resolvePublicGeneratedPath(videoPath: string) {
  if (!videoPath.startsWith("/")) {
    return null;
  }

  const publicDir = path.join(process.cwd(), "public");
  const filePath = path.normalize(path.join(publicDir, videoPath.replace(/^\/+/, "")));

  if (!filePath.startsWith(`${publicDir}${path.sep}`)) {
    throw new Error("课程视频路径不合法。");
  }

  return filePath;
}

async function localVideoResponse(filePath: string, range: string | null) {
  const file = await stat(filePath);
  const size = file.size;
  const parsedRange = parseRangeHeader(range, size);

  if (parsedRange === "invalid") {
    return new Response(null, {
      status: 416,
      headers: {
        "Accept-Ranges": "bytes",
        "Content-Range": `bytes */${size}`
      }
    });
  }

  const start = parsedRange?.start ?? 0;
  const end = parsedRange?.end ?? size - 1;
  const stream = createReadStream(filePath, { start, end });
  const body = Readable.toWeb(stream) as ReadableStream;

  if (parsedRange) {
    return new Response(body, {
      status: 206,
      headers: {
        "Accept-Ranges": "bytes",
        "Cache-Control": "private, max-age=3600",
        "Content-Length": String(end - start + 1),
        "Content-Range": `bytes ${start}-${end}/${size}`,
        "Content-Type": "video/mp4"
      }
    });
  }

  return new Response(body, {
    headers: {
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, max-age=3600",
      "Content-Length": String(size),
      "Content-Type": "video/mp4"
    }
  });
}

function parseRangeHeader(range: string | null, size: number): { start: number; end: number } | "invalid" | null {
  if (!range) {
    return null;
  }

  const match = range.match(/^bytes=(\d*)-(\d*)$/);
  if (!match) {
    return "invalid";
  }

  const [, rawStart, rawEnd] = match;
  if (!rawStart && !rawEnd) {
    return "invalid";
  }

  let start: number;
  let end: number;

  if (!rawStart) {
    const suffixLength = Number(rawEnd);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) {
      return "invalid";
    }
    start = Math.max(size - suffixLength, 0);
    end = size - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd ? Number(rawEnd) : size - 1;
  }

  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || start >= size) {
    return "invalid";
  }

  return {
    start,
    end: Math.min(end, size - 1)
  };
}

function videoResponse(video: Buffer, range: string | null) {
  if (range) {
    const match = range.match(/bytes=(\d*)-(\d*)/);
    if (match) {
      const start = match[1] ? Number(match[1]) : 0;
      const end = match[2] ? Math.min(Number(match[2]), video.length - 1) : video.length - 1;
      const chunk = video.subarray(start, end + 1);
      const body = chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength) as ArrayBuffer;

      return new Response(body, {
        status: 206,
        headers: {
          "Accept-Ranges": "bytes",
          "Cache-Control": "private, max-age=3600",
          "Content-Length": String(chunk.byteLength),
          "Content-Range": `bytes ${start}-${end}/${video.length}`,
          "Content-Type": "video/mp4"
        }
      });
    }
  }

  const body = video.buffer.slice(video.byteOffset, video.byteOffset + video.byteLength) as ArrayBuffer;

  return new Response(body, {
    headers: {
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, max-age=3600",
      "Content-Length": String(video.byteLength),
      "Content-Type": "video/mp4"
    }
  });
}
