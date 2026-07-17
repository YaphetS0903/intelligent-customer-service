import { env } from "@/lib/config";
import { getWecomConfig, getWinmailConfig } from "@/lib/integrations/config";
import { deliverWecomAppMessage } from "@/lib/integrations/providers/wecom/delivery";
import { deliverWinmailEmail } from "@/lib/integrations/providers/winmail/delivery";
import type { AppNotification } from "@/lib/types";

export type NotificationDeliveryChannel = "webhook" | "email_webhook" | "wecom_webhook" | "winmail" | "wecom";

export function configuredNotificationChannels(): NotificationDeliveryChannel[] {
  return [
    env.notificationWebhookUrl ? "webhook" : null,
    env.notificationEmailWebhookUrl ? "email_webhook" : null,
    env.notificationWecomWebhookUrl ? "wecom_webhook" : null,
    getWecomConfig().enabled && getWecomConfig().notificationEnabled && getWecomConfig().notificationConfigured ? "wecom" : null,
    getWinmailConfig().enabled && getWinmailConfig().notificationEnabled ? "winmail" : null
  ].filter((channel): channel is NotificationDeliveryChannel => Boolean(channel));
}

export async function deliverNotificationExternally(notification: AppNotification, recipient?: { email?: string | null }) {
  const tasks: Array<Promise<{ channel: NotificationDeliveryChannel; ok: boolean; error?: string }>> = [];

  if (env.notificationWebhookUrl) {
    tasks.push(postNotification("webhook", env.notificationWebhookUrl, notification));
  }
  if (env.notificationEmailWebhookUrl) {
    tasks.push(postNotification("email_webhook", env.notificationEmailWebhookUrl, {
      to_user_id: notification.user_id,
      subject: notification.title,
      text: notification.body,
      href: notification.href
    }));
  }
  if (env.notificationWecomWebhookUrl) {
    tasks.push(postNotification("wecom_webhook", env.notificationWecomWebhookUrl, {
      msgtype: "markdown",
      markdown: {
        content: `**${notification.title}**\n${notification.body}${notification.href ? `\n[打开详情](${absoluteHref(notification.href)})` : ""}`
      }
    }));
  }
  const winmail = getWinmailConfig();
  if (winmail.enabled && winmail.notificationEnabled && recipient?.email) {
    tasks.push(deliverWinmailEmail({
      notificationId: notification.id,
      dedupeKey: notification.dedupe_key,
      recipientUserId: notification.user_id,
      recipientEmail: recipient.email,
      subject: notification.title,
      text: `${notification.body}${notification.href ? `\n\n查看详情：${absoluteHref(notification.href)}` : ""}`,
      metadata: { source_type: notification.source_type, source_id: notification.source_id }
    }).then((result) => ({ channel: "winmail" as const, ok: result.ok, error: result.error })));
  }
  const wecom = getWecomConfig();
  if (wecom.enabled && wecom.notificationEnabled && wecom.notificationConfigured) {
    tasks.push(deliverWecomAppMessage({
      notificationId: notification.id,
      dedupeKey: notification.dedupe_key,
      recipientUserId: notification.user_id,
      title: notification.title,
      text: notification.body,
      href: notification.href,
      metadata: { source_type: notification.source_type, source_id: notification.source_id }
    }).then((result) => ({ channel: "wecom" as const, ok: result.ok, error: result.error })));
  }

  return Promise.all(tasks);
}

async function postNotification(
  channel: NotificationDeliveryChannel,
  url: string,
  payload: unknown
) {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5000)
    });
    if (!response.ok) {
      return { channel, ok: false, error: `HTTP ${response.status}` };
    }
    return { channel, ok: true };
  } catch (error) {
    return { channel, ok: false, error: error instanceof Error ? error.message : "投递失败" };
  }
}

function absoluteHref(href: string) {
  try {
    return new URL(href, env.appBaseUrl).toString();
  } catch {
    return href;
  }
}
