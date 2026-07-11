import { NextResponse } from "next/server";
import { getDocument, requireAdmin } from "@/lib/db";
import { readDocumentSourceFile } from "@/lib/document-storage";
import { renderDocumentPageImage } from "@/lib/document-page-image";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string; page: string }> }) {
  try {
    await requireAdmin();
    const { id, page } = await params;
    const pageNumber = Number.parseInt(page, 10);
    const document = await getDocument(id);

    if (!document) {
      return NextResponse.json({ error: "资料不存在" }, { status: 404 });
    }

    const file = await readDocumentSourceFile(document);
    const rendered = await renderDocumentPageImage(file, pageNumber);

    return new Response(toArrayBuffer(rendered.image), {
      headers: {
        "Content-Type": rendered.contentType,
        "Cache-Control": "private, max-age=3600"
      }
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "读取源图预览失败" },
      { status: 400 }
    );
  }
}

function toArrayBuffer(buffer: Buffer) {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
}
