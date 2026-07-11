import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/db";
import { generateQaRemediationTasks } from "@/lib/qa-remediation";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const user = await requireAdmin();
    const body = await request.json().catch(() => ({}));
    const parsedTestIds = Array.isArray(body.test_ids)
      ? body.test_ids
        .map((id: unknown) => String(id))
        .filter((id: string) => Boolean(id))
      : [];
    const testIds = parsedTestIds.length > 0 ? [...new Set<string>(parsedTestIds)] : undefined;
    const limit = Math.min(Math.max(Number(body.limit ?? 50), 1), 100);
    const result = await generateQaRemediationTasks({
      createdBy: user.id,
      limit,
      testIds
    });

    return NextResponse.json({
      total_candidates: result.totalCandidates,
      created: result.created,
      skipped: result.skipped,
      count: result.created.length
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "生成整改建议失败" },
      { status: 400 }
    );
  }
}
