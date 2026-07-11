import { NextResponse } from "next/server";
import {
  getDocument,
  getDocumentChunk,
  listDocumentChunks,
  requireAdmin,
  updateDocument,
  updateDocumentChunk
} from "@/lib/db";
import { createDocumentContentVersion, prepareDocumentContentMutation } from "@/lib/document-content-mutation";
import { appendChunkGovernanceAudit, buildChunkGovernanceState } from "@/lib/knowledge-governance-audit";
import { queueQaRetestsForGovernance } from "@/lib/knowledge-governance-retest-queue";
import { estimateTokensFromText } from "@/lib/model-usage";
import type { DocumentChunk } from "@/lib/types";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string; chunkId: string }> }) {
  try {
    const user = await requireAdmin();
    const { id, chunkId } = await params;
    const document = await getDocument(id);
    const chunk = await getDocumentChunk(chunkId);

    if (!document || !chunk || chunk.document_id !== id) {
      return NextResponse.json({ error: "分片不存在" }, { status: 404 });
    }

    const body = await request.json().catch(() => ({})) as {
      summary?: unknown;
      keywords?: unknown;
      synonyms?: unknown;
      content?: unknown;
    };
    const nextContent = typeof body.content === "string" ? body.content.trim() : chunk.content;

    if (!nextContent) {
      return NextResponse.json({ error: "分片内容不能为空" }, { status: 400 });
    }

    const editableDocument = await prepareDocumentContentMutation({
      document,
      actor: user,
      reason: `手动治理分片 #${chunk.chunk_index + 1}`
    });

    const nextTokenEstimate = estimateTokensFromText(nextContent);
    const updatedAt = new Date().toISOString();
    let metadata: DocumentChunk["metadata"] = {
      ...chunk.metadata,
      governance_updated_at: updatedAt,
      governance_updated_by: user.id,
      governance_action: "metadata_update"
    };
    delete metadata.pending_suggestion;
    const summary = cleanOptionalText(body.summary, 600);
    const keywords = cleanList(body.keywords, 24, 36);
    const synonyms = cleanList(body.synonyms, 36, 36);

    if (summary) {
      metadata.summary = summary;
    } else {
      delete metadata.summary;
    }

    if (keywords.length > 0) {
      metadata.keywords = keywords;
    } else {
      delete metadata.keywords;
    }

    if (synonyms.length > 0) {
      metadata.synonyms = synonyms;
    } else {
      delete metadata.synonyms;
    }

    metadata = appendChunkGovernanceAudit(metadata, {
      action: "metadata_update",
      actor: user,
      createdAt: updatedAt,
      note: "手动保存分片治理信息",
      before: buildChunkGovernanceState(chunk),
      after: buildChunkGovernanceState(
        {
          ...chunk,
          content: nextContent,
          token_estimate: nextTokenEstimate,
          metadata
        },
        metadata
      )
    });

    const updated = await updateDocumentChunk(chunk.id, {
      content: nextContent,
      token_estimate: nextTokenEstimate,
      metadata
    });

    const updatedDocument = await updateDocument(editableDocument.id, { title: editableDocument.title });
    const version = await createDocumentContentVersion({
      document: updatedDocument,
      chunks: await listDocumentChunks(updatedDocument.id),
      actor: user,
      changeNote: `分片治理：更新 #${chunk.chunk_index + 1}`
    });
    const retestQueue = await queueQaRetestsForGovernance({
      knowledgeBaseIds: [document.knowledge_base_id],
      createdBy: user.id,
      reason: `手动治理分片：${document.title} #${chunk.chunk_index + 1}`,
      limit: 20
    });

    return NextResponse.json({ document: updatedDocument, chunk: updated, version, retest_queue: retestQueue });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "保存分片治理信息失败" },
      { status: 400 }
    );
  }
}

function cleanOptionalText(value: unknown, maxLength: number) {
  if (typeof value !== "string") {
    return "";
  }

  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function cleanList(value: unknown, maxItems: number, maxLength: number) {
  const rawItems = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[,，、\n]/)
      : [];
  const result: string[] = [];
  const seen = new Set<string>();

  for (const rawItem of rawItems) {
    const item = String(rawItem ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
    const key = item.toLowerCase();

    if (!item || seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(item);

    if (result.length >= maxItems) {
      break;
    }
  }

  return result;
}
