import { NextResponse } from "next/server";
import {
  deleteDocument,
  deleteKnowledgeBase,
  getKnowledgeBase,
  listDocumentsByKnowledgeBase,
  requireAdmin,
  updateKnowledgeBase
} from "@/lib/db";
import { removeDocumentSourceFile } from "@/lib/document-storage";
import { deleteVectorStore, deleteVectorStoreFile } from "@/lib/openai-rag";
import type { KnowledgeBase } from "@/lib/types";

type RouteContext = {
  params: Promise<{ id: string }>;
};

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

export async function PATCH(request: Request, { params }: RouteContext) {
  try {
    await requireAdmin();
    const { id } = await params;
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

    const knowledgeBase = await updateKnowledgeBase(id, {
      name,
      description: body.description ? String(body.description).trim() : null,
      visibility,
      departments,
      positions
    });

    return NextResponse.json({ knowledgeBase });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "更新失败" },
      { status: 400 }
    );
  }
}

export async function DELETE(_request: Request, { params }: RouteContext) {
  try {
    await requireAdmin();
    const { id } = await params;
    const knowledgeBase = await getKnowledgeBase(id);

    if (!knowledgeBase) {
      return NextResponse.json({ error: "知识库不存在" }, { status: 404 });
    }

    const documents = await listDocumentsByKnowledgeBase(id);

    for (const document of documents) {
      if (knowledgeBase.openai_vector_store_id && document.openai_file_id) {
        try {
          await deleteVectorStoreFile(knowledgeBase.openai_vector_store_id, document.openai_file_id);
        } catch {
          // The database row should still be removable if the external file was already gone.
        }
      }

      await removeDocumentSourceFile(document.storage_path);

      await deleteDocument(document.id);
    }

    if (knowledgeBase.openai_vector_store_id) {
      try {
        await deleteVectorStore(knowledgeBase.openai_vector_store_id);
      } catch {
        // Keep local cleanup independent from remote vector store cleanup.
      }
    }

    await deleteKnowledgeBase(id);

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "删除失败" },
      { status: 400 }
    );
  }
}
