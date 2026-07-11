import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/db";
import { getAdminInsights } from "@/lib/insights";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  try {
    await requireAdmin();
    const insights = await getAdminInsights();

    return NextResponse.json({ insights });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "获取运营数据失败" },
      { status: 403 }
    );
  }
}
