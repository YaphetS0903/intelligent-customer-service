import { NextResponse } from "next/server";
import { listSecurityEvents, requireAdmin } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await requireAdmin();
    const url = new URL(request.url);
    const userId = url.searchParams.get("user_id")?.trim() ?? "";
    const documentId = url.searchParams.get("document_id")?.trim() ?? "";
    const detector = url.searchParams.get("detector")?.trim() ?? "";
    const limit = Math.min(500, Math.max(1, Number.parseInt(url.searchParams.get("limit") ?? "200", 10) || 200));
    const events = (await listSecurityEvents())
      .filter((event) => !userId || event.user_id === userId)
      .filter((event) => !documentId || event.metadata?.document_id === documentId)
      .filter((event) => !detector || event.metadata?.detector === detector)
      .slice(0, limit);

    return NextResponse.json({ events });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "读取安全审计事件失败" },
      { status: 403 }
    );
  }
}
