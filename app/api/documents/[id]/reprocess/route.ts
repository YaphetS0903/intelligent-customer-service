import { NextResponse } from "next/server";
import { isLocalTextRag } from "@/lib/config";
import { getDocument, requireAdmin, updateDocument } from "@/lib/db";
import { prepareDocumentContentMutation } from "@/lib/document-content-mutation";
import { startDocumentProcessingJob } from "@/lib/document-processing-job";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireAdmin();
    const { id } = await params;
    const document = await getDocument(id);

    if (!document) {
      return NextResponse.json({ error: "文档不存在" }, { status: 404 });
    }

    if (!isLocalTextRag()) {
      return NextResponse.json({ error: "当前不是 local_text 模式，请使用刷新状态同步 Vector Store 处理结果。" }, { status: 400 });
    }

    if (!document.storage_path) {
      return NextResponse.json({ error: "当前资料没有保留原文件，无法重新识别。请重新上传原文件。" }, { status: 400 });
    }

    const editableDocument = await prepareDocumentContentMutation({
      document,
      actor: user,
      reason: "重新识别并刷新可检索文本"
    });
    const processingDocument = await updateDocument(editableDocument.id, { status: "processing" });
    startDocumentProcessingJob({
      documentId: document.id,
      createdBy: user.id,
      changeNote: "重新识别并刷新可检索文本",
      reason: "reprocess"
    });

    return NextResponse.json(
      {
        document: processingDocument,
        status: "processing",
        message: "资料已进入后台重新识别队列，可刷新页面查看状态。"
      },
      { status: 202 }
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "重新识别失败" },
      { status: 400 }
    );
  }
}
