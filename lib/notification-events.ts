import { createNotification, listUsers } from "@/lib/db";
import {
  configuredNotificationChannels,
  deliverNotificationExternally
} from "@/lib/notification-delivery";
import type { AppNotification } from "@/lib/types";

export type NotificationPayload = Omit<
  AppNotification,
  "id" | "user_id" | "read_at" | "created_at"
>;

export async function notifyUsers(userIds: Array<string | null | undefined>, payload: NotificationPayload) {
  const recipients = [...new Set(userIds.filter((id): id is string => Boolean(id)))];
  if (recipients.length === 0) return [];

  const externalChannels = configuredNotificationChannels();
  const results = await Promise.allSettled(recipients.map(async (userId) => {
    const notification = await withTransientRetry(
      () => createNotification({
        ...payload,
        user_id: userId,
        metadata: {
          ...payload.metadata,
          delivery: {
            in_app: true,
            external_channels: externalChannels
          }
        }
      }),
      `notification:${payload.dedupe_key ?? payload.source_id}:${userId}`
    );
    if (externalChannels.length > 0) {
      const delivery = await deliverNotificationExternally(notification);
      const failures = delivery.filter((item) => !item.ok);
      if (failures.length > 0) {
        console.warn("[notification:external-delivery]", failures);
      }
    }
    return notification;
  }));

  return results.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
}

export async function notifyAdmins(
  payload: NotificationPayload,
  options: { excludeUserIds?: string[] } = {}
) {
  try {
    const excluded = new Set(options.excludeUserIds ?? []);
    const users = await withTransientRetry(listUsers, "notification:admin-recipients");
    return notifyUsers(
      users.filter((user) => user.role === "admin" && user.status === "active" && !excluded.has(user.id)).map((user) => user.id),
      payload
    );
  } catch (error) {
    console.warn("[notification:admin-recipients]", error);
    return [];
  }
}

async function withTransientRetry<T>(operation: () => Promise<T>, label: string) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 350));
      }
    }
  }
  console.warn(`[${label}]`, lastError);
  throw lastError;
}
