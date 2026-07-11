import { NextResponse } from "next/server";
import {
  countUnreadNotifications,
  getCurrentUser,
  listNotifications,
  markAllNotificationsRead
} from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const user = await getCurrentUser();
    const url = new URL(request.url);
    const unreadOnly = url.searchParams.get("unread") === "1";
    const limit = Number(url.searchParams.get("limit") ?? "100");
    const [notifications, unreadCount] = await Promise.all([
      listNotifications(user.id, { unreadOnly, limit }),
      countUnreadNotifications(user.id)
    ]);

    return NextResponse.json({ notifications, unread_count: unreadCount });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "读取通知失败" },
      { status: 401 }
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const user = await getCurrentUser();
    const body = await request.json().catch(() => ({}));
    if (body.action !== "mark_all_read") {
      return NextResponse.json({ error: "不支持的通知操作" }, { status: 400 });
    }
    const updatedCount = await markAllNotificationsRead(user.id);
    return NextResponse.json({ ok: true, updated_count: updatedCount });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "更新通知失败" },
      { status: 400 }
    );
  }
}
