import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/db";
import { getOperationsDashboardReport, parseOperationsDashboardFilters } from "@/lib/operations-dashboard";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  try {
    await requireAdmin();
    const filters = parseOperationsDashboardFilters(new URL(request.url).searchParams);
    const report = await getOperationsDashboardReport(filters);
    return NextResponse.json({ report });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "读取运营看板失败" },
      { status: 500 }
    );
  }
}
