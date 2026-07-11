import { NextResponse } from "next/server";
import { requireAdmin, updateFeedback } from "@/lib/db";
import type { WorkStatus } from "@/lib/types";

type RouteContext = {
  params: Promise<{ id: string }>;
};

function normalizeStatus(value: unknown): WorkStatus {
  if (value === "processing" || value === "resolved" || value === "ignored") {
    return value;
  }

  return "pending";
}

export async function PATCH(request: Request, { params }: RouteContext) {
  try {
    await requireAdmin();
    const { id } = await params;
    const body = await request.json();
    const feedback = await updateFeedback(id, {
      status: normalizeStatus(body.status),
      resolution_note: body.resolution_note ? String(body.resolution_note).trim() : null,
      needs_knowledge_update: Boolean(body.needs_knowledge_update)
    });

    return NextResponse.json({ feedback });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "更新反馈失败" },
      { status: 400 }
    );
  }
}
