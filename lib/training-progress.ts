import type { TrainingJob, TrainingProgress } from "@/lib/types";

export function expectedSlideSeconds(script: string) {
  return Math.max(8, Math.ceil(script.replace(/\s/g, "").length / 4.2));
}

export function applyTrainingHeartbeat(input: {
  job: TrainingJob;
  existing: TrainingProgress | null;
  pageIndex: number;
  consumedSecondsDelta: number;
  activeSecondsDelta: number;
  playbackPositionSeconds: number;
  now: Date;
}) {
  const elapsedSeconds = input.existing?.last_active_at
    ? Math.max(0, (input.now.getTime() - new Date(input.existing.last_active_at).getTime()) / 1000)
    : 5;
  const allowedActiveDelta = input.existing && elapsedSeconds < 2
    ? 0
    : Math.min(input.activeSecondsDelta, elapsedSeconds + 1, 15);
  const playbackRate = input.activeSecondsDelta > 0 ? input.consumedSecondsDelta / input.activeSecondsDelta : 1;
  const allowedConsumedDelta = Math.min(input.consumedSecondsDelta, allowedActiveDelta * Math.min(Math.max(playbackRate, 0.5), 2), 30);
  const priorPageSeconds: Record<string, number> = input.existing?.page_learning_seconds ?? {};
  const pageLearningSeconds: Record<string, number> = {
    ...priorPageSeconds,
    [input.pageIndex]: roundOne((priorPageSeconds[String(input.pageIndex)] ?? 0) + allowedConsumedDelta)
  };
  const completedPages = input.job.script_json
    .map((slide, index) => pageLearningSeconds[String(index)] >= expectedSlideSeconds(slide.script) * 0.8 ? index : -1)
    .filter((index) => index >= 0);
  const progressPercent = input.job.script_json.length === 0
    ? 0
    : Math.round((completedPages.length / input.job.script_json.length) * 100);
  const now = input.now.toISOString();

  return {
    completed_pages: completedPages,
    current_page: input.pageIndex,
    progress_percent: progressPercent,
    page_learning_seconds: pageLearningSeconds,
    total_learning_seconds: Math.round((input.existing?.total_learning_seconds ?? 0) + allowedActiveDelta),
    playback_position_seconds: input.playbackPositionSeconds,
    last_active_at: now,
    completed_at: progressPercent >= 100 ? input.existing?.completed_at ?? now : null
  };
}

function roundOne(value: number) {
  return Math.round(value * 10) / 10;
}
