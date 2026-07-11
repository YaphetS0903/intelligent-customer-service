import {
  completeCompatibleChat,
  compatibleChatAttempts,
  compatibleChatModelLabel
} from "@/lib/compatible-chat";
import type { CompatibleChatAttempt } from "@/lib/compatible-chat";
import type { DocumentChunk } from "@/lib/types";

export type ChunkMetadataSuggestion = {
  chunk_id: string;
  summary: string;
  keywords: string[];
  synonyms: string[];
};

export type ChunkMetadataSuggestionResult = {
  suggestions: ChunkMetadataSuggestion[];
  model: string | null;
  attempts: CompatibleChatAttempt[];
};

export async function suggestDocumentChunkMetadata(
  chunks: Pick<DocumentChunk, "id" | "chunk_index" | "content" | "metadata">[]
): Promise<ChunkMetadataSuggestionResult> {
  const normalizedChunks = chunks
    .map((chunk) => ({
      id: chunk.id,
      chunk_index: chunk.chunk_index,
      content: normalizeChunkContent(chunk.content),
      metadata: chunk.metadata
    }))
    .filter((chunk) => chunk.content.length >= 12)
    .slice(0, 12);

  if (normalizedChunks.length === 0) {
    return {
      suggestions: [],
      model: null,
      attempts: []
    };
  }

  const completion = await completeCompatibleChat({
    history: [],
    hasSearchableKnowledge: false,
    systemOverride: [
      "你是企业知识库治理助手。",
      "你只负责为知识分片生成便于检索和人工复核的摘要、关键词、同义词。",
      "必须只输出 JSON，不要输出 Markdown、解释或代码块。"
    ].join(""),
    question: buildMetadataPrompt(normalizedChunks)
  });

  if (!completion) {
    throw new Error("没有可用的对话模型配置，无法生成分片建议。");
  }

  const content = completion.choices[0]?.message?.content ?? "";
  const parsed = parseSuggestionPayload(content);
  const allowedIds = new Set(normalizedChunks.map((chunk) => chunk.id));
  const suggestions = parsed
    .map((item) => cleanSuggestion(item))
    .filter((item): item is ChunkMetadataSuggestion => Boolean(item && allowedIds.has(item.chunk_id)));

  return {
    suggestions,
    model: compatibleChatModelLabel(completion),
    attempts: compatibleChatAttempts(completion)
  };
}

function buildMetadataPrompt(
  chunks: Array<Pick<DocumentChunk, "id" | "chunk_index" | "content" | "metadata">>
) {
  const payload = chunks.map((chunk) => ({
    chunk_id: chunk.id,
    chunk_index: chunk.chunk_index,
    source: chunk.metadata.file_name ?? chunk.metadata.title ?? "",
    location: [
      chunk.metadata.page ? `第 ${chunk.metadata.page} 页` : "",
      chunk.metadata.section ?? "",
      chunk.metadata.sheet ? `工作表：${chunk.metadata.sheet}` : "",
      chunk.metadata.cell_range ?? ""
    ].filter(Boolean).join(" / "),
    existing_summary: chunk.metadata.summary ?? "",
    existing_keywords: chunk.metadata.keywords ?? [],
    existing_synonyms: chunk.metadata.synonyms ?? [],
    content: chunk.content.slice(0, 1600)
  }));

  return [
    "请为下面的企业知识库分片生成治理建议。",
    "要求：",
    "1. summary 用中文，40-100 字，概括这个分片能回答什么问题。",
    "2. keywords 给 4-8 个业务关键词，包含系统名、流程名、表单名、产品名、编号、动作词。",
    "3. synonyms 给 3-8 个员工可能会说的口语问法或同义词，不要编造事实。",
    "4. 如果原文信息不足，仍基于原文写保守建议。",
    "5. 输出必须是 JSON：{\"suggestions\":[{\"chunk_id\":\"...\",\"summary\":\"...\",\"keywords\":[\"...\"],\"synonyms\":[\"...\"]}]}",
    "",
    JSON.stringify({ chunks: payload }, null, 2)
  ].join("\n");
}

function parseSuggestionPayload(content: string) {
  const json = extractJson(content);
  const parsed = JSON.parse(json) as unknown;

  if (Array.isArray(parsed)) {
    return parsed;
  }

  if (parsed && typeof parsed === "object" && Array.isArray((parsed as { suggestions?: unknown }).suggestions)) {
    return (parsed as { suggestions: unknown[] }).suggestions;
  }

  throw new Error("模型返回的分片建议不是合法 JSON。");
}

function extractJson(content: string) {
  const trimmed = content.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1]?.trim();
  const candidate = fenced || trimmed;
  const firstObject = candidate.indexOf("{");
  const firstArray = candidate.indexOf("[");
  const start = firstArray >= 0 && (firstObject < 0 || firstArray < firstObject) ? firstArray : firstObject;

  if (start < 0) {
    throw new Error("模型没有返回 JSON 内容。");
  }

  const endChar = candidate[start] === "[" ? "]" : "}";
  const end = candidate.lastIndexOf(endChar);
  if (end <= start) {
    throw new Error("模型返回的 JSON 不完整。");
  }

  return candidate.slice(start, end + 1);
}

function cleanSuggestion(value: unknown): ChunkMetadataSuggestion | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const item = value as Record<string, unknown>;
  const chunkId = cleanText(item.chunk_id, 120);
  const summary = cleanText(item.summary, 180);
  const keywords = cleanList(item.keywords, 8, 28);
  const synonyms = cleanList(item.synonyms, 8, 36);

  if (!chunkId || !summary) {
    return null;
  }

  return {
    chunk_id: chunkId,
    summary,
    keywords,
    synonyms
  };
}

function normalizeChunkContent(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function cleanText(value: unknown, maxLength: number) {
  if (typeof value !== "string") {
    return "";
  }

  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function cleanList(value: unknown, maxItems: number, maxLength: number) {
  const rawItems = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[,，、\n]/)
      : [];
  const result: string[] = [];
  const seen = new Set<string>();

  for (const rawItem of rawItems) {
    const item = cleanText(rawItem, maxLength);
    const key = item.toLowerCase();

    if (!item || seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(item);

    if (result.length >= maxItems) {
      break;
    }
  }

  return result;
}
