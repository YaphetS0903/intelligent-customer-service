import { randomUUID } from "crypto";
import { getKnowledgeBase, listDocumentChunkMetadata, listDocumentChunks, updateDocumentChunk } from "@/lib/db";
import {
  suggestDocumentChunkMetadata,
  type ChunkMetadataSuggestion
} from "@/lib/chunk-metadata-suggestion";
import type { DocumentChunk, DocumentChunkMetadata } from "@/lib/types";

export type ChunkMetadataSuggestionJobStatus = "queued" | "generating" | "ready" | "failed";

export type ChunkMetadataSuggestionJobSnapshot = {
  id: string;
  knowledge_base_id: string;
  status: ChunkMetadataSuggestionJobStatus;
  total_chunks: number;
  processed_chunks: number;
  suggested_chunks: number;
  failed_chunks: number;
  message: string;
  model: string | null;
  error: string | null;
  created_by: string | null;
  started_at: string;
  updated_at: string;
  finished_at: string | null;
};

export type ChunkMetadataSuggestionStats = {
  knowledge_base_id: string;
  total_chunks: number;
  missing_chunks: number;
  pending_suggestions: number;
};

declare global {
  // eslint-disable-next-line no-var
  var __chunkMetadataSuggestionRunningJobs: Set<string> | undefined;
  // eslint-disable-next-line no-var
  var __chunkMetadataSuggestionJobSnapshots: Map<string, ChunkMetadataSuggestionJobSnapshot> | undefined;
}

const runningJobs = globalThis.__chunkMetadataSuggestionRunningJobs ?? new Set<string>();
globalThis.__chunkMetadataSuggestionRunningJobs = runningJobs;
const jobSnapshots = globalThis.__chunkMetadataSuggestionJobSnapshots ?? new Map<string, ChunkMetadataSuggestionJobSnapshot>();
globalThis.__chunkMetadataSuggestionJobSnapshots = jobSnapshots;
const jobSnapshotTtlMs = 60 * 60 * 1000;
const defaultLimit = 80;
const maxLimit = 200;
const batchSize = 6;

export async function startChunkMetadataSuggestionJob(input: {
  knowledgeBaseId: string;
  createdBy: string | null;
  limit?: number;
  overwrite?: boolean;
}) {
  const knowledgeBaseId = input.knowledgeBaseId.trim();
  const knowledgeBase = await getKnowledgeBase(knowledgeBaseId);

  if (!knowledgeBase) {
    throw new Error("知识库不存在");
  }

  const existingRunning = [...jobSnapshots.values()].find(
    (job) => job.knowledge_base_id === knowledgeBaseId && (job.status === "queued" || job.status === "generating")
  );
  if (existingRunning) {
    return existingRunning;
  }

  const now = new Date().toISOString();
  const job: ChunkMetadataSuggestionJobSnapshot = {
    id: `chunkgov-${randomUUID()}`,
    knowledge_base_id: knowledgeBaseId,
    status: "queued",
    total_chunks: 0,
    processed_chunks: 0,
    suggested_chunks: 0,
    failed_chunks: 0,
    message: "全库分片治理建议已进入后台队列。",
    model: null,
    error: null,
    created_by: input.createdBy,
    started_at: now,
    updated_at: now,
    finished_at: null
  };
  jobSnapshots.set(job.id, job);

  runningJobs.add(job.id);
  void runChunkMetadataSuggestionJob({
    jobId: job.id,
    knowledgeBaseId,
    limit: normalizeLimit(input.limit),
    overwrite: Boolean(input.overwrite)
  })
    .catch((error) => {
      updateJob(job.id, {
        status: "failed",
        message: "全库分片治理建议生成失败。",
        error: error instanceof Error ? error.message : "生成失败",
        finished_at: new Date().toISOString()
      });
    })
    .finally(() => {
      runningJobs.delete(job.id);
    });

  return job;
}

export function listChunkMetadataSuggestionJobSnapshots() {
  pruneJobSnapshots();
  return [...jobSnapshots.values()].sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
}

export async function getChunkMetadataSuggestionStats(): Promise<ChunkMetadataSuggestionStats[]> {
  const chunks = await listDocumentChunkMetadata();
  const rows = new Map<string, ChunkMetadataSuggestionStats>();

  for (const chunk of chunks) {
    const row = rows.get(chunk.knowledge_base_id) ?? {
      knowledge_base_id: chunk.knowledge_base_id,
      total_chunks: 0,
      missing_chunks: 0,
      pending_suggestions: 0
    };

    row.total_chunks += 1;
    row.missing_chunks += needsMetadataSuggestionMetadata(chunk) ? 1 : 0;
    row.pending_suggestions += chunk.metadata.pending_suggestion ? 1 : 0;
    rows.set(chunk.knowledge_base_id, row);
  }

  return [...rows.values()];
}

