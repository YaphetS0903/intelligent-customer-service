import { env } from "@/lib/config";
import type { AppNotification } from "@/lib/types";

export type NotificationDeliveryChannel = "webhook" | "email_webhook" | "wecom_webhook";

export function configuredNotificationChannels(): NotificationDeliveryChannel[] {
  return [
    env.notificationWebhookUrl ? "webhook" : null,
    env.notificationEmailWebhookUrl ? "email_webhook" : null,
    env.notificationWecomWebhookUrl ? "wecom_webhook" : null
  ].filter((channel): channel is NotificationDeliveryChannel => Boolean(channel));
}

export async function deliverNotificationExternally(notification: AppNotification) {
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
