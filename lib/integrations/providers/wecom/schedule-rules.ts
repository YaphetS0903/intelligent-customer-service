export function nextWecomDirectorySyncAt(lastStartedAt: string | null, intervalMinutes: number, now = new Date()) {
  if (!lastStartedAt) return now;
  const lastTime = new Date(lastStartedAt).getTime();
  if (!Number.isFinite(lastTime)) return now;
  return new Date(lastTime + intervalMinutes * 60_000);
}

export function isWecomDirectorySyncDue(lastStartedAt: string | null, intervalMinutes: number, now = new Date()) {
  return nextWecomDirectorySyncAt(lastStartedAt, intervalMinutes, now).getTime() <= now.getTime();
}
