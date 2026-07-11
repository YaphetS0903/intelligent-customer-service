import { NextResponse } from "next/server";
import { createQaTestCase, listDocumentChunks, listDocuments, listKnowledgeBases, listQaTestCases, requireAdmin } from "@/lib/db";
import { pilotQaTemplate } from "@/lib/qa-template";
import type { DocumentChunk, DocumentRecord } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const user = await requireAdmin();
    const body = await request.json().catch(() => ({}));
    const limit = normalizeLimit(body.limit);
    const source = body.source === "pilot" ? "pilot" : "knowledge";
    const selectedKnowledgeBaseIds = Array.isArray(body.knowledge_base_ids)
      ? body.knowledge_base_ids.map((id: unknown) => String(id)).filter(Boolean)
      : [];
    const [knowledgeBases, documents, chunks, existingTests] = await Promise.all([
      listKnowledgeBases(),
      listDocuments(),
      listDocumentChunks(),
      listQaTestCases()
    ]);
    const targetKnowledgeBaseIds = resolveTargetKnowledgeBaseIds({
      selectedKnowledgeBaseIds,
      knowledgeBases,
      documents
    });

    if (targetKnowledgeBaseIds.length === 0) {
      return NextResponse.json({ error: "请先创建知识库并上传至少一份可用资料，再生成测试模板。" }, { status: 400 });
    }

    const existingQuestions = new Set(existingTests.map((test) => normalizeQuestion(test.question)));
    const created = [];
    const skipped = [];
    const items: GeneratedQaItem[] = source === "pilot"
      ? pilotQaTemplate.slice(0, limit).map((item) => ({
          question: item.question,
          expected_answer: item.expected_answer
        }))
      : buildKnowledgeQaTemplate({
          documents,
          chunks,
          knowledgeBaseIds: targetKnowledgeBaseIds,
          limit
        });

    if (items.length === 0) {
      return NextResponse.json(
        { error: "当前知识库没有可用于生成测试题的已发布知识分片。请先发布资料，或检查资料是否已解析完成。" },
        { status: 400 }
      );
    }

    for (const item of items) {
      if (existingQuestions.has(normalizeQuestion(item.question))) {
        skipped.push({
          question: item.question,
          reason: "同名问题已存在"
        });
        continue;
      }

      created.push(await createQaTestCase({
        question: item.question,
        expected_answer: item.expected_answer,
        knowledge_base_ids: item.knowledge_base_ids ?? targetKnowledgeBaseIds,
        created_by: user.id
      }));
      existingQuestions.add(normalizeQuestion(item.question));
    }

    return NextResponse.json({
      created,
      skipped,
      count: created.length,
      source,
      knowledge_base_ids: targetKnowledgeBaseIds
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "生成测试模板失败" },
      { status: 400 }
    );
  }
}

function normalizeLimit(value: unknown) {
  const limit = Number(value ?? 30);

  if (!Number.isFinite(limit)) {
    return 30;
  }

  return Math.max(1, Math.min(Math.floor(limit), pilotQaTemplate.length));
}

type GeneratedQaItem = {
  question: string;
  expected_answer: string;
  knowledge_base_ids?: string[];
};

function buildKnowledgeQaTemplate(input: {
  documents: DocumentRecord[];
  chunks: DocumentChunk[];
  knowledgeBaseIds: string[];
  limit: number;
}): GeneratedQaItem[] {
  const targetKnowledgeBaseIds = new Set(input.knowledgeBaseIds);
  const usableDocuments = input.documents.filter((document) =>
    targetKnowledgeBaseIds.has(document.knowledge_base_id) &&
    document.status === "ready" &&
    document.publish_status === "published"
  );
  const documentMap = new Map(usableDocuments.map((document) => [document.id, document]));
  const chunksByDocument = new Map<string, DocumentChunk[]>();

  for (const chunk of input.chunks) {
    const document = documentMap.get(chunk.document_id);

    if (!document) {
      continue;
    }

    const content = stripChunkContextHeader(chunk.content);
    if (content.replace(/\s/g, "").length < 20 || isNoisyGeneratedContent(content)) {
      continue;
    }

    chunksByDocument.set(chunk.document_id, [...(chunksByDocument.get(chunk.document_id) ?? []), chunk]);
  }

  const items: GeneratedQaItem[] = [];

  for (const [documentId, documentChunks] of chunksByDocument) {
    const document = documentMap.get(documentId);
    if (!document) {
      continue;
    }

    const sortedChunks = [...documentChunks].sort((a, b) => {
      const pageA = Number(a.metadata.page);
      const pageB = Number(b.metadata.page);

      if (Number.isFinite(pageA) && Number.isFinite(pageB) && pageA !== pageB) {
        return pageA - pageB;
      }

      return a.chunk_index - b.chunk_index;
    });
    const representativeSections = uniquePreserveOrder(
      sortedChunks
        .map((chunk) => readableSection(chunk))
        .filter(Boolean)
    ).slice(0, 8);

    if (representativeSections.length >= 2) {
      items.push({
        question: `资料「${document.title}」主要包含哪些内容？`,
        expected_answer: `主要内容应包括：${representativeSections.slice(0, 6).join("、")}。`,
        knowledge_base_ids: [document.knowledge_base_id]
      });
    }

    for (const chunk of selectRepresentativeChunks(sortedChunks, Math.max(2, Math.ceil(input.limit / Math.max(chunksByDocument.size, 1))))) {
      const section = readableSection(chunk);
      const location = readableLocation(chunk);
      const content = stripChunkContextHeader(chunk.content);
      const questionSubject = section || location;
      items.push({
        question: questionSubject
          ? `资料「${document.title}」中，${questionSubject}讲了什么？`
          : `资料「${document.title}」说明了什么？`,
        expected_answer: `应说明：${truncateText(content, 260)}`,
        knowledge_base_ids: [document.knowledge_base_id]
      });
    }

    if (items.length >= input.limit * 2) {
      break;
    }
  }

  return dedupeGeneratedItems(items).slice(0, input.limit);
}

