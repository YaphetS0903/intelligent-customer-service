import { requireAdmin } from "@/lib/db";
import {
  getOperationsDashboardReport,
  operationsDashboardCsv,
  parseOperationsDashboardFilters
} from "@/lib/operations-dashboard";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  try {
    await requireAdmin();
    const filters = parseOperationsDashboardFilters(new URL(request.url).searchParams);
    const report = await getOperationsDashboardReport(filters);
    return new Response(operationsDashboardCsv(report), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="operations-${filters.from_date}-${filters.to_date}.csv"`,
        "Cache-Control": "no-store"
      }
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "导出运营数据失败" },
      { status: 500 }
    );
  }
}
