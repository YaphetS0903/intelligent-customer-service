import { NextResponse } from "next/server";
import { getDocument, listDocumentChunks, requireAdmin } from "@/lib/db";
import { suggestDocumentChunkMetadata } from "@/lib/chunk-metadata-suggestion";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin();
    const { id } = await params;
    const document = await getDocument(id);

    if (!document) {
      return NextResponse.json({ error: "资料不存在" }, { status: 404 });
    }

    const body = await request.json().catch(() => ({})) as {
      chunk_ids?: unknown;
      only_missing?: unknown;
    };
    const requestedIds = cleanIds(body.chunk_ids);

    if (requestedIds.length === 0) {
      return NextResponse.json({ error: "请选择要生成建议的分片" }, { status: 400 });
    }

    const requestedIdSet = new Set(requestedIds);
    const chunks = (await listDocumentChunks(id))
      .filter((chunk) => requestedIdSet.has(chunk.id))
      .sort((a, b) => requestedIds.indexOf(a.id) - requestedIds.indexOf(b.id))
      .filter((chunk) => body.only_missing ? needsMetadataSuggestion(chunk) : true)
      .slice(0, 12);

    if (chunks.length === 0) {
      return NextResponse.json({
        suggestions: [],
        skipped: requestedIds.length,
        message: "选中的分片都已有摘要、关键词和同义词。"
      });
    }

    const result = await suggestDocumentChunkMetadata(chunks);

    return NextResponse.json({
      ...result,
      requested: requestedIds.length,
      processed: chunks.length,
      skipped: Math.max(requestedIds.length - chunks.length, 0)
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "生成分片建议失败" },
      { status: 400 }
    );
  }
}

function cleanIds(value: unknown) {
  const rawItems = Array.isArray(value) ? value : [];
  const ids: string[] = [];
  const seen = new Set<string>();

  for (const rawItem of rawItems) {
    const id = String(rawItem ?? "").trim();
    if (!id || seen.has(id)) {
      continue;
    }

    seen.add(id);
    ids.push(id);

    if (ids.length >= 20) {
      break;
    }
  }

  return ids;
}

function needsMetadataSuggestion(chunk: { metadata: { summary?: string; keywords?: string[]; synonyms?: string[] } }) {
  return !chunk.metadata.summary || (chunk.metadata.keywords ?? []).length === 0 || (chunk.metadata.synonyms ?? []).length === 0;
}
