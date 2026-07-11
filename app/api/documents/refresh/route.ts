import { NextResponse } from "next/server";
import { getKnowledgeBase, listDocuments, requireAdmin, updateDocument } from "@/lib/db";
import { mapVectorStoreFileStatus, retrieveVectorStoreFile } from "@/lib/openai-rag";

export async function POST() {
  try {
    await requireAdmin();
    const documents = await listDocuments();
    const refreshed = [];

    for (const document of documents) {
      if (!document.openai_file_id || document.status === "ready" || document.status === "failed") {
        refreshed.push(document);
        continue;
      }

      const knowledgeBase = await getKnowledgeBase(document.knowledge_base_id);
      if (!knowledgeBase?.openai_vector_store_id) {
        refreshed.push(document);
        continue;
      }

      const vectorStoreFile = await retrieveVectorStoreFile(
        knowledgeBase.openai_vector_store_id,
        document.openai_file_id
      );

      if (!vectorStoreFile) {
        refreshed.push(document);
        continue;
      }

      const updated = await updateDocument(document.id, {
        status: mapVectorStoreFileStatus(vectorStoreFile.status)
      });

      refreshed.push(updated);
    }

    return NextResponse.json({ documents: refreshed });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "刷新失败" },
      { status: 400 }
    );
  }
}
