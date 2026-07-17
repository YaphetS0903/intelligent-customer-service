import { getWecomConfig } from "@/lib/integrations/config";
import { isWecomDirectorySyncDue, nextWecomDirectorySyncAt } from "@/lib/integrations/providers/wecom/schedule-rules";
import { syncWecomDirectory } from "@/lib/integrations/providers/wecom/sync";
import { listSyncRuns } from "@/lib/integrations/store";

export type ScheduledWecomSyncResult = {
  executed: boolean;
  reason: "completed" | "disabled" | "not_due";
  next_run_at: string | null;
  result?: Awaited<ReturnType<typeof syncWecomDirectory>>;
};

let scheduledRun: Promise<ScheduledWecomSyncResult> | null = null;

export function runScheduledWecomDirectorySync() {
  scheduledRun ??= executeScheduledSync().finally(() => {
    scheduledRun = null;
  });
  return scheduledRun;
}

async function executeScheduledSync(): Promise<ScheduledWecomSyncResult> {
  const config = getWecomConfig();
  if (!config.directorySyncEnabled) {
    return { executed: false, reason: "disabled", next_run_at: null };
  }

  const runs = await listSyncRuns(100);
  const lastScheduledRun = runs.find((run) => run.connector_id === "wecom" && run.operation === "directory.sync.schedule");
  const intervalMs = config.directorySyncIntervalMinutes * 60_000;
  const lastStartedAt = lastScheduledRun?.started_at ?? null;
  const now = new Date();
  const nextRunAt = nextWecomDirectorySyncAt(lastStartedAt, config.directorySyncIntervalMinutes, now);
  if (!isWecomDirectorySyncDue(lastStartedAt, config.directorySyncIntervalMinutes, now)) {
    return { executed: false, reason: "not_due", next_run_at: nextRunAt.toISOString() };
  }

  const result = await syncWecomDirectory({
    startedBy: "system:wecom-directory-schedule",
    updateProfiles: true,
    trigger: "schedule"
  });
  return {
    executed: true,
    reason: "completed",
    next_run_at: new Date(Date.now() + intervalMs).toISOString(),
    result
  };
}
