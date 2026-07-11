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

    const body = await request.json().catch(() => ({})) as { direction?: unknown };
    const direction = body.direction === "previous" ? "previous" : "next";
    const chunks = await getOrderedDocumentChunks(id);
    const targetIndex = chunks.findIndex((chunk) => chunk.id === chunkId);
    const neighborIndex = direction === "previous" ? targetIndex - 1 : targetIndex + 1;

    if (targetIndex === -1 || neighborIndex < 0 || neighborIndex >= chunks.length) {
      return NextResponse.json({ error: direction === "previous" ? "前面没有可合并分片" : "后面没有可合并分片" }, { status: 400 });
    }

    const first = direction === "previous" ? chunks[neighborIndex] : chunks[targetIndex];
    const second = direction === "previous" ? chunks[targetIndex] : chunks[neighborIndex];
    const mergedContent = `${first.content.trim()}\n\n${second.content.trim()}`.trim();
    const now = new Date().toISOString();
    const mergedMetadata: DocumentChunk["metadata"] = {
      ...first.metadata,
      summary: mergeText(first.metadata.summary, second.metadata.summary),
      keywords: uniqueList([...(first.metadata.keywords ?? []), ...(second.metadata.keywords ?? [])], 24),
      synonyms: uniqueList([...(first.metadata.synonyms ?? []), ...(second.metadata.synonyms ?? [])], 36),
      governance_updated_at: now,
      governance_updated_by: user.id,
      governance_action: "merge",
      merged_from_chunk_ids: [first.id, second.id]
    };
    const mergedChunk: Omit<DocumentChunk, "id" | "created_at"> = {
      document_id: document.id,
      knowledge_base_id: document.knowledge_base_id,
      chunk_index: 0,
      content: mergedContent,
      token_estimate: estimateTokensFromText(mergedContent),
      metadata: mergedMetadata
    };
    mergedChunk.metadata = appendChunkGovernanceAudit(mergedMetadata, {
      action: "merge",
      actor: user,
      createdAt: now,
      note: `合并分片 #${first.chunk_index + 1} 与 #${second.chunk_index + 1}`,
      before: buildChunkGovernanceState(first, first.metadata, { related_chunk_ids: [first.id, second.id] }),
      after: buildChunkGovernanceState(mergedChunk, mergedMetadata, { related_chunk_ids: [first.id, second.id] })
    });

    const editableDocument = await prepareDocumentContentMutation({
      document,
      actor: user,
      reason: `合并分片 #${first.chunk_index + 1} 与 #${second.chunk_index + 1}`
    });
    const lowerIndex = Math.min(targetIndex, neighborIndex);
    const upperIndex = Math.max(targetIndex, neighborIndex);
    const nextChunks = reindexChunks([
      ...chunks.slice(0, lowerIndex),
      mergedChunk,
      ...chunks.slice(upperIndex + 1)
    ]);

    const replaced = await replaceDocumentChunks(document.id, nextChunks);
    const updatedDocument = await updateDocument(editableDocument.id, { title: editableDocument.title });
    const version = await createDocumentContentVersion({
      document: updatedDocument,
      chunks: replaced,
      actor: user,
      changeNote: `分片治理：合并 #${first.chunk_index + 1} 与 #${second.chunk_index + 1}`
    });
    const retestQueue = await queueQaRetestsForGovernance({
      knowledgeBaseIds: [document.knowledge_base_id],
      createdBy: user.id,
      reason: `合并分片：${document.title} #${first.chunk_index + 1} 与 #${second.chunk_index + 1}`,
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
      { error: error instanceof Error ? error.message : "合并分片失败" },
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

function uniqueList(items: string[], maxItems: number) {
  const result: string[] = [];
  const seen = new Set<string>();

  for (const item of items) {
    const value = item.trim();
    const key = value.toLowerCase();

    if (!value || seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(value);

    if (result.length >= maxItems) {
      break;
    }
  }

  return result;
}

function mergeText(first: string | undefined, second: string | undefined) {
  return [first, second].map((item) => item?.trim()).filter(Boolean).join("；") || undefined;
}
