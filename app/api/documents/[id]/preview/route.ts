import { NextResponse } from "next/server";
import { getDocument, listDocumentChunks, requireAdmin } from "@/lib/db";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin();
    const { id } = await params;
    const document = await getDocument(id);

    if (!document) {
      return NextResponse.json({ error: "文档不存在" }, { status: 404 });
    }

    const url = new URL(request.url);
    const limit = clampNumber(url.searchParams.get("limit"), 120, 1, 300);
    let offset = clampNumber(url.searchParams.get("offset"), 0, 0, Number.MAX_SAFE_INTEGER);
    const targetChunkId = url.searchParams.get("chunk");
    const chunks = (await listDocumentChunks(id))
      .sort((a, b) => a.chunk_index - b.chunk_index);

    if (targetChunkId) {
      const targetIndex = chunks.findIndex((chunk) => chunk.id === targetChunkId);
      if (targetIndex >= 0) {
        offset = Math.floor(targetIndex / limit) * limit;
      }
    }

    const previewChunks = chunks.slice(offset, offset + limit);

    return NextResponse.json({
      document,
      total_chunks: chunks.length,
      preview_limit: limit,
      preview_offset: offset,
      preview_count: previewChunks.length,
      has_previous: offset > 0,
      has_next: offset + previewChunks.length < chunks.length,
      truncated: offset > 0 || offset + previewChunks.length < chunks.length,
      target_chunk_id: targetChunkId,
      target_chunk_found: targetChunkId ? previewChunks.some((chunk) => chunk.id === targetChunkId) : undefined,
      chunks: previewChunks.map((chunk) => ({
        ...chunk,
        content: chunk.content.length > 4000 ? `${chunk.content.slice(0, 4000)}...` : chunk.content
      }))
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "读取识别预览失败" },
      { status: 400 }
    );
  }
}

function clampNumber(value: string | null, fallback: number, min: number, max: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(Math.max(parsed, min), max);
}
