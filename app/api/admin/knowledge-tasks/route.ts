import { NextResponse } from "next/server";
import { createKnowledgeTask, requireAdmin } from "@/lib/db";
import type { KnowledgeTask, WorkStatus } from "@/lib/types";

function normalizeSource(value: unknown): KnowledgeTask["source"] {
  if (value === "feedback" || value === "no_citation") {
    return value;
  }

  return "manual";
}

function normalizeStatus(value: unknown): WorkStatus {
  if (value === "processing" || value === "resolved" || value === "ignored") {
    return value;
  }

  return "pending";
}

export async function POST(request: Request) {
  try {
    const user = await requireAdmin();
    const body = await request.json();
    const question = String(body.question ?? "").trim();
    const answer = String(body.answer ?? "").trim();
    const conversationId = String(body.conversation_id ?? "").trim();

    if (!question || !answer || !conversationId) {
      return NextResponse.json({ error: "任务参数不完整" }, { status: 400 });
    }

    const task = await createKnowledgeTask({
      source: normalizeSource(body.source),
      source_id: body.source_id ? String(body.source_id) : null,
      conversation_id: conversationId,
      question,
      answer,
      status: normalizeStatus(body.status),
      note: body.note ? String(body.note).trim() : null,
      created_by: user.id
    });

    return NextResponse.json({ task });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "创建任务失败" },
      { status: 400 }
    );
  }
}
