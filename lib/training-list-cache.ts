import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import type { TrainingJob, TrainingProgress, TrainingVideoJob } from "@/lib/types";

export type TrainingListSnapshot = {
  trainingJobs: TrainingJob[];
  trainingProgress: TrainingProgress[];
  videoJobs: TrainingVideoJob[];
  updatedAt: string;
};

declare global {
  // eslint-disable-next-line no-var
  var __trainingListSnapshot: TrainingListSnapshot | undefined;
}

export function getTrainingListSnapshot() {
  return globalThis.__trainingListSnapshot ?? null;
}

export async function loadTrainingListSnapshot() {
  if (globalThis.__trainingListSnapshot) {
    return globalThis.__trainingListSnapshot;
  }

  try {
    const raw = await readFile(getCachePath(), "utf8");
    const snapshot = normalizeSnapshot(JSON.parse(raw));

    if (!snapshot) {
      return null;
    }

    globalThis.__trainingListSnapshot = snapshot;
    return snapshot;
  } catch {
    return null;
  }
}

export function setTrainingListSnapshot(input: Omit<TrainingListSnapshot, "updatedAt">) {
  globalThis.__trainingListSnapshot = {
    ...input,
    updatedAt: new Date().toISOString()
  };

  void persistTrainingListSnapshot(globalThis.__trainingListSnapshot);

  return globalThis.__trainingListSnapshot;
}

export async function mergeTrainingListSnapshot(input: {
  trainingJob?: TrainingJob | null;
  videoJob?: TrainingVideoJob | null;
}) {
  const snapshot = await loadTrainingListSnapshot();

  if (!snapshot) {
    return null;
  }

  return setTrainingListSnapshot({
    trainingJobs: input.trainingJob
      ? upsertById(snapshot.trainingJobs, input.trainingJob)
      : snapshot.trainingJobs,
    trainingProgress: snapshot.trainingProgress,
    videoJobs: input.videoJob
      ? upsertById(snapshot.videoJobs, input.videoJob)
      : snapshot.videoJobs
  });
}

function upsertById<T extends { id: string }>(items: T[], item: T) {
  const exists = items.some((current) => current.id === item.id);

  if (exists) {
    return items.map((current) => current.id === item.id ? item : current);
  }

  return [item, ...items];
}

async function persistTrainingListSnapshot(snapshot: TrainingListSnapshot) {
  try {
    const cachePath = getCachePath();
    await mkdir(path.dirname(cachePath), { recursive: true });
    await writeFile(cachePath, JSON.stringify(snapshot), "utf8");
  } catch (error) {
    console.warn("[training:list-cache] failed to persist snapshot", error);
  }
}

function getCachePath() {
  return process.env.TRAINING_LIST_CACHE_PATH
    ? path.resolve(process.env.TRAINING_LIST_CACHE_PATH)
    : path.join(process.cwd(), ".data", "training-list-cache.json");
}

function normalizeSnapshot(value: unknown): TrainingListSnapshot | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const snapshot = value as Partial<TrainingListSnapshot>;
  if (
    !Array.isArray(snapshot.trainingJobs) ||
    !Array.isArray(snapshot.trainingProgress) ||
    !Array.isArray(snapshot.videoJobs) ||
    typeof snapshot.updatedAt !== "string"
  ) {
    return null;
  }

  return {
    trainingJobs: snapshot.trainingJobs.map((job) => ({
      ...job,
      description: job.description ?? "",
      instructor: job.instructor ?? "",
      cover_url: job.cover_url ?? null,
      visible_departments: Array.isArray(job.visible_departments) ? job.visible_departments : [],
      mandatory: job.mandatory ?? false,
      due_at: job.due_at ?? null,
      quiz_enabled: job.quiz_enabled ?? false,
      quiz_pass_score: job.quiz_pass_score ?? 80,
      quiz_max_attempts: job.quiz_max_attempts ?? 3,
      quiz_time_limit_minutes: job.quiz_time_limit_minutes ?? 30,
      certificate_enabled: job.certificate_enabled ?? true
    })),
    trainingProgress: snapshot.trainingProgress.map((progress) => ({
      ...progress,
      page_learning_seconds: progress.page_learning_seconds ?? {},
      total_learning_seconds: progress.total_learning_seconds ?? 0,
      playback_position_seconds: progress.playback_position_seconds ?? 0,
      last_active_at: progress.last_active_at ?? null
    })),
    videoJobs: snapshot.videoJobs,
    updatedAt: snapshot.updatedAt
  };
}
