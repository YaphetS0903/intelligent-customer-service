import { NextResponse } from "next/server";
import {
  getCurrentUser,
  getDocument,
  listDocumentVersionChunks,
  listDocumentVersions
} from "@/lib/db";
import { canPublishDocument, canReviewDocument } from "@/lib/document-approval";
import type { DocumentVersionChunk } from "@/lib/types";

type RouteContext = { params: Promise<{ id: string }> };
type DiffStatus = "same" | "changed" | "added" | "removed";

export async function GET(request: Request, { params }: RouteContext) {
  try {
    const user = await getCurrentUser();
    const { id } = await params;
    const document = await getDocument(id);
    if (!document) return NextResponse.json({ error: "文档不存在" }, { status: 404 });
    const allowed = user.role === "admin" || document.created_by === user.id ||
      await canReviewDocument(user, document) || await canPublishDocument(user, document);
    if (!allowed) return NextResponse.json({ error: "无权查看该资料的发布差异" }, { status: 403 });

    const targetVersionId = new URL(request.url).searchParams.get("version_id") ?? "";
    const versions = (await listDocumentVersions()).filter((version) => version.document_id === document.id);
    const targetVersion = versions.find((version) => version.id === targetVersionId);
    if (!targetVersion) return NextResponse.json({ error: "待发布版本不存在" }, { status: 404 });
    const publishedVersion = document.published_version_id
      ? versions.find((version) => version.id === document.published_version_id) ?? null
      : null;
    const [targetChunks, publishedChunks] = await Promise.all([
      listDocumentVersionChunks(targetVersion.id),
      publishedVersion ? listDocumentVersionChunks(publishedVersion.id) : Promise.resolve([])
    ]);
    const comparison = compareReleaseChunks(publishedChunks, targetChunks);

    return NextResponse.json({
      document,
      target_version: targetVersion,
      published_version: publishedVersion,
      snapshot_available: targetChunks.length > 0,
      summary: comparison.summary,
      items: comparison.items.filter((item) => item.status !== "same").slice(0, 12)
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "读取发布差异失败" },
      { status: 400 }
    );
  }
}

function compareReleaseChunks(before: DocumentVersionChunk[], after: DocumentVersionChunk[]) {
  const beforeByIndex = new Map(before.map((chunk) => [chunk.chunk_index, chunk]));
  const afterByIndex = new Map(after.map((chunk) => [chunk.chunk_index, chunk]));
  const indexes = [...new Set([...beforeByIndex.keys(), ...afterByIndex.keys()])].sort((a, b) => a - b);
  const summary = { same: 0, changed: 0, added: 0, removed: 0, before_chunks: before.length, after_chunks: after.length };
  const items = indexes.map((index) => {
    const beforeChunk = beforeByIndex.get(index) ?? null;
    const afterChunk = afterByIndex.get(index) ?? null;
    const status = diffStatus(beforeChunk, afterChunk);
    summary[status] += 1;
    return {
      chunk_index: index,
      status,
      before: beforeChunk ? beforeChunk.content.slice(0, 360) : null,
      after: afterChunk ? afterChunk.content.slice(0, 360) : null
    };
  });
  return { summary, items };
}

function diffStatus(before: DocumentVersionChunk | null, after: DocumentVersionChunk | null): DiffStatus {
  if (!before && after) return "added";
  if (before && !after) return "removed";
  if (before && after && normalize(before.content) !== normalize(after.content)) return "changed";
  return "same";
}

function normalize(value: string) {
  return value.replace(/\s+/g, " ").trim();
}
