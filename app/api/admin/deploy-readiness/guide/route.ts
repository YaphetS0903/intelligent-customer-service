import fs from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireAdmin();
    const content = await fs.readFile(path.join(process.cwd(), "部署与运维手册.md"), "utf8");
    const fileName = encodeURIComponent("部署与运维手册.md");

    return new Response(content, {
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": `attachment; filename*=UTF-8''${fileName}`,
        "Cache-Control": "no-store"
      }
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "下载部署手册失败" },
      { status: 403 }
    );
  }
}
