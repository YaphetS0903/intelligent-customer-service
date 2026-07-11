import {
  createDocumentVersion,
  getDocument,
  replaceDocumentChunks,
  updateDocument
} from "@/lib/db";
import { chunkExtractedText, extractTextFromFile, type ExtractTextProgress } from "@/lib/document-text";
import { readDocumentSourceFile } from "@/lib/document-storage";
import type { DocumentProcessingJobSnapshot, DocumentProcessingStage } from "@/lib/types";

declare global {
  // eslint-disable-next-line no-var
  var __documentProcessingRunningJobs: Set<string> | undefined;
  // eslint-disable-next-line no-var
  var __documentProcessingJobSnapshots: Map<string, DocumentProcessingJobSnapshot> | undefined;
}

const runningJobs = globalThis.__documentProcessingRunningJobs ?? new Set<string>();
globalThis.__documentProcessingRunningJobs = runningJobs;
const jobSnapshots = globalThis.__documentProcessingJobSnapshots ?? new Map<string, DocumentProcessingJobSnapshot>();
globalThis.__documentProcessingJobSnapshots = jobSnapshots;
const jobSnapshotTtlMs = 30 * 60 * 1000;

export function startDocumentProcessingJob(input: {
  documentId: string;
  createdBy: string | null;
  changeNote?: string | null;
  reason: "upload" | "reprocess";
}) {
  if (runningJobs.has(input.documentId)) {
    return;
  }

  updateJobSnapshot(input.documentId, {
    reason: input.reason,
    stage: "queued",
    message: input.reason === "reprocess" ? "资料已进入重新识别队列" : "资料已进入后台解析队列"
  });
  runningJobs.add(input.documentId);
  void runDocumentProcessingJob(input)
    .catch((error) => {
      console.error("[document-processing-job]", error);
    })
    .finally(() => {
      runningJobs.delete(input.documentId);
    });
}

export function listDocumentProcessingJobSnapshots() {
  pruneJobSnapshots();
  return Object.fromEntries(jobSnapshots.entries());
}

async function runDocumentProcessingJob(input: {
  documentId: string;
  createdBy: string | null;
  changeNote?: string | null;
  reason: "upload" | "reprocess";
}) {
  const document = await getDocument(input.documentId);
  if (!document) {
    updateJobSnapshot(input.documentId, {
      reason: input.reason,
      stage: "failed",
      message: "资料不存在，后台处理已停止",
      error: "资料不存在"
    });
    return;
  }

  updateJobSnapshot(document.id, {
    reason: input.reason,
    stage: "reading_source",
    message: "正在读取原始文件"
  });
  await updateDocument(document.id, { status: "processing" });

  try {
    const file = await readDocumentSourceFile(document);
    const extracted = await extractTextFromFile(file, {
      onProgress: (progress) => {
        updateJobSnapshot(document.id, mapExtractProgress(input.reason, progress));
      }
    });
    updateJobSnapshot(document.id, {
      reason: input.reason,
      stage: "chunking",
      message: "正在生成知识分片"
    });
    const chunks = chunkExtractedText({
      documentId: document.id,
      knowledgeBaseId: document.knowledge_base_id,
      fileName: document.file_name,
      title: document.title,
      extracted
    });

    if (chunks.length === 0) {
      throw new Error("未能从文件中解析到可入库文字");
    }

    updateJobSnapshot(document.id, {
      reason: input.reason,
      stage: "saving",
      message: `正在保存 ${chunks.length} 个知识分片`,
      chunks_created: chunks.length
    });
    const createdChunks = await replaceDocumentChunks(document.id, chunks);
    const readyDocument = await updateDocument(document.id, { status: "ready" });
    await createDocumentVersion({
      document_id: readyDocument.id,
      knowledge_base_id: readyDocument.knowledge_base_id,
      title: readyDocument.title,
      file_name: readyDocument.file_name,
      file_type: readyDocument.file_type,
      status: readyDocument.status,
      change_note: input.changeNote || defaultSuccessNote(input.reason),
      created_by: input.createdBy,
      snapshot_chunks: createdChunks
    });
    updateJobSnapshot(document.id, {
      reason: input.reason,
      stage: "ready",
      message: `资料解析完成，生成 ${createdChunks.length} 个知识分片`,
      chunks_created: createdChunks.length
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "资料处理失败";
    const failedDocument = await updateDocument(document.id, { status: "failed" });
    await createDocumentVersion({
      document_id: failedDocument.id,
      knowledge_base_id: failedDocument.knowledge_base_id,
      title: failedDocument.title,
      file_name: failedDocument.file_name,
      file_type: failedDocument.file_type,
      status: failedDocument.status,
      change_note: `${input.reason === "reprocess" ? "重新识别失败" : "解析失败"}：${errorMessage}`,
      created_by: input.createdBy
    });
    updateJobSnapshot(document.id, {
      reason: input.reason,
      stage: "failed",
      message: input.reason === "reprocess" ? "重新识别失败" : "资料解析失败",
      error: errorMessage
    });
  }
}

function updateJobSnapshot(
  documentId: string,
  input: {
    reason: "upload" | "reprocess";
    stage: DocumentProcessingStage;
    message: string;
    pages_total?: number | null;
    pages_done?: number | null;
    chunks_created?: number | null;
    error?: string | null;
  }
) {
  const now = new Date().toISOString();
  const current = jobSnapshots.get(documentId);
  jobSnapshots.set(documentId, {
    document_id: documentId,
    reason: input.reason,
    stage: input.stage,
    message: input.message,
    pages_total: input.pages_total ?? current?.pages_total ?? null,
    pages_done: input.pages_done ?? current?.pages_done ?? null,
    chunks_created: input.chunks_created ?? current?.chunks_created ?? null,
    error: input.error ?? null,
    started_at: current?.started_at ?? now,
    updated_at: now,
    finished_at: input.stage === "ready" || input.stage === "failed" ? now : null
  });
}

function mapExtractProgress(reason: "upload" | "reprocess", progress: ExtractTextProgress) {
  const stage: DocumentProcessingStage =
    progress.stage === "pdf_text"
      ? "pdf_text"
      : progress.stage === "pdf_render"
        ? "pdf_render"
        : progress.stage === "ocr"
          ? "ocr"
          : "chunking";

  return {
    reason,
    stage,
    message: progress.message,
    pages_total: progress.pages_total ?? null,
    pages_done: progress.pages_done ?? null
  };
}

function pruneJobSnapshots() {
  const now = Date.now();

  for (const [documentId, snapshot] of jobSnapshots) {
    const finishedAt = snapshot.finished_at ? new Date(snapshot.finished_at).getTime() : null;
    if (finishedAt && Number.isFinite(finishedAt) && now - finishedAt > jobSnapshotTtlMs) {
      jobSnapshots.delete(documentId);
    }
  }
}

function defaultSuccessNote(reason: "upload" | "reprocess") {
  return reason === "reprocess"
    ? "后台重新识别完成并刷新可检索文本"
    : "后台解析完成并生成可检索文本";
}
