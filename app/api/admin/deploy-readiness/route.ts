import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/db";
import { getDeployReadiness } from "@/lib/deploy-readiness";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireAdmin();
    const readiness = await getDeployReadiness();

    return NextResponse.json({ readiness });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "获取生产部署检查失败" },
      { status: 403 }
    );
  }
}
