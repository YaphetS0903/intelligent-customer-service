import { NextResponse } from "next/server";
import { env } from "@/lib/config";
import { createKnowledgeBase, listKnowledgeBases, requireAdmin } from "@/lib/db";
import { createVectorStore } from "@/lib/openai-rag";
import type { KnowledgeBase } from "@/lib/types";

function normalizeVisibility(value: unknown): KnowledgeBase["visibility"] {
  if (value === "department" || value === "position" || value === "admin_only" || value === "all") {
    return value;
  }

  return "all";
}

function normalizeList(value: unknown) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }

  if (typeof value === "string") {
    return value
      .split(/[,，\n]/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [];
}

export async function GET() {
  try {
    await requireAdmin();
    const knowledgeBases = await listKnowledgeBases();
    return NextResponse.json({ knowledgeBases, ragProvider: env.ragProvider });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "无权访问" },
      { status: 403 }
    );
  }
}

export async function POST(request: Request) {
  try {
    await requireAdmin();

    const body = await request.json();
    const name = String(body.name ?? "").trim();

    if (!name) {
      return NextResponse.json({ error: "知识库名称不能为空" }, { status: 400 });
    }

    const visibility = normalizeVisibility(body.visibility);
    const departments = visibility === "department" ? normalizeList(body.departments) : [];
    const positions = visibility === "position" ? normalizeList(body.positions) : [];

    if (visibility === "department" && departments.length === 0) {
      return NextResponse.json({ error: "部门可见时至少填写一个部门" }, { status: 400 });
    }

    if (visibility === "position" && positions.length === 0) {
      return NextResponse.json({ error: "岗位可见时至少填写一个岗位" }, { status: 400 });
    }

    const vectorStore = await createVectorStore(name);
    const knowledgeBase = await createKnowledgeBase({
      name,
      description: body.description ? String(body.description) : null,
      openai_vector_store_id: vectorStore?.id ?? null,
      visibility,
      departments,
      positions
    });

    return NextResponse.json({ knowledgeBase });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "创建失败" },
      { status: 400 }
    );
  }
}
