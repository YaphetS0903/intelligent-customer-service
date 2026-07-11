import { NextResponse } from "next/server";
import { getKnowledgeBase, requireAdmin, updateKnowledgeBase } from "@/lib/db";
import { createVectorStore } from "@/lib/openai-rag";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin();
    const { id } = await params;
    const knowledgeBase = await getKnowledgeBase(id);

    if (!knowledgeBase) {
      return NextResponse.json({ error: "知识库不存在" }, { status: 404 });
    }

    if (knowledgeBase.openai_vector_store_id) {
      return NextResponse.json({ knowledgeBase });
    }

    const vectorStore = await createVectorStore(knowledgeBase.name);
    if (!vectorStore) {
      return NextResponse.json(
        { error: "未配置 OPENAI_API_KEY，无法创建 vector store" },
        { status: 400 }
      );
    }

    const updated = await updateKnowledgeBase(knowledgeBase.id, {
      openai_vector_store_id: vectorStore.id
    });

    return NextResponse.json({ knowledgeBase: updated });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "创建 vector store 失败" },
      { status: 400 }
    );
  }
}
