import { NextResponse } from "next/server";
import { getQaTestCase, requireAdmin, updateQaTestCase } from "@/lib/db";
import type { QaTestStatus } from "@/lib/types";

type RouteContext = {
  params: Promise<{ id: string }>;
};

function normalizeStatus(value: unknown): QaTestStatus {
  if (value === "passed" || value === "failed") {
    return value;
  }

  return "untested";
}

export async function PATCH(request: Request, { params }: RouteContext) {
  try {
    await requireAdmin();
    const { id } = await params;
    const body = await request.json();
    const existing = await getQaTestCase(id);

    if (!existing) {
      return NextResponse.json({ error: "测试用例不存在" }, { status: 404 });
    }

    const test = await updateQaTestCase(id, {
      question: body.question === undefined ? existing.question : String(body.question ?? "").trim(),
      expected_answer: body.expected_answer === undefined
        ? existing.expected_answer
        : String(body.expected_answer ?? "").trim() || null,
      knowledge_base_ids: Array.isArray(body.knowledge_base_ids)
        ? body.knowledge_base_ids.map((item: unknown) => String(item)).filter(Boolean)
        : existing.knowledge_base_ids,
      status: body.status === undefined ? existing.status : normalizeStatus(body.status),
      reviewer_note: body.reviewer_note === undefined
        ? existing.reviewer_note
        : String(body.reviewer_note ?? "").trim() || null
    });

    return NextResponse.json({ test });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "更新问答测试失败" },
      { status: 400 }
    );
  }
}
