import type { ServiceTicketPriority, WorkStatus } from "@/lib/types";

export const serviceTicketSlaHours: Record<ServiceTicketPriority, number> = {
  low: 72,
  normal: 48,
  high: 24,
  urgent: 4
};

export function isTicketClosedStatus(status: WorkStatus) {
  return status === "resolved" || status === "ignored";
}

export function calculateTicketDueAt(priority: ServiceTicketPriority, from: Date | string = new Date()) {
  const start = from instanceof Date ? from : new Date(from);
  return new Date(start.getTime() + serviceTicketSlaHours[priority] * 60 * 60 * 1000).toISOString();
}

export function resolveTicketResolvedAt(
  status: WorkStatus,
  currentResolvedAt: string | null | undefined,
  now = new Date().toISOString()
) {
  if (isTicketClosedStatus(status)) {
    return currentResolvedAt ?? now;
  }

  return null;
}
