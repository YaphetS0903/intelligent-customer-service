import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/db";
import { generatePilotMarkdownReport } from "@/lib/pilot-report";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireAdmin();
    const markdown = await generatePilotMarkdownReport();
    const date = formatShanghaiDate();
    const fileName = encodeURIComponent(`天瑞智能客服试运行验收报告-${date}.md`);

    return new Response(markdown, {
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": `attachment; filename*=UTF-8''${fileName}`,
        "Cache-Control": "no-store"
      }
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "导出试运行验收报告失败" },
      { status: 403 }
    );
  }
}

function formatShanghaiDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}
