import { rm } from "fs/promises";
import path from "path";
import type { TrainingJob, TrainingVideoJob } from "@/lib/types";

const localStoragePrefix = "local:";

export async function cleanupTrainingJobFiles(input: {
  trainingJob: TrainingJob;
  videoJobs: TrainingVideoJob[];
}) {
  const filePaths = new Set<string>();

  addMaybeLocalPath(filePaths, input.trainingJob.ppt_storage_path);
  for (const slide of input.trainingJob.script_json) {
    addMaybeGeneratedPath(filePaths, slide.image_path);
  }
  for (const audioPath of input.trainingJob.audio_paths) {
    addMaybeGeneratedPath(filePaths, audioPath);
  }
  for (const videoJob of input.videoJobs) {
    const videoPath = typeof videoJob.metadata.video_path === "string" ? videoJob.metadata.video_path : null;
    addMaybeGeneratedPath(filePaths, videoPath);
  }

  await Promise.all(
    [...filePaths].map(async (filePath) => {
      await rm(filePath, { force: true });
      await removeEmptyParents(filePath);
    })
  );
}

function addMaybeGeneratedPath(filePaths: Set<string>, storagePath: string | null | undefined) {
  if (!storagePath || /^https?:\/\//i.test(storagePath) || storagePath.startsWith("/api/")) {
    return;
  }

  const publicDir = path.join(process.cwd(), "public");
  const relativePath = storagePath.startsWith("/generated/")
    ? storagePath.replace(/^\/+/, "")
    : path.join("generated", storagePath.replace(/^\/+/, ""));
  const resolved = path.normalize(path.join(publicDir, relativePath));

  if (resolved.startsWith(`${publicDir}${path.sep}`)) {
    filePaths.add(resolved);
  }
}

function addMaybeLocalPath(filePaths: Set<string>, storagePath: string | null | undefined) {
  if (!storagePath?.startsWith(localStoragePrefix)) {
    return;
  }

  const dataDir = path.join(process.cwd(), ".data");
  const resolved = path.normalize(path.resolve(process.cwd(), storagePath.slice(localStoragePrefix.length)));

  if (resolved.startsWith(`${dataDir}${path.sep}`)) {
    filePaths.add(resolved);
  }
}

async function removeEmptyParents(filePath: string) {
  const stopDirs = [
    path.join(process.cwd(), "public", "generated"),
    path.join(process.cwd(), ".data")
  ];
  let current = path.dirname(filePath);

  while (!stopDirs.includes(current)) {
    try {
      await rm(current);
    } catch {
      return;
    }
    current = path.dirname(current);
  }
}
