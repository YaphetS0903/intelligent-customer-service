import { NextResponse } from "next/server";
import { env } from "@/lib/config";
import {
  createTrainingJob,
  getCurrentUser,
  listTrainingJobs,
  listTrainingProgress,
  listTrainingVideoJobs,
  requireAdmin
} from "@/lib/db";
import { startTrainingCourseBuildJob, storeTrainingSource } from "@/lib/training-course-job";
import { loadTrainingListSnapshot, mergeTrainingListSnapshot, setTrainingListSnapshot } from "@/lib/training-list-cache";
import { reconcileStaleTrainingAudioJobs } from "@/lib/training-audio-job";
import { reconcileStaleSlideVideoJobs } from "@/lib/training-video-job";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET() {
  try {
    const user = await getCurrentUser();
    const cached = await loadTrainingListSnapshot();
    const [trainingJobs, allProgress, rawVideoJobs] = await Promise.all([
      withFallback(listTrainingJobs(), cached?.trainingJobs ?? [], 8000, "list training jobs"),
      withFallback(listTrainingProgress(), cached?.trainingProgress ?? [], 2500, "list training progress"),
      withFallback(listTrainingVideoJobs(), cached?.videoJobs ?? [], 2500, "list training video jobs")
    ]);
    const videoJobs = await withFallback(
      reconcileStaleTrainingAudioJobs(await reconcileStaleSlideVideoJobs(rawVideoJobs)),
      rawVideoJobs,
      800,
      "reconcile stale training media"
    );
    const visibleTrainingJobs = user.role === "admin"
      ? trainingJobs
      : trainingJobs.filter((job) => job.publish_status === "published" && job.status === "ready");
    const trainingProgress = user.role === "admin"
      ? allProgress
      : allProgress.filter((item) =>
          item.user_id === user.id && visibleTrainingJobs.some((job) => job.id === item.training_job_id)
        );

    if (trainingJobs.length > 0) {
      setTrainingListSnapshot({ trainingJobs, trainingProgress: allProgress, videoJobs });
    }

    return NextResponse.json({ trainingJobs: visibleTrainingJobs, trainingProgress, videoJobs });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "无权访问" },
      { status: 401 }
    );
  }
}

async function withFallback<T>(promise: Promise<T>, fallback: T, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => {
          console.warn(`[training:list] ${label} timed out, using fallback`);
          resolve(fallback);
        }, timeoutMs);
      })
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireAdmin();
    const formData = await request.formData();
    const file = formData.get("file");
    const title = String(formData.get("title") ?? "").trim();

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "请上传 PPTX 文件" }, { status: 400 });
    }

    if (!file.name.toLowerCase().endsWith(".pptx")) {
      return NextResponse.json({ error: "当前仅支持 .pptx 文件" }, { status: 400 });
    }

    if (file.size > env.maxUploadMb * 1024 * 1024) {
      return NextResponse.json({ error: `文件不能超过 ${env.maxUploadMb}MB` }, { status: 400 });
    }

    const courseTitle = title || file.name.replace(/\.pptx$/i, "");
    const fileBuffer = Buffer.from(await file.arrayBuffer());
    const supabase = createSupabaseAdminClient();
    const storagePath = await storeTrainingSource({
      fileName: file.name,
      fileBuffer,
      contentType: file.type || "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      supabase
    });
    const trainingJob = await createTrainingJob({
      title: courseTitle,
      ppt_file_name: file.name,
      ppt_storage_path: storagePath,
      script_json: [],
      audio_paths: [],
      status: "generating",
      publish_status: "draft",
      published_by: null,
      published_at: null,
      created_by: user.id
    });

    await mergeTrainingListSnapshot({ trainingJob });
    startTrainingCourseBuildJob({ trainingJob, fileBuffer });

    return NextResponse.json(
      {
        trainingJob,
        message: "PPT 讲解课程已进入后台生成队列。"
      },
      { status: 202 }
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "生成培训讲解失败" },
      { status: 400 }
    );
  }
}
