import { NextResponse } from "next/server";
import {
  getDocument,
  getDocumentChunk,
  listDocumentChunks,
  listDocumentChunkPendingSuggestionSources,
  requireAdmin,
  updateDocumentChunk
} from "@/lib/db";
import {
  assertDocumentContentMutationAllowed,
  createDocumentContentVersion,
  prepareDocumentContentMutation
} from "@/lib/document-content-mutation";
import {
  appendChunkGovernanceAudit,
  buildChunkGovernanceState,
  normalizeSuggestionSnapshot
} from "@/lib/knowledge-governance-audit";
import { queueQaRetestsForGovernance } from "@/lib/knowledge-governance-retest-queue";
import type { DocumentChunk, DocumentRecord } from "@/lib/types";

const maxListLimit = 300;
const maxBatchSize = 100;

export async function GET(request: Request) {
  try {
    await requireAdmin();
    const url = new URL(request.url);
    const knowledgeBaseId = url.searchParams.get("knowledge_base_id")?.trim() ?? "";
    const limit = normalizeLimit(url.searchParams.get("limit"));
    const chunks = await listDocumentChunkPendingSuggestionSources({
      knowledgeBaseId: knowledgeBaseId || undefined,
      limit
    });

    const suggestions = chunks
      .filter((chunk) => Boolean(chunk.metadata.pending_suggestion))
      .map((chunk) => {
        const suggestion = chunk.metadata.pending_suggestion!;

        return {
          chunk_id: chunk.id,
          document_id: chunk.document_id,
          knowledge_base_id: chunk.knowledge_base_id,
          chunk_index: chunk.chunk_index,
          token_estimate: chunk.token_estimate,
          content_preview: chunk.content_preview,
          document_title: chunk.document_title,
          file_name: chunk.file_name,
          knowledge_base_name: chunk.knowledge_base_name,
          summary: suggestion.summary,
          keywords: suggestion.keywords ?? [],
          synonyms: suggestion.synonyms ?? [],
          model: suggestion.model ?? null,
          generated_at: suggestion.generated_at ?? null,
          job_id: suggestion.job_id ?? null
        };
      })
      .sort((a, b) =>
        new Date(b.generated_at ?? 0).getTime() - new Date(a.generated_at ?? 0).getTime() ||
        a.knowledge_base_name.localeCompare(b.knowledge_base_name, "zh-CN") ||
        a.document_title.localeCompare(b.document_title, "zh-CN") ||
        a.chunk_index - b.chunk_index
      )
      .slice(0, limit);

    return NextResponse.json({ suggestions });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "读取待确认治理建议失败" },
      { status: 400 }
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const user = await requireAdmin();
    const body = await request.json().catch(() => ({})) as {
      chunk_ids?: unknown;
    };
    const chunkIds = cleanChunkIds(body.chunk_ids);

    if (chunkIds.length === 0) {
      return NextResponse.json({ error: "请选择要撤销的建议" }, { status: 400 });
    }

    const loadedChunks = await Promise.all(chunkIds.map((chunkId) => getDocumentChunk(chunkId)));
    const targetChunks = loadedChunks.filter((chunk): chunk is DocumentChunk => Boolean(chunk?.metadata.pending_suggestion));

    for (const chunk of targetChunks) {
      const suggestion = normalizeSuggestionSnapshot(chunk.metadata.pending_suggestion);
      let metadata: DocumentChunk["metadata"] = {
        ...chunk.metadata
      };
      delete metadata.pending_suggestion;
      metadata = appendChunkGovernanceAudit(metadata, {
        action: "pending_suggestion_revoke",
        actor: user,
        note: "撤销待确认 AI 治理建议",
        before: buildChunkGovernanceState(chunk),
        after: buildChunkGovernanceState(chunk, metadata),
        suggestion
      });
      await updateDocumentChunk(chunk.id, { metadata });
    }

    return NextResponse.json({
      removed: targetChunks.length,
      requested: chunkIds.length
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "撤销待确认治理建议失败" },
      { status: 400 }
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const user = await requireAdmin();
    const body = await request.json().catch(() => ({})) as {
      chunk_ids?: unknown;
    };
    const chunkIds = cleanChunkIds(body.chunk_ids);

    if (chunkIds.length === 0) {
      return NextResponse.json({ error: "请选择要保存的建议" }, { status: 400 });
    }

    const loadedChunks = await Promise.all(chunkIds.map((chunkId) => getDocumentChunk(chunkId)));
    const targetChunks = loadedChunks.filter((chunk): chunk is DocumentChunk => Boolean(chunk?.metadata.pending_suggestion));
    const documents = (await Promise.all(
      [...new Set(targetChunks.map((chunk) => chunk.document_id))].map((documentId) => getDocument(documentId))
    )).filter((document): document is DocumentRecord => Boolean(document));
    documents.forEach(assertDocumentContentMutationAllowed);
    const editableDocuments = new Map(
      (await Promise.all(documents.map(async (document) => [
        document.id,
        await prepareDocumentContentMutation({
          document,
          actor: user,
          reason: "保存 AI 分片治理建议"
        })
      ] as const))).map(([documentId, document]) => [documentId, document])
    );
    const now = new Date().toISOString();

    for (const chunk of targetChunks) {
      const suggestion = chunk.metadata.pending_suggestion!;
      const cleanSuggestion = {
        summary: cleanText(suggestion.summary, 600),
        keywords: cleanList(suggestion.keywords, 24, 36),
        synonyms: cleanList(suggestion.synonyms, 36, 36),
        model: suggestion.model ?? null,
        generated_at: suggestion.generated_at ?? null,
        job_id: suggestion.job_id ?? null
      };
      let metadata: DocumentChunk["metadata"] = {
        ...chunk.metadata,
        summary: cleanSuggestion.summary,
        keywords: cleanSuggestion.keywords,
        synonyms: cleanSuggestion.synonyms,
        governance_updated_at: now,
        governance_updated_by: user.id,
        governance_action: "pending_suggestion_apply"
      };
      delete metadata.pending_suggestion;
      metadata = appendChunkGovernanceAudit(metadata, {
        action: "pending_suggestion_apply",
        actor: user,
        createdAt: now,
        note: "保存 AI 治理建议到正式摘要、关键词和同义词",
        before: buildChunkGovernanceState(chunk),
        after: buildChunkGovernanceState(chunk, metadata),
        suggestion: cleanSuggestion
      });
      await updateDocumentChunk(chunk.id, { metadata });
    }
    const updatedChunksByDocument = new Map(await Promise.all(
      [...editableDocuments.keys()].map(async (documentId) => [documentId, await listDocumentChunks(documentId)] as const)
    ));
    const versions = await Promise.all([...editableDocuments.values()].map(async (document) =>
      createDocumentContentVersion({
        document,
        chunks: updatedChunksByDocument.get(document.id) ?? [],
        actor: user,
        changeNote: "批量保存 AI 分片治理建议"
      })
    ));
    const retestQueue = await queueQaRetestsForGovernance({
      knowledgeBaseIds: targetChunks.map((chunk) => chunk.knowledge_base_id),
      createdBy: user.id,
      reason: `批量保存 ${targetChunks.length} 条 AI 分片治理建议`,
      limit: 20
    });

    return NextResponse.json({
      applied: targetChunks.length,
      requested: chunkIds.length,
      versions,
      retest_queue: retestQueue
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "保存待确认治理建议失败" },
      { status: 400 }
    );
  }
}

function normalizeLimit(value: string | null) {
  const numeric = Number(value ?? "");
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return maxListLimit;
  }

  return Math.min(maxListLimit, Math.round(numeric));
}

function cleanChunkIds(value: unknown) {
  const source = Array.isArray(value) ? value : [];
  const seen = new Set<string>();
  const result: string[] = [];

  for (const rawItem of source) {
    const item = String(rawItem ?? "").trim();
    if (!item || seen.has(item)) {
      continue;
    }

    seen.add(item);
    result.push(item);

    if (result.length >= maxBatchSize) {
      break;
    }
  }

  return result;
}

function cleanText(value: unknown, maxLength: number) {
  if (typeof value !== "string") {
    return "";
  }

  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function cleanList(value: unknown, maxItems: number, maxLength: number) {
  const source = Array.isArray(value) ? value : [];
  const seen = new Set<string>();
  const result: string[] = [];

  for (const rawItem of source) {
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