function selectRepresentativeChunks(chunks: DocumentChunk[], limit: number) {
  if (chunks.length <= limit) {
    return chunks;
  }

  const indexes = [
    0,
    1,
    2,
    Math.floor(chunks.length * 0.25),
    Math.floor(chunks.length * 0.5),
    Math.floor(chunks.length * 0.75),
    chunks.length - 1
  ];
  const selected: DocumentChunk[] = [];
  const seenPages = new Set<string | number>();

  for (const index of indexes) {
    const chunk = chunks[Math.max(0, Math.min(chunks.length - 1, index))];
    if (!chunk) {
      continue;
    }

    const page = Number(chunk.metadata.page);
    const pageKey = Number.isFinite(page) ? page : chunk.id;
    if (seenPages.has(pageKey)) {
      continue;
    }

    selected.push(chunk);
    seenPages.add(pageKey);

    if (selected.length >= limit) {
      break;
    }
  }

  return selected;
}

function readableSection(chunk: DocumentChunk) {
  const section = chunk.metadata.section || chunk.metadata.title;
  const cleaned = normalizeSectionTitle(section);

  if (!cleaned || cleaned === chunk.metadata.file_name) {
    return "";
  }

  return `「${truncateText(cleaned, 32)}」`;
}

function normalizeSectionTitle(value: string | undefined) {
  const cleaned = value?.replace(/\s+/g, " ").trim() ?? "";

  if (!cleaned) {
    return "";
  }

  if (/^c?ontents$/i.test(cleaned) || /^目录$/i.test(cleaned)) {
    return "目录";
  }

  if (/^the user can demonstrate/i.test(cleaned)) {
    return "";
  }

  const cjkCount = cleaned.match(/[\u3400-\u9fff]/g)?.length ?? 0;
  const asciiCount = cleaned.match(/[a-z]/gi)?.length ?? 0;
  if (asciiCount > 30 && cjkCount === 0) {
    return "";
  }

  return cleaned;
}

function readableLocation(chunk: DocumentChunk) {
  const parts = [];

  if (chunk.metadata.page) {
    parts.push(`第 ${chunk.metadata.page} 页`);
  }

  if (chunk.metadata.sheet) {
    parts.push(`工作表 ${chunk.metadata.sheet}`);
  }

  if (chunk.metadata.cell_range) {
    parts.push(chunk.metadata.cell_range);
  }

  return parts.join(" · ");
}

function stripChunkContextHeader(content: string) {
  const lines = content.split(/\r?\n/);
  let index = 0;

  while (index < lines.length) {
    const line = lines[index]?.trim() ?? "";

    if (!line || /^资料[:：]/.test(line) || /^标题[:：]/.test(line) || /^位置[:：]/.test(line)) {
      index += 1;
      continue;
    }

    break;
  }

  return lines.slice(index).join("\n").replace(/\s+/g, " ").trim() || content.replace(/\s+/g, " ").trim();
}

function isNoisyGeneratedContent(content: string) {
  const normalized = content.replace(/\s+/g, " ").trim();

  if (/^the user can demonstrate/i.test(normalized)) {
    return true;
  }

  const cjkCount = normalized.match(/[\u3400-\u9fff]/g)?.length ?? 0;
  const asciiCount = normalized.match(/[a-z]/gi)?.length ?? 0;
  return asciiCount > 80 && cjkCount < 4;
}

function truncateText(value: string, maxLength: number) {
  const normalized = value.replace(/\s+/g, " ").trim();

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 1)}…`;
}

function uniquePreserveOrder(values: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    if (seen.has(value)) {
      continue;
    }

    seen.add(value);
    result.push(value);
  }

  return result;
}

function dedupeGeneratedItems(items: GeneratedQaItem[]) {
  const seen = new Set<string>();
  const result: GeneratedQaItem[] = [];

  for (const item of items) {
    const key = normalizeQuestion(item.question);
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(item);
  }

  return result;
}

function resolveTargetKnowledgeBaseIds(input: {
  selectedKnowledgeBaseIds: string[];
  knowledgeBases: Awaited<ReturnType<typeof listKnowledgeBases>>;
  documents: Awaited<ReturnType<typeof listDocuments>>;
}) {
  const validIds = new Set(input.knowledgeBases.map((kb) => kb.id));
  const selectedIds = input.selectedKnowledgeBaseIds.filter((id) => validIds.has(id));

  if (selectedIds.length > 0) {
    return selectedIds;
  }

  const readyDocumentCounts = new Map<string, number>();

  for (const document of input.documents) {
    if (document.status !== "ready") {
      continue;
    }

    readyDocumentCounts.set(document.knowledge_base_id, (readyDocumentCounts.get(document.knowledge_base_id) ?? 0) + 1);
  }

  const bestKnowledgeBase = [...input.knowledgeBases]
    .sort((a, b) => (readyDocumentCounts.get(b.id) ?? 0) - (readyDocumentCounts.get(a.id) ?? 0))[0];

  if (!bestKnowledgeBase || (readyDocumentCounts.get(bestKnowledgeBase.id) ?? 0) === 0) {
    return [];
  }

  return [bestKnowledgeBase.id];
}

function normalizeQuestion(question: string) {
  return question.replace(/\s+/g, "").replace(/[?？。！!]/g, "").toLowerCase();
}
