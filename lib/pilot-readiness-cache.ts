import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import type { PilotReadiness } from "@/lib/pilot-readiness";

declare global {
  // eslint-disable-next-line no-var
  var __pilotReadinessSnapshot: PilotReadiness | undefined;
}

export async function loadPilotReadinessSnapshot() {
  if (globalThis.__pilotReadinessSnapshot) {
    return globalThis.__pilotReadinessSnapshot;
  }

  try {
    const raw = await readFile(getCachePath(), "utf8");
    const snapshot = normalizeSnapshot(JSON.parse(raw));
    if (!snapshot) {
      return null;
    }

    globalThis.__pilotReadinessSnapshot = snapshot;
    return snapshot;
  } catch {
    return null;
  }
}

export function setPilotReadinessSnapshot(snapshot: PilotReadiness) {
  globalThis.__pilotReadinessSnapshot = snapshot;
  void persistPilotReadinessSnapshot(snapshot);
  return snapshot;
}

async function persistPilotReadinessSnapshot(snapshot: PilotReadiness) {
  try {
    const cachePath = getCachePath();
    await mkdir(path.dirname(cachePath), { recursive: true });
    await writeFile(cachePath, JSON.stringify(snapshot), "utf8");
  } catch (error) {
    console.warn("[pilot-readiness-cache] failed to persist snapshot", error);
  }
}

function getCachePath() {
  return process.env.PILOT_READINESS_CACHE_PATH
    ? path.resolve(process.env.PILOT_READINESS_CACHE_PATH)
    : path.join(process.cwd(), ".data", "pilot-readiness-cache.json");
}

function normalizeSnapshot(value: unknown): PilotReadiness | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const snapshot = value as Partial<PilotReadiness>;
  if (
    typeof snapshot.checkedAt !== "string" ||
    !snapshot.summary ||
    !snapshot.metrics ||
    !Array.isArray(snapshot.parserCoverage) ||
    !Array.isArray(snapshot.checks)
  ) {
    return null;
  }

  return snapshot as PilotReadiness;
}
