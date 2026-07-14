import { NextResponse } from "next/server";
import {
  listAllTrainingQuizAttempts,
  listTrainingJobs,
  listTrainingAuditEvents,
  listTrainingProgress,
  listTrainingVideoJobs,
  listTrainingCertificates,
  listUsers,
  requireAdmin
} from "@/lib/db";
import { startTrainingCourseBuildJob } from "@/lib/training-course-job";
import { loadTrainingListSnapshot, setTrainingListSnapshot } from "@/lib/training-list-cache";
import { startTrainingAudioBuildJob } from "@/lib/training-audio-job";
import { startTrainingSlideVideoJob } from "@/lib/training-video-job";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  try {
    await requireAdmin();
    const cached = await loadTrainingListSnapshot();
    const [trainingJobs, trainingProgress, videoJobs, users, quizAttempts, certificates, auditEvents] = await Promise.all([
      withFallback(listTrainingJobs(), cached?.trainingJobs ?? [], 8000, "list training jobs"),
      withFallback(listTrainingProgress(), cached?.trainingProgress ?? [], 2500, "list training progress"),
      withFallback(listTrainingVideoJobs(), cached?.videoJobs ?? [], 2500, "list training video jobs"),
      withFallback(listUsers(), [], 2500, "list users"),
      withFallback(listAllTrainingQuizAttempts(), [], 2500, "list quiz attempts"),
      withFallback(listTrainingCertificates(), [], 2500, "list certificates"),
      withFallback(listTrainingAuditEvents(), [], 2500, "list training audit events")
    ]);

    for (const trainingJob of trainingJobs) {
      if (trainingJob.status === "generating") {
        startTrainingCourseBuildJob({ trainingJob });
      }
    }

    for (const videoJob of videoJobs) {
      if (!["queued", "generating"].includes(videoJob.status)) {
        continue;
      }

      const trainingJob = trainingJobs.find((item) => item.id === videoJob.training_job_id);
      if (trainingJob && videoJob.provider === "slide-video") {
        startTrainingSlideVideoJob({ trainingJob, videoJob });
      }
      if (trainingJob && videoJob.provider === "training-audio") {
        startTrainingAudioBuildJob({ trainingJob, audioJob: videoJob });
      }
    }

    if (trainingJobs.length > 0) {
      setTrainingListSnapshot({ trainingJobs, trainingProgress, videoJobs });
    }

    return NextResponse.json({
      trainingJobs,
      trainingProgress,
      videoJobs,
      users,
      quizAttempts,
      certificates,
      auditEvents
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "读取培训学习看板失败" },
      { status: 403 }
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
          console.warn(`[training-report] ${label} timed out, using fallback`);
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
