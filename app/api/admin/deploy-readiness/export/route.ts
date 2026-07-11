import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/db";
import { generateLaunchMarkdownReport, generateLaunchQaCsv } from "@/lib/launch-report";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  try {
    await requireAdmin();
    const url = new URL(request.url);
    const format = url.searchParams.get("format") ?? "md";
    const date = formatShanghaiDate();

    if (format === "csv") {
      const csv = await generateLaunchQaCsv();
      const fileName = encodeURIComponent(`天瑞智能客服上线指标-${date}.csv`);

      return new Response(`\uFEFF${csv}`, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename*=UTF-8''${fileName}`,
          "Cache-Control": "no-store"
        }
      });
    }

    const markdown = await generateLaunchMarkdownReport();
    const fileName = encodeURIComponent(`天瑞智能客服上线汇报报告-${date}.md`);

    return new Response(markdown, {
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": `attachment; filename*=UTF-8''${fileName}`,
        "Cache-Control": "no-store"
      }
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "导出上线汇报报告失败" },
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
