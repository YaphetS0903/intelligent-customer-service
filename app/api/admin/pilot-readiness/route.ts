import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/db";
import { getPilotReadiness } from "@/lib/pilot-readiness";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireAdmin();
    const readiness = await getPilotReadiness();

    return NextResponse.json({ readiness });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "获取试运行验收数据失败" },
      { status: 403 }
    );
  }
}
