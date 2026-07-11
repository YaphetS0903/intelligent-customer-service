import { compatibleChatAttempts, completeCompatibleChat, compatibleChatModelLabel } from "@/lib/compatible-chat";
import { isLocalTextRag } from "@/lib/config";
import { listDocumentChunks, listDocuments } from "@/lib/db";
import {
  buildLocalRagPrompt,
  configuredLocalRagStrategyId,
  evaluateLocalRagHits,
  localRagCitations,
  localRagNoEvidenceAnswer,
  searchLocalTextRag
} from "@/lib/local-rag";
import type { Citation, KnowledgeBase } from "@/lib/types";

export async function runQaQuestion(input: {
  question: string;
  knowledgeBases: KnowledgeBase[];
}) {
  const startedAt = Date.now();
  const retrievalStrategy = isLocalTextRag() ? configuredLocalRagStrategyId() : null;
  const [documents, chunks] = await Promise.all([
    listDocuments(),
    isLocalTextRag() ? listDocumentChunks() : Promise.resolve([])
  ]);
  const publishedDocuments = documents.filter((document) => document.publish_status === "published");
  const publishedDocumentIds = new Set(publishedDocuments.map((document) => document.id));
  const searchableKnowledgeBases = input.knowledgeBases.filter((kb) => {
    const readyDocuments = publishedDocuments.some(
      (document) => document.knowledge_base_id === kb.id && document.status === "ready"
    );
    const hasLocalChunks = chunks.some((chunk) => chunk.knowledge_base_id === kb.id && publishedDocumentIds.has(chunk.document_id));
    return readyDocuments && hasLocalChunks;
  });

  if (!isLocalTextRag()) {
    return {
      answer: "当前问答测试第一版支持 local_text RAG。OpenAI File Search 质检可在后续版本接入。",
      citations: [] as Citation[],
      model: null,
      usage: null,
      usage_input_text: input.question,
      retrieval_strategy: retrievalStrategy,
      latency_ms: Date.now() - startedAt
    };
  }

  const hits = await searchLocalTextRag({
    question: input.question,
    knowledgeBases: searchableKnowledgeBases,
    limit: 6,
    allowedDocumentIds: [...publishedDocumentIds]
  });
  const retrievalDiagnostics = evaluateLocalRagHits(hits);

  if (!retrievalDiagnostics.hasEvidence) {
    return {
      answer: localRagNoEvidenceAnswer(retrievalDiagnostics),
      citations: hits.length > 0 ? localRagCitations(hits.slice(0, 3)) : [] as Citation[],
      model: compatibleChatModelLabel(),
      usage: null,
      usage_input_text: input.question,
      retrieval_strategy: retrievalStrategy,
      retrieval_diagnostics: retrievalDiagnostics,
      latency_ms: Date.now() - startedAt
    };
  }

  const citations = localRagCitations(hits);
  const prompt = buildLocalRagPrompt({ question: input.question, hits });
  const completion = await completeCompatibleChat({
    question: prompt,
    history: [],
    hasSearchableKnowledge: true,
    systemOverride:
      "你是企业内部智能客服质检模式。必须严格基于用户消息中的企业知识片段回答，不得编造片段外的信息。回答要包含清晰结论，并在末尾列出参考来源编号。"
  });
  const answer = completion?.choices[0]?.message?.content?.trim() ||
    "已检索到知识片段，但对话模型未返回有效回答。";

  return {
    answer,
    citations,
    model: compatibleChatModelLabel(completion),
    usage: completion?.usage ?? null,
    usage_input_text: prompt,
    retrieval_strategy: retrievalStrategy,
    retrieval_diagnostics: retrievalDiagnostics,
    model_attempts: compatibleChatAttempts(completion),
    latency_ms: Date.now() - startedAt
  };
}
