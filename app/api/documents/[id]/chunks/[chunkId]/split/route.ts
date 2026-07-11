import { NextResponse } from "next/server";
import {
  getDocument,
  getDocumentChunk,
  listDocumentChunks,
  replaceDocumentChunks,
  requireAdmin,
  updateDocument
} from "@/lib/db";
import { createDocumentContentVersion, prepareDocumentContentMutation } from "@/lib/document-content-mutation";
import { appendChunkGovernanceAudit, buildChunkGovernanceState } from "@/lib/knowledge-governance-audit";
import { queueQaRetestsForGovernance } from "@/lib/knowledge-governance-retest-queue";
import { estimateTokensFromText } from "@/lib/model-usage";
import type { DocumentChunk } from "@/lib/types";

export async function POST(request: Request, { params }: { params: Promise<{ id: string; chunkId: string }> }) {
  try {
    const user = await requireAdmin();
    const { id, chunkId } = await params;
    const document = await getDocument(id);
    const targetChunk = await getDocumentChunk(chunkId);

    if (!document || !targetChunk || targetChunk.document_id !== id) {
      return NextResponse.json({ error: "分片不存在" }, { status: 404 });
    }

    const body = await request.json().catch(() => ({})) as { parts?: unknown };
    const parts = cleanParts(body.parts);

    if (parts.length < 2) {
      return NextResponse.json({ error: "请至少保留两个非空拆分片段" }, { status: 400 });
    }

    const chunks = await getOrderedDocumentChunks(id);
    const targetIndex = chunks.findIndex((chunk) => chunk.id === chunkId);

    if (targetIndex === -1) {
      return NextResponse.json({ error: "分片不存在" }, { status: 404 });
    }

    const editableDocument = await prepareDocumentContentMutation({
      document,
      actor: user,
      reason: `拆分分片 #${targetChunk.chunk_index + 1}`
    });
    const now = new Date().toISOString();
    const nextChunks = reindexChunks([
      ...chunks.slice(0, targetIndex),
      ...parts.map((content, partIndex) => {
        const tokenEstimate = estimateTokensFromText(content);
        const baseMetadata: DocumentChunk["metadata"] = {
          ...targetChunk.metadata,
          governance_updated_at: now,
          governance_updated_by: user.id,
          governance_action: "split",
          split_from_chunk_id: targetChunk.id,
          section: targetChunk.metadata.section
            ? `${targetChunk.metadata.section} · 拆分 ${partIndex + 1}`
            : targetChunk.metadata.section
        };
        const draftChunk = {
          document_id: document.id,
          knowledge_base_id: document.knowledge_base_id,
          chunk_index: targetChunk.chunk_index + partIndex,
          content,
          token_estimate: tokenEstimate,
          metadata: baseMetadata
        };

        return {
          ...draftChunk,
          metadata: appendChunkGovernanceAudit(baseMetadata, {
            action: "split",
            actor: user,
            createdAt: now,
            note: `拆分分片为 ${parts.length} 段：第 ${partIndex + 1} 段`,
            before: buildChunkGovernanceState(targetChunk),
            after: buildChunkGovernanceState(draftChunk, baseMetadata, { related_chunk_ids: [targetChunk.id] })
          })
        };
      }),
      ...chunks.slice(targetIndex + 1)
    ]);

    const replaced = await replaceDocumentChunks(document.id, nextChunks);
    const updatedDocument = await updateDocument(editableDocument.id, { title: editableDocument.title });
    const version = await createDocumentContentVersion({
      document: updatedDocument,
      chunks: replaced,
      actor: user,
      changeNote: `分片治理：拆分 #${targetChunk.chunk_index + 1}`
    });
    const retestQueue = await queueQaRetestsForGovernance({
      knowledgeBaseIds: [document.knowledge_base_id],
      createdBy: user.id,
      reason: `拆分分片：${document.title} #${targetChunk.chunk_index + 1}`,
      limit: 20
    });

    return NextResponse.json({
      chunks: replaced,
      total_chunks: replaced.length,
      document: updatedDocument,
      version,
      retest_queue: retestQueue
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "拆分分片失败" },
      { status: 400 }
    );
  }
}

async function getOrderedDocumentChunks(documentId: string) {
  return (await listDocumentChunks(documentId))
    .sort((a, b) => a.chunk_index - b.chunk_index);
}

function reindexChunks(chunks: Array<Omit<DocumentChunk, "id" | "created_at">>) {
  return chunks.map((chunk, index) => ({
    ...chunk,
    chunk_index: index
  }));
}

function cleanParts(value: unknown) {
  const parts = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/\n-{3,}\n/)
      : [];

  return parts
    .map((part) => String(part ?? "").trim())
    .filter(Boolean)
    .slice(0, 12);
}
