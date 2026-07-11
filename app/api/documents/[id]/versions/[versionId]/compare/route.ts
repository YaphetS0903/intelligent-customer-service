import { NextResponse } from "next/server";
import { getDocument, listDocumentChunks, listDocumentVersionChunks, listDocumentVersions, requireAdmin } from "@/lib/db";
import type { DocumentChunk, DocumentVersion, DocumentVersionChunk } from "@/lib/types";

type RouteContext = {
  params: Promise<{ id: string; versionId: string }>;
};

type CompareStatus = "same" | "changed" | "added" | "removed";

export async function GET(request: Request, { params }: RouteContext) {
  try {
    await requireAdmin();
    const { id, versionId } = await params;
    const document = await getDocument(id);

    if (!document) {
      return NextResponse.json({ error: "文档不存在" }, { status: 404 });
    }

    const version = (await listDocumentVersions()).find((item) => item.id === versionId);

    if (!version || version.document_id !== document.id) {
      return NextResponse.json({ error: "版本记录不存在或不属于当前资料" }, { status: 404 });
    }

    const url = new URL(request.url);
    const limit = clampNumber(url.searchParams.get("limit"), 40, 1, 120);
    const offset = clampNumber(url.searchParams.get("offset"), 0, 0, Number.MAX_SAFE_INTEGER);
    const [currentChunks, versionChunks] = await Promise.all([
      listDocumentChunks(document.id),
      listDocumentVersionChunks(version.id)
    ]);
    const current = currentChunks.sort((a, b) => a.chunk_index - b.chunk_index);
    const snapshot = versionChunks.sort((a, b) => a.chunk_index - b.chunk_index);
    const comparison = compareChunks({ current, snapshot });
    const changedItems = comparison.items.filter((item) => item.status !== "same");
    const itemsForDisplay = changedItems.length > 0 ? changedItems : comparison.items;
    const pageItems = itemsForDisplay.slice(offset, offset + limit);

    return NextResponse.json({
      document,
      version,
      summary: comparison.summary,
      snapshot_available: snapshot.length > 0,
      total_items: itemsForDisplay.length,
      diff_limit: limit,
      diff_offset: offset,
      has_previous: offset > 0,
      has_next: offset + pageItems.length < itemsForDisplay.length,
      showing_only_changes: changedItems.length > 0,
      items: pageItems
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "读取版本对比失败" },
      { status: 400 }
    );
  }
}

function compareChunks(input: {
  current: DocumentChunk[];
  snapshot: DocumentVersionChunk[];
}) {
  const currentByIndex = new Map(input.current.map((chunk) => [chunk.chunk_index, chunk]));
  const snapshotByIndex = new Map(input.snapshot.map((chunk) => [chunk.chunk_index, chunk]));
  const indexes = [...new Set([...currentByIndex.keys(), ...snapshotByIndex.keys()])].sort((a, b) => a - b);
  const summary = {
    current_chunks: input.current.length,
    version_chunks: input.snapshot.length,
    same: 0,
    changed: 0,
    added: 0,
    removed: 0,
    current_tokens: input.current.reduce((sum, chunk) => sum + chunk.token_estimate, 0),
    version_tokens: input.snapshot.reduce((sum, chunk) => sum + chunk.token_estimate, 0)
  };
  const items = indexes.map((index) => {
    const before = snapshotByIndex.get(index) ?? null;
    const after = currentByIndex.get(index) ?? null;
    const status = compareStatus(before, after);
    summary[status] += 1;

    return {
      chunk_index: index,
      status,
      before: before ? compareChunkPayload(before) : null,
      after: after ? compareChunkPayload(after) : null
    };
  });

  return { summary, items };
}

function compareStatus(before: DocumentVersionChunk | null, after: DocumentChunk | null): CompareStatus {
  if (!before && after) {
    return "added";
  }

  if (before && !after) {
    return "removed";
  }

  if (before && after && normalizeContent(before.content) !== normalizeContent(after.content)) {
    return "changed";
  }

  return "same";
}

function compareChunkPayload(chunk: DocumentChunk | DocumentVersionChunk) {
  return {
    content: truncateText(chunk.content, 900),
    token_estimate: chunk.token_estimate,
    metadata: chunk.metadata
  };
}

function normalizeContent(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function truncateText(value: string, maxLength: number) {
  const normalized = value.trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}…` : normalized;
}

function clampNumber(value: string | null, fallback: number, min: number, max: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(Math.max(parsed, min), max);
}
