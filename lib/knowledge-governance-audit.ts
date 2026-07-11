import { randomUUID } from "crypto";
import type {
  DocumentChunk,
  DocumentChunkGovernanceAudit,
  DocumentChunkGovernanceAuditState,
  DocumentChunkGovernanceSuggestionSnapshot,
  UserProfile
} from "@/lib/types";

const maxAuditRecordsPerChunk = 20;

export function appendChunkGovernanceAudit(
  metadata: DocumentChunk["metadata"],
  input: {
    action: DocumentChunkGovernanceAudit["action"];
    actor: UserProfile;
    createdAt?: string;
    note?: string | null;
    before?: DocumentChunkGovernanceAuditState;
    after?: DocumentChunkGovernanceAuditState;
    suggestion?: DocumentChunkGovernanceSuggestionSnapshot | null;
  }
): DocumentChunk["metadata"] {
  const audit: DocumentChunkGovernanceAudit = {
    id: randomUUID(),
    action: input.action,
    actor_id: input.actor.id,
    actor_name: input.actor.name,
    actor_email: input.actor.email,
    created_at: input.createdAt ?? new Date().toISOString(),
    note: input.note ?? null,
    before: input.before,
    after: input.after,
    suggestion: input.suggestion ?? undefined
  };

  return {
    ...metadata,
    governance_audit: [audit, ...normalizeChunkGovernanceAudits(metadata.governance_audit)].slice(0, maxAuditRecordsPerChunk)
  };
}

export function buildChunkGovernanceState(
  chunk: Pick<DocumentChunk, "chunk_index" | "content" | "token_estimate" | "metadata">,
  metadata: DocumentChunk["metadata"] = chunk.metadata,
  extra?: Pick<DocumentChunkGovernanceAuditState, "related_chunk_ids">
): DocumentChunkGovernanceAuditState {
  return {
    summary: cleanNullableText(metadata.summary),
    keywords: normalizeStringList(metadata.keywords),
    synonyms: normalizeStringList(metadata.synonyms),
    token_estimate: chunk.token_estimate,
    content_length: chunk.content.length,
    content_preview: cleanText(chunk.content, 140),
    chunk_index: chunk.chunk_index,
    pending_suggestion: Boolean(metadata.pending_suggestion),
    ...extra
  };
}

export function normalizeChunkGovernanceAudits(value: unknown): DocumentChunkGovernanceAudit[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => normalizeAudit(item))
    .filter((item): item is DocumentChunkGovernanceAudit => Boolean(item))
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
}

export function normalizeSuggestionSnapshot(value: unknown): DocumentChunkGovernanceSuggestionSnapshot | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const source = value as Record<string, unknown>;
  const summary = cleanText(source.summary, 600);
  if (!summary) {
    return null;
  }

  return {
    summary,
    keywords: normalizeStringList(source.keywords).slice(0, 24),
    synonyms: normalizeStringList(source.synonyms).slice(0, 36),
    model: typeof source.model === "string" ? source.model : null,
    generated_at: typeof source.generated_at === "string" ? source.generated_at : null,
    job_id: typeof source.job_id === "string" ? source.job_id : null
  };
}

function normalizeAudit(value: unknown): DocumentChunkGovernanceAudit | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const source = value as Record<string, unknown>;
  const id = typeof source.id === "string" && source.id ? source.id : randomUUID();
  const action = typeof source.action === "string" ? source.action : "";
  const actorId = typeof source.actor_id === "string" ? source.actor_id : "";
  const createdAt = typeof source.created_at === "string" ? source.created_at : "";

  if (!isAuditAction(action) || !actorId || !createdAt) {
    return null;
  }

  return {
    id,
    action,
    actor_id: actorId,
    actor_name: typeof source.actor_name === "string" ? source.actor_name : null,
    actor_email: typeof source.actor_email === "string" ? source.actor_email : null,
    created_at: createdAt,
    note: typeof source.note === "string" ? source.note : null,
    before: normalizeAuditState(source.before),
    after: normalizeAuditState(source.after),
    suggestion: normalizeSuggestionSnapshot(source.suggestion) ?? undefined
  };
}

function normalizeAuditState(value: unknown): DocumentChunkGovernanceAuditState | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const source = value as Record<string, unknown>;
  const tokenEstimate = Number(source.token_estimate);
  const contentLength = Number(source.content_length);
  const chunkIndex = Number(source.chunk_index);

  return {
    summary: cleanNullableText(source.summary),
    keywords: normalizeStringList(source.keywords),
    synonyms: normalizeStringList(source.synonyms),
    token_estimate: Number.isFinite(tokenEstimate) ? tokenEstimate : undefined,
    content_length: Number.isFinite(contentLength) ? contentLength : undefined,
    content_preview: typeof source.content_preview === "string" ? source.content_preview : undefined,
    chunk_index: Number.isFinite(chunkIndex) ? chunkIndex : undefined,
    pending_suggestion: typeof source.pending_suggestion === "boolean" ? source.pending_suggestion : undefined,
    related_chunk_ids: normalizeStringList(source.related_chunk_ids)
  };
}

function isAuditAction(value: string): value is DocumentChunkGovernanceAudit["action"] {
  return (
    value === "pending_suggestion_apply" ||
    value === "pending_suggestion_revoke" ||
    value === "metadata_update" ||
    value === "split" ||
    value === "merge"
  );
}

function normalizeStringList(value: unknown) {
  const source = Array.isArray(value) ? value : [];
  const result: string[] = [];
  const seen = new Set<string>();

  for (const rawItem of source) {
    const item = cleanText(rawItem, 80);
    const key = item.toLowerCase();
    if (!item || seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(item);
  }

  return result;
}

function cleanNullableText(value: unknown) {
  const text = cleanText(value, 600);
  return text || null;
}

function cleanText(value: unknown, maxLength = 160) {
  if (typeof value !== "string") {
    return "";
  }

  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}
