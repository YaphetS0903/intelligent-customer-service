import { env } from "@/lib/config";
import { getWecomConfig, maskValue } from "@/lib/integrations/config";
import { sendWecomTextCard } from "@/lib/integrations/providers/wecom/client";
import { createDeliveryLog, findDeliveryByNotification, findVerifiedUserIdentity, updateDeliveryLog } from "@/lib/integrations/store";

export async function deliverWecomAppMessage(input: {
  notificationId?: string | null;
  dedupeKey?: string | null;
  recipientUserId: string;
  title: string;
  text: string;
  href?: string | null;
  metadata?: Record<string, unknown>;
  force?: boolean;
}) {
  const config = getWecomConfig();
  if (!config.enabled || (!config.notificationEnabled && !input.force)) return { ok: false, skipped: true, error: "企业微信应用消息通知未启用" };
  if (!config.notificationConfigured) return { ok: false, skipped: true, error: "企业微信应用消息缺少 AgentID 或应用凭据" };
  if (input.notificationId) {
    const existing = await findDeliveryByNotification("wecom", "app_message", input.notificationId);
    if (existing?.status === "sent" || existing?.status === "sending") return { ok: true, skipped: true, log: existing };
  }

  const identity = await findVerifiedUserIdentity("wecom", input.recipientUserId);
  const metadata = { ...input.metadata, identity_status: identity ? "verified" : "missing" };
  const log = await createDeliveryLog({
    connector_id: "wecom",
    channel: "app_message",
    notification_id: input.notificationId ?? null,
    dedupe_key: input.dedupeKey ?? null,
    recipient_user_id: input.recipientUserId,
    recipient_masked: identity ? maskValue(identity.external_user_id) : "未匹配企业微信账号",
    subject: input.title.slice(0, 200),
    status: identity ? "sending" : "skipped",
    latency_ms: null,
    error_message: identity ? null : "本地账号没有已验证的企业微信身份映射",
    metadata
  });
  if (!identity) return { ok: false, skipped: true, error: log.error_message ?? undefined, log };

  const startedAt = Date.now();
  try {
    const result = await sendWecomTextCard({
      toUser: identity.external_user_id,
      title: input.title,
      description: input.text,
      url: absoluteHref(input.href || "/notifications")
    });
    const latency = Date.now() - startedAt;
    const sentMetadata = { ...metadata, wecom_msgid: result.msgid ?? null, response_code: result.response_code ?? null };
    await updateDeliveryLog(log.id, "sent", { latency_ms: latency, metadata: sentMetadata });
    return { ok: true, skipped: false, log: { ...log, status: "sent" as const, latency_ms: latency, metadata: sentMetadata } };
  } catch (error) {
    const message = error instanceof Error ? error.message : "企业微信应用消息发送失败";
    await updateDeliveryLog(log.id, "failed", { latency_ms: Date.now() - startedAt, error_message: message, metadata });
    return { ok: false, skipped: false, error: message, log: { ...log, status: "failed" as const, error_message: message } };
  }
}

function absoluteHref(href: string) {
  try {
    return new URL(href, env.appBaseUrl).toString();
  } catch {
    return href;
  }
}
