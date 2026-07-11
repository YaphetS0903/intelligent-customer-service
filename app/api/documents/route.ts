import { NextResponse } from "next/server";
import { env, hasOcrConfig, isLocalTextRag } from "@/lib/config";
import {
  listDocumentChunkDiagnosticStats,
  listDocumentPermissionTemplates,
  listDocuments,
  listUsers,
  requireAdmin
} from "@/lib/db";
import { ensureDocumentVersionBackfill } from "@/lib/document-versioning";
import { listDocumentProcessingJobSnapshots } from "@/lib/document-processing-job";
import type { DocumentChunkDiagnosticStats, DocumentRecord, DocumentVersion } from "@/lib/types";

const staleProcessingThresholdMs = 15 * 60 * 1000;

export async function GET() {
  try {
    await requireAdmin();
    const documents = await listDocuments();
    const [documentVersions, chunkStats, permissionTemplates, users] = await Promise.all([
      ensureDocumentVersionBackfill(documents),
      listDocumentChunkDiagnosticStats(),
      listDocumentPermissionTemplates(),
      listUsers()
    ]);
    const documentIds = new Set(documents.map((document) => document.id));

    return NextResponse.json({
      documents,
      documentVersions,
      permissionTemplates,
      users,
      documentDiagnostics: buildDocumentDiagnostics(documents, documentVersions, chunkStats),
      documentProcessingJobs: Object.fromEntries(
        Object.entries(listDocumentProcessingJobSnapshots()).filter(([documentId]) => documentIds.has(documentId))
      ),
      ocrStatus: {
        configured: hasOcrConfig(),
        provider: env.ocrProvider,
        model: env.ocrModel,
        request_format: env.ocrRequestFormat,
        local_text: isLocalTextRag()
      }
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "无权访问" },
      { status: 403 }
    );
  }
}

function buildDocumentDiagnostics(
  documents: DocumentRecord[],
  versions: DocumentVersion[],
  chunkStats: DocumentChunkDiagnosticStats[]
) {
  const now = Date.now();
  const statsByDocument = new Map(chunkStats.map((stats) => [stats.document_id, stats]));
  const versionsByDocument = groupVersionsByDocument(versions);

  return Object.fromEntries(
    documents.map((document) => {
      const stats = statsByDocument.get(document.id);
      const parsers = stats?.parsers ?? [];
      const documentVersions = versionsByDocument.get(document.id) ?? [];
      const failedVersion = documentVersions.find((version) => version.status === "failed");
      const latestVersion = documentVersions[0];
      const updatedAtMs = new Date(document.updated_at).getTime();
      const processingAgeMs = Number.isFinite(updatedAtMs) ? now - updatedAtMs : null;
      const isProcessing = document.status === "uploading" || document.status === "processing";
      const isStaleProcessing = Boolean(
        isProcessing &&
        processingAgeMs !== null &&
        processingAgeMs > staleProcessingThresholdMs
      );

      return [
        document.id,
        {
          chunk_count: stats?.chunk_count ?? 0,
          total_tokens: stats?.total_tokens ?? 0,
          average_tokens: stats?.average_tokens ?? 0,
          min_tokens: stats?.min_tokens ?? 0,
          max_tokens: stats?.max_tokens ?? 0,
          empty_chunks: stats?.empty_chunks ?? 0,
          short_chunks: stats?.short_chunks ?? 0,
          long_chunks: stats?.long_chunks ?? 0,
          noisy_chunks: stats?.noisy_chunks ?? 0,
          quality_score: document.status === "ready" ? documentChunkQualityScore(stats) : 0,
          quality_warnings: document.status === "ready" ? documentChunkQualityWarnings(stats) : [],
          parser_summary: parsers.map(parserLabel).join("、") || null,
          parsers,
          page_count: stats?.page_count ?? 0,
          ocr_used: parsers.some((parser) => parser.includes("ocr")),
          ocr_applicable: isOcrApplicable(document),
          can_reprocess: Boolean(document.storage_path),
          last_error: normalizeFailureReason(failedVersion?.change_note ?? null),
          last_version_note: latestVersion?.change_note ?? null,
          last_processed_at: latestVersion?.created_at ?? document.updated_at,
          processing_age_ms: isProcessing ? Math.max(0, processingAgeMs ?? 0) : null,
          is_stale_processing: isStaleProcessing
        }
      ];
    })
  );
}

function documentChunkQualityScore(stats: DocumentChunkDiagnosticStats | undefined) {
  if (!stats || stats.chunk_count === 0) {
    return 35;
  }

  const issueCount = Math.min(
    stats.chunk_count,
    stats.empty_chunks + stats.short_chunks + stats.long_chunks + stats.noisy_chunks
  );
  const issuePenalty = Math.round((issueCount / stats.chunk_count) * 70);
  const lengthPenalty =
    (stats.average_tokens > 0 && stats.average_tokens < 60 ? 10 : 0) +
    (stats.max_tokens > 1500 ? 10 : 0);

  return Math.max(0, Math.min(100, 100 - issuePenalty - lengthPenalty));
}

function documentChunkQualityWarnings(stats: DocumentChunkDiagnosticStats | undefined) {
  if (!stats || stats.chunk_count === 0) {
    return ["已就绪但没有可检索分片"];
  }

  const warnings: string[] = [];

  if (stats.empty_chunks > 0) {
    warnings.push(`${stats.empty_chunks} 个空分片`);
  }

  if (stats.short_chunks > 0) {
    warnings.push(`${stats.short_chunks} 个过短分片`);
  }

  if (stats.long_chunks > 0) {
    warnings.push(`${stats.long_chunks} 个超长分片`);
  }

  if (stats.noisy_chunks > 0) {
    warnings.push(`${stats.noisy_chunks} 个疑似 OCR 噪声分片`);
  }

  if (stats.average_tokens > 0 && stats.average_tokens < 60) {
    warnings.push("平均分片偏短");
  }

  if (stats.max_tokens > 1500) {
    warnings.push("最大分片偏长");
  }

  return warnings;
}

function groupVersionsByDocument(versions: DocumentVersion[]) {
  const versionsByDocument = new Map<string, DocumentVersion[]>();

  for (const version of versions) {
    if (!version.document_id) {
      continue;
    }

    versionsByDocument.set(version.document_id, [
      ...(versionsByDocument.get(version.document_id) ?? []),
      version
    ]);
  }

  for (const documentVersions of versionsByDocument.values()) {
    documentVersions.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }

  return versionsByDocument;
}

function parserLabel(parser: string) {
  const labels: Record<string, string> = {
    pdf_text: "PDF 文本",
    pdf_ocr: "PDF OCR",
    ocr: "OCR",
    pptx: "PPTX",
    excel: "Excel",
    docx: "DOCX",
    text: "文本"
  };

  return labels[parser] ?? parser;
}

function normalizeFailureReason(note: string | null) {
  return note
    ?.replace(/^解析失败[:：]\s*/, "")
    .replace(/^重新识别失败[:：]\s*/, "")
    .trim() || null;
}

function isOcrApplicable(document: DocumentRecord) {
  const lowerName = document.file_name.toLowerCase();
  return document.file_type === "application/pdf" ||
    document.file_type.startsWith("image/") ||
    /\.(pdf|png|jpe?g|webp|bmp|tiff?)$/i.test(lowerName);
}
