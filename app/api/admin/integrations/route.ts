import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/db";
import { getIntegrationDashboard } from "@/lib/integrations/service";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireAdmin();
    return NextResponse.json(await getIntegrationDashboard());
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "读取集成中心失败" }, { status: 403 });
  }
}