async function runChunkMetadataSuggestionJob(input: {
  jobId: string;
  knowledgeBaseId: string;
  limit: number;
  overwrite: boolean;
}) {
  updateJob(input.jobId, {
    status: "generating",
    message: "正在扫描需要补摘要/关键词的知识分片。"
  });

  const candidates = (await listDocumentChunks())
    .filter((chunk) => chunk.knowledge_base_id === input.knowledgeBaseId)
    .filter((chunk) => input.overwrite ? needsOfficialMetadata(chunk) : needsMetadataSuggestion(chunk))
    .sort((a, b) => a.chunk_index - b.chunk_index || a.id.localeCompare(b.id))
    .slice(0, input.limit);

  updateJob(input.jobId, {
    total_chunks: candidates.length,
    message: candidates.length > 0
      ? `已找到 ${candidates.length} 个待治理分片，正在分批生成建议。`
      : "当前知识库没有需要生成建议的分片。"
  });

  if (candidates.length === 0) {
    updateJob(input.jobId, {
      status: "ready",
      message: "当前知识库没有需要生成建议的分片。",
      finished_at: new Date().toISOString()
    });
    return;
  }

  for (let index = 0; index < candidates.length; index += batchSize) {
    const batch = candidates.slice(index, index + batchSize);
    const batchNumber = Math.floor(index / batchSize) + 1;
    const batchTotal = Math.ceil(candidates.length / batchSize);

    updateJob(input.jobId, {
      message: `正在生成第 ${batchNumber}/${batchTotal} 批治理建议。`
    });

    try {
      const result = await suggestDocumentChunkMetadata(batch);
      const suggestionMap = new Map(result.suggestions.map((suggestion) => [suggestion.chunk_id, suggestion]));
      let suggested = 0;
      let failed = 0;

      for (const chunk of batch) {
        const suggestion = suggestionMap.get(chunk.id);
        if (!suggestion) {
          failed += 1;
          continue;
        }

        await savePendingSuggestion(chunk, suggestion, {
          jobId: input.jobId,
          model: result.model
        });
        suggested += 1;
      }

      const current = jobSnapshots.get(input.jobId);
      updateJob(input.jobId, {
        processed_chunks: (current?.processed_chunks ?? 0) + batch.length,
        suggested_chunks: (current?.suggested_chunks ?? 0) + suggested,
        failed_chunks: (current?.failed_chunks ?? 0) + failed,
        model: result.model,
        message: `已完成 ${Math.min(index + batch.length, candidates.length)}/${candidates.length} 个分片建议。`
      });
    } catch (error) {
      const current = jobSnapshots.get(input.jobId);
      updateJob(input.jobId, {
        processed_chunks: (current?.processed_chunks ?? 0) + batch.length,
        failed_chunks: (current?.failed_chunks ?? 0) + batch.length,
        error: error instanceof Error ? error.message : "模型生成失败",
        message: `第 ${batchNumber} 批生成失败，已继续记录失败数量。`
      });
    }
  }

  const finished = jobSnapshots.get(input.jobId);
  updateJob(input.jobId, {
    status: (finished?.suggested_chunks ?? 0) > 0 ? "ready" : "failed",
    message: (finished?.suggested_chunks ?? 0) > 0
      ? `全库治理建议生成完成，已生成 ${finished?.suggested_chunks ?? 0} 条待确认建议。`
      : "全库治理建议生成失败，没有可用建议。",
    finished_at: new Date().toISOString()
  });
}

async function savePendingSuggestion(
  chunk: DocumentChunk,
  suggestion: ChunkMetadataSuggestion,
  input: { jobId: string; model: string | null }
) {
  await updateDocumentChunk(chunk.id, {
    metadata: {
      ...chunk.metadata,
      pending_suggestion: {
        summary: suggestion.summary,
        keywords: suggestion.keywords,
        synonyms: suggestion.synonyms,
        model: input.model,
        generated_at: new Date().toISOString(),
        job_id: input.jobId
      }
    }
  });
}

function needsMetadataSuggestion(chunk: DocumentChunk) {
  return needsOfficialMetadata(chunk) && !chunk.metadata.pending_suggestion;
}

function needsOfficialMetadata(chunk: DocumentChunk) {
  return needsOfficialMetadataValue(chunk.metadata);
}

function needsMetadataSuggestionMetadata(chunk: DocumentChunkMetadata) {
  return needsOfficialMetadataValue(chunk.metadata) && !chunk.metadata.pending_suggestion;
}

function needsOfficialMetadataValue(metadata: DocumentChunk["metadata"]) {
  return !metadata.summary || (metadata.keywords ?? []).length === 0 || (metadata.synonyms ?? []).length === 0;
}

function updateJob(id: string, input: Partial<ChunkMetadataSuggestionJobSnapshot>) {
  const current = jobSnapshots.get(id);
  if (!current) {
    return;
  }

  jobSnapshots.set(id, {
    ...current,
    ...input,
    updated_at: new Date().toISOString()
  });
}

function normalizeLimit(value: number | undefined) {
  if (!Number.isFinite(value)) {
    return defaultLimit;
  }

  return Math.max(1, Math.min(maxLimit, Math.round(value ?? defaultLimit)));
}

function pruneJobSnapshots() {
  const now = Date.now();

  for (const [jobId, snapshot] of jobSnapshots) {
    const finishedAt = snapshot.finished_at ? new Date(snapshot.finished_at).getTime() : null;
    if (finishedAt && Number.isFinite(finishedAt) && now - finishedAt > jobSnapshotTtlMs) {
      jobSnapshots.delete(jobId);
    }
  }
}
