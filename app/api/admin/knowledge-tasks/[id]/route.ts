import { NextResponse } from "next/server";
import { requireAdmin, updateKnowledgeTask } from "@/lib/db";
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
    const task = await updateKnowledgeTask(id, {
      status: normalizeStatus(body.status),
      note: body.note ? String(body.note).trim() : null
    });

    return NextResponse.json({ task });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "更新任务失败" },
      { status: 400 }
    );
  }
}
