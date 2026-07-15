import { getWinmailConfig, maskEmail } from "@/lib/integrations/config";
import { sendWinmailMessage } from "@/lib/integrations/providers/winmail/client";
import { createDeliveryLog, findDeliveryByNotification, updateDeliveryLog } from "@/lib/integrations/store";

export async function deliverWinmailEmail(input: {
  notificationId?: string | null;
  dedupeKey?: string | null;
  recipientUserId?: string | null;
  recipientEmail: string;
  subject: string;
  text: string;
  metadata?: Record<string, unknown>;
  force?: boolean;
}) {
  const config = getWinmailConfig();
  if (!config.enabled || (!config.notificationEnabled && !input.force)) return { ok: false, skipped: true, error: "Winmail 邮件通知未启用" };
  if (input.notificationId) {
    const existing = await findDeliveryByNotification("winmail", "email", input.notificationId);
    if (existing?.status === "sent" || existing?.status === "sending") return { ok: true, skipped: true, log: existing };
  }
  const log = await createDeliveryLog({
    connector_id: "winmail",
    channel: "email",
    notification_id: input.notificationId ?? null,
    dedupe_key: input.dedupeKey ?? null,
    recipient_user_id: input.recipientUserId ?? null,
    recipient_masked: maskEmail(input.recipientEmail),
    subject: input.subject.slice(0, 200),
    status: "sending",
    latency_ms: null,
    error_message: null,
    metadata: input.metadata ?? {}
  });
  const startedAt = Date.now();
  try {
    await sendWinmailMessage({ to: input.recipientEmail, subject: input.subject, text: input.text });
    await updateDeliveryLog(log.id, "sent", { latency_ms: Date.now() - startedAt, metadata: input.metadata ?? {} });
    return { ok: true, skipped: false, log: { ...log, status: "sent" as const, latency_ms: Date.now() - startedAt } };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Winmail 发送失败";
    await updateDeliveryLog(log.id, "failed", { latency_ms: Date.now() - startedAt, error_message: message, metadata: input.metadata ?? {} });
    return { ok: false, skipped: false, error: message, log: { ...log, status: "failed" as const, error_message: message } };
  }
}
