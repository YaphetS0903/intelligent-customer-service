import { NextResponse } from "next/server";
import { getCurrentUser, markNotificationRead } from "@/lib/db";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: RouteContext) {
  try {
    const user = await getCurrentUser();
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const notification = await markNotificationRead(id, user.id, body.read !== false);
    return NextResponse.json({ notification });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "更新通知失败" },
      { status: 400 }
    );
  }
}
