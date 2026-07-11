import { NextResponse } from "next/server";
import { getDocument, getKnowledgeBase, requireAdmin, updateDocument } from "@/lib/db";
import { mapVectorStoreFileStatus, retrieveVectorStoreFile } from "@/lib/openai-rag";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin();
    const { id } = await params;
    const document = await getDocument(id);

    if (!document) {
      return NextResponse.json({ error: "文档不存在" }, { status: 404 });
    }

    const knowledgeBase = await getKnowledgeBase(document.knowledge_base_id);
    if (!knowledgeBase?.openai_vector_store_id || !document.openai_file_id) {
      return NextResponse.json({ document });
    }

    const vectorStoreFile = await retrieveVectorStoreFile(
      knowledgeBase.openai_vector_store_id,
      document.openai_file_id
    );

    if (!vectorStoreFile) {
      return NextResponse.json({ document });
    }

    const updated = await updateDocument(document.id, {
      status: mapVectorStoreFileStatus(vectorStoreFile.status)
    });

    return NextResponse.json({
      document: updated,
      openai_status: vectorStoreFile.status,
      last_error: vectorStoreFile.last_error
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "刷新失败" },
      { status: 400 }
    );
  }
}
