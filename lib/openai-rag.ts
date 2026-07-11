import { env } from "@/lib/config";
import { getOpenAIClient } from "@/lib/openai";
import type { Citation } from "@/lib/types";

export async function createVectorStore(name: string) {
  const openai = getOpenAIClient();
  if (!openai) {
    return null;
  }

  return openai.vectorStores.create({ name });
}

export async function deleteVectorStore(vectorStoreId: string) {
  const openai = getOpenAIClient();
  if (!openai) {
    return null;
  }

  return openai.vectorStores.delete(vectorStoreId);
}

export async function uploadFileToVectorStore(file: File, vectorStoreId: string) {
  const openai = getOpenAIClient();
  if (!openai) {
    return null;
  }

  const uploaded = await openai.vectorStores.files.upload(vectorStoreId, file);

  return uploaded;
}

export async function deleteVectorStoreFile(vectorStoreId: string, vectorStoreFileId: string) {
  const openai = getOpenAIClient();
  if (!openai) {
    return null;
  }

  return openai.vectorStores.files.delete(vectorStoreFileId, {
    vector_store_id: vectorStoreId
  });
}

export async function retrieveVectorStoreFile(vectorStoreId: string, vectorStoreFileId: string) {
  const openai = getOpenAIClient();
  if (!openai) {
    return null;
  }

  return openai.vectorStores.files.retrieve(vectorStoreFileId, {
    vector_store_id: vectorStoreId
  });
}

export function mapVectorStoreFileStatus(status?: string) {
  if (status === "completed") {
    return "ready" as const;
  }

  if (status === "failed" || status === "cancelled") {
    return "failed" as const;
  }

  return "processing" as const;
}

export function buildResponseInput(input: {
  question: string;
  history: { role: "user" | "assistant"; content: string }[];
}) {
  return [
    {
      role: "system" as const,
      content:
        "你是企业内部智能客服。必须优先基于 file_search 检索到的企业资料回答；如果没有明确依据，请说明未找到明确依据。回答要简洁、准确，并保留可追溯来源。"
    },
    ...input.history.slice(-8),
    {
      role: "user" as const,
      content: input.question
    }
  ];
}

export function buildFileSearchTools(vectorStoreIds: string[]) {
  return [
    {
      type: "file_search" as const,
      vector_store_ids: vectorStoreIds
    }
  ];
}

export async function answerWithFileSearch(input: {
  question: string;
  history: { role: "user" | "assistant"; content: string }[];
  vectorStoreIds: string[];
}) {
  const openai = getOpenAIClient();

  if (!openai || input.vectorStoreIds.length === 0) {
    return {
      answer:
        "当前还没有配置可用的 OpenAI 知识库。请先在管理端创建知识库并上传资料，或在 `.env.local` 中配置 `OPENAI_API_KEY` 后重试。",
      citations: [] as Citation[],
      model: null,
      usage: null
    };
  }

  const response = await openai.responses.create({
    model: env.openaiChatModel,
    input: buildResponseInput(input),
    tools: buildFileSearchTools(input.vectorStoreIds)
  });

  return {
    answer: response.output_text ?? "未能生成回答，请稍后重试。",
    citations: extractCitations(response),
    model: env.openaiChatModel,
    usage: response.usage ?? null
  };
}

export async function streamAnswerWithFileSearch(input: {
  question: string;
  history: { role: "user" | "assistant"; content: string }[];
  vectorStoreIds: string[];
}) {
  const openai = getOpenAIClient();

  if (!openai || input.vectorStoreIds.length === 0) {
    return null;
  }

  return openai.responses.create({
    model: env.openaiChatModel,
    input: buildResponseInput(input),
    tools: buildFileSearchTools(input.vectorStoreIds),
    stream: true
  });
}

export function extractCitations(response: any): Citation[] {
  const citations: Citation[] = [];

  for (const output of response.output ?? []) {
    for (const content of output.content ?? []) {
      for (const annotation of content.annotations ?? []) {
        const citation = annotationToCitation(annotation, citations.length + 1);
        if (citation) {
          citations.push(citation);
        }
      }
    }
  }

  return citations;
}

export function extractCitationsFromAnnotations(annotations: unknown[]): Citation[] {
  const citations: Citation[] = [];
  const seen = new Set<string>();

  for (const annotation of annotations) {
    const citation = annotationToCitation(annotation, citations.length + 1);
    if (!citation) {
      continue;
    }

    const key = citation.file_id ?? citation.url ?? citation.file_name ?? String(citations.length);
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    citations.push(citation);
  }

  return citations;
}

function annotationToCitation(annotation: any, index: number): Citation | null {
  if (!annotation || typeof annotation !== "object") {
    return null;
  }

  if (annotation.type === "file_citation" || annotation.type === "container_file_citation" || annotation.file_id) {
    return {
      file_id: annotation.file_id,
      file_name: annotation.filename ?? annotation.file_name,
      quote: annotation.quote,
      index
    };
  }

  if (annotation.type === "url_citation" || annotation.url) {
    return {
      file_name: annotation.title ?? annotation.url,
      quote: annotation.url,
      url: annotation.url,
      index
    };
  }

  return null;
}
