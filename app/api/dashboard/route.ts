import { NextResponse } from "next/server";
import { getDashboardStats } from "@/lib/dashboard";

export async function GET() {
  try {
    const dashboard = await getDashboardStats();
    return NextResponse.json({ dashboard });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "获取数据失败" },
      { status: 400 }
    );
  }
}
