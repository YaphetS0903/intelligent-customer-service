import { NextResponse } from "next/server";
import { getDashboardStats } from "@/lib/dashboard";
import { requireAdmin } from "@/lib/db";

export async function GET() {
  try {
    await requireAdmin();
    const dashboard = await getDashboardStats();
    return NextResponse.json({ dashboard });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "获取数据失败" },
      { status: error instanceof Error && error.message === "需要管理员权限" ? 403 : 400 }
    );
  }
}
