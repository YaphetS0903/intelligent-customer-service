import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/db";
import { generateQaRemediationTaskForTest } from "@/lib/qa-remediation";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export const dynamic = "force-dynamic";

export async function POST(_request: Request, { params }: RouteContext) {
  try {
    const user = await requireAdmin();
    const { id } = await params;
    const result = await generateQaRemediationTaskForTest({
      testId: id,
      createdBy: user.id
    });

    return NextResponse.json({
      ...result,
      created: Boolean(result.task && !result.skipped)
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "生成整改任务失败" },
      { status: 400 }
    );
  }
}
