import { env, isLocalTextRag } from "@/lib/config";
import { compatibleChatAttempts, compatibleChatModelLabel, streamCompatibleChat } from "@/lib/compatible-chat";
import {
  createMessage,
  canAccessDocument,
  createModelUsageEvent,
  createSecurityEvent,
  getCurrentUser,
  listAccessibleKnowledgeBases,
  listDocumentChunkMetadata,
  listDocuments,
  listMessages,
  upsertConversation
} from "@/lib/db";
import { joinUsageText, modelNameFromLabel, modelProviderFromLabel, normalizeModelUsage } from "@/lib/model-usage";
import {
  extractCitations,
  extractCitationsFromAnnotations,
  streamAnswerWithFileSearch
} from "@/lib/openai-rag";
import {
  buildLocalRagPrompt,
  configuredLocalRagStrategyId,
  evaluateLocalRagHits,
  localRagCitations,
  localRagNoEvidenceAnswer,
  searchLocalTextRag
} from "@/lib/local-rag";
import { createNoCitationKnowledgeTask } from "@/lib/no-citation-task";
import { detectSecurityEventBurst } from "@/lib/security-monitor";
import {
  analyzeModelOutput,
  analyzeUserInput,
  buildAbnormalAccessEvent,
  buildSecurityEvent,
  maskSensitiveText
} from "@/lib/security-audit";
import type { Citation } from "@/lib/types";

type StreamEvent =
  | {
      type: "meta";
      conversation: { id: string; title: string };
      user_message_id: string;
      knowledge_bases: Array<{
        id: string;
        name: string;
        ready_documents: number;
        searchable: boolean;
      }>;
    }
  | { type: "heartbeat"; at: string }
  | { type: "delta"; text: string }
  | { type: "citations"; citations: Citation[] }
  | { type: "done"; message_id: string; citations: Citation[]; model: string | null; knowledge_task_id?: string | null }
  | { type: "error"; error: string };

function noSearchableAnswer(input: { accessibleCount: number; selectedCount: number }) {
  if (input.accessibleCount === 0) {
    return "当前账号暂无可用资料。请联系管理员确认账号资料范围。";
  }

  if (input.selectedCount === 0) {
    return "本次选择的资料范围暂无可用内容。请换一个范围，或联系管理员确认资料是否已处理完成。";
  }

  return "当前可访问资料还没有处理完成。请稍后重试，或联系管理员确认资料状态。";
}

async function recordSecurityFindings(input: {
  findings: ReturnType<typeof analyzeUserInput>["findings"];
  user: Awaited<ReturnType<typeof getCurrentUser>>;
  conversation_id: string;
  message_id: string;
}) {
  await Promise.all(input.findings.map((finding) =>
    createSecurityEvent(buildSecurityEvent({
      finding,
      user: input.user,
      conversation_id: input.conversation_id,
      message_id: input.message_id
    })).catch(() => null)
  ));

  await detectSecurityEventBurst({
    user: input.user,
    conversation_id: input.conversation_id,
    message_id: input.message_id
  }).catch(() => null);
}

async function recordNoCitationTask(input: Parameters<typeof createNoCitationKnowledgeTask>[0]) {
  const taskPromise = createNoCitationKnowledgeTask(input).catch((error) => {
    console.error("[chat-stream:no-citation-task]", error);
    return null;
  });

  return Promise.race([
    taskPromise,
    new Promise<null>((resolve) => {
      setTimeout(() => resolve(null), 1800);
    })
  ]);
}

async function recordChatModelUsage(input: {
  source_id: string;
  conversation_id: string;
  user_id: string;
  provider: string | null;
  model: string | null;
  usage?: unknown;
  inputText: string;
  outputText: string;
  metadata?: Record<string, unknown>;
}) {
  if (!input.model && !input.usage) {
    return;
  }

  const usage = normalizeModelUsage({
    usage: input.usage,
    inputText: input.inputText,
    outputText: input.outputText
  });

  await createModelUsageEvent({
    source: "chat",
    source_id: input.source_id,
    conversation_id: input.conversation_id,
    user_id: input.user_id,
    provider: input.provider,
    model: input.model,
    ...usage,
    metadata: input.metadata ?? {}
  }).catch((error) => {
    console.error("[chat-stream:usage]", error);
  });
}

export async function POST(request: Request) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

      function stopHeartbeat() {
        if (heartbeatTimer) {
          clearInterval(heartbeatTimer);
          heartbeatTimer = null;
        }
      }

      function send(event: StreamEvent) {
        if (closed) {
          return;
        }

        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          closed = true;
          stopHeartbeat();
        }
      }

      function close() {
        if (closed) {
          return;
        }

        closed = true;
        stopHeartbeat();
        try {
          controller.close();
        } catch {
          // The client may have disconnected after the last chunk was queued.
        }
      }

      function startHeartbeat() {
        send({ type: "heartbeat", at: new Date().toISOString() });
        heartbeatTimer = setInterval(() => {
          send({ type: "heartbeat", at: new Date().toISOString() });
        }, 15000);
      }

      try {
        startHeartbeat();
        const body = await request.json();
        const rawQuestion = String(body.message ?? "").trim();

        if (!rawQuestion) {
          send({ type: "error", error: "请输入问题" });
          close();
          return;
        }

        const user = await getCurrentUser();
        const inputSecurity = analyzeUserInput(rawQuestion);
        const question = inputSecurity.maskedText;
        const selectedKnowledgeBaseIds = Array.isArray(body.knowledge_base_ids)
          ? body.knowledge_base_ids.map((id: unknown) => String(id)).filter(Boolean)
          : [];
        const accessibleKnowledgeBases = await listAccessibleKnowledgeBases(user);
        const knowledgeBases = selectedKnowledgeBaseIds.length > 0
          ? accessibleKnowledgeBases.filter((kb) => selectedKnowledgeBaseIds.includes(kb.id))
          : accessibleKnowledgeBases;
        const conversation = await upsertConversation(question, body.conversation_id);

        const userMessage = await createMessage({
          conversation_id: conversation.id,
          role: "user",
          content: question,
          citations: [],
          model: null
        });
        await recordSecurityFindings({
          findings: inputSecurity.findings,
          user,
          conversation_id: conversation.id,
          message_id: userMessage.id
        });

        if (selectedKnowledgeBaseIds.length > 0 && knowledgeBases.length !== selectedKnowledgeBaseIds.length) {
          await createSecurityEvent(buildAbnormalAccessEvent({
            user,
            title: "员工尝试访问无权限知识库",
            detail: "员工对话请求包含不可访问的知识库 ID，系统已阻止本次越权检索。",
            conversation_id: conversation.id,
            message_id: userMessage.id,
            metadata: {
              selected_knowledge_base_ids: selectedKnowledgeBaseIds,
              allowed_knowledge_base_ids: accessibleKnowledgeBases.map((kb) => kb.id)
            }
          })).catch(() => null);
          await detectSecurityEventBurst({
            user,
            conversation_id: conversation.id,
            message_id: userMessage.id
          }).catch(() => null);
          send({ type: "error", error: "所选资料范围不可访问" });
          close();
          return;
        }

        const [documents, chunkMetadata] = await Promise.all([
          listDocuments(),
          isLocalTextRag() ? listDocumentChunkMetadata() : Promise.resolve([])
        ]);
        const accessibleDocuments = documents.filter((document) => canAccessDocument(user, document));
        const accessibleDocumentIds = new Set(accessibleDocuments.map((document) => document.id));
        const searchScopes = knowledgeBases.map((kb) => {
          const readyDocuments = accessibleDocuments.filter(
            (document) => document.knowledge_base_id === kb.id && document.status === "ready"
          ).length;
          const hasLocalChunks = chunkMetadata.some((chunk) =>
            chunk.knowledge_base_id === kb.id && accessibleDocumentIds.has(chunk.document_id)
          );

          return {
            id: kb.id,
            name: kb.name,
            ready_documents: readyDocuments,
            searchable: Boolean((kb.openai_vector_store_id || hasLocalChunks) && readyDocuments > 0)
          };
        });
        const searchableKnowledgeBases = knowledgeBases.filter((kb) =>
          searchScopes.some((scope) => scope.id === kb.id && scope.searchable)
        );
        const knowledgeBaseNames = knowledgeBases.map((kb) => kb.name);

        send({
          type: "meta",
          conversation: {
            id: conversation.id,
            title: conversation.title
          },
          user_message_id: userMessage.id,
          knowledge_bases: searchScopes
        });

        const history = (await listMessages(conversation.id))
          .filter((message) => message.id !== userMessage.id)
          .map((message) => ({
            role: message.role,
            content: message.content
          }));

        const vectorStoreIds = searchableKnowledgeBases
          .map((kb) => kb.openai_vector_store_id)
          .filter((id): id is string => Boolean(id));

        if (isLocalTextRag()) {
          let retrievalError: string | null = null;
          const localRagStrategyId = configuredLocalRagStrategyId();
          const hits = await searchLocalTextRag({
            question,
            knowledgeBases: searchableKnowledgeBases,
            limit: 6,
            allowedDocumentIds: [...accessibleDocumentIds],
            strategyId: localRagStrategyId
          }).catch((error) => {
            retrievalError = error instanceof Error ? error.message : "知识库检索失败";
            console.error("[chat-stream:local-rag]", error);
            return [];
          });
          const retrievalDiagnostics = evaluateLocalRagHits(hits);

          if (retrievalError || !retrievalDiagnostics.hasEvidence) {
            const citations = hits.length > 0 ? localRagCitations(hits.slice(0, 3)) : [];
            const answer = retrievalError
              ? "知识库检索暂时失败，请稍后重试。系统已避免在没有可靠资料依据时生成回答。"
              : localRagNoEvidenceAnswer(retrievalDiagnostics);
            const maskedAnswer = maskSensitiveText(answer);
            send({ type: "delta", text: maskedAnswer });

            const assistantMessage = await createMessage({
              conversation_id: conversation.id,
              role: "assistant",
              content: maskedAnswer,
              citations,
              model: null
            });
            const knowledgeTask = await recordNoCitationTask({
              conversation_id: conversation.id,
              message_id: assistantMessage.id,
              question,
              answer: maskedAnswer,
              citations,
              created_by: user.id,
              knowledge_base_names: knowledgeBaseNames,
              model: null,
              retrieval_note: retrievalError ?? retrievalDiagnostics.reason
            });

            send({
              type: "done",
              message_id: assistantMessage.id,
              citations,
              model: null,
              knowledge_task_id: knowledgeTask?.id ?? null
            });
            close();
            return;
          }

          if (hits.length > 0) {
            const citations = localRagCitations(hits);
            send({ type: "citations", citations });
            const localRagPrompt = buildLocalRagPrompt({ question, hits });
            const localRagStream = await streamCompatibleChat({
              question: localRagPrompt,
              history,
              hasSearchableKnowledge: true,
              systemOverride:
                "你是企业内部智能客服。必须严格基于用户消息中的企业知识片段回答，不得编造片段外的信息。回答要包含清晰结论，并在末尾列出参考来源编号。"
            });

            if (!localRagStream) {
              const answer = "已找到相关资料，但智能客服服务暂不可用。请联系管理员处理。";
              send({ type: "delta", text: maskSensitiveText(answer) });
              const assistantMessage = await createMessage({
                conversation_id: conversation.id,
                role: "assistant",
                content: maskSensitiveText(answer),
                citations,
                model: null
              });

              send({
                type: "done",
                message_id: assistantMessage.id,
                citations,
                model: null
              });
              close();
              return;
            }

            let answer = "";
            for await (const chunk of localRagStream) {
              const delta = chunk.choices[0]?.delta?.content ?? "";
              if (!delta) {
                continue;
              }

              answer += delta;
              send({ type: "delta", text: maskSensitiveText(delta) });
            }

            const outputSecurity = analyzeModelOutput(answer || "未能生成回答，请稍后重试。");
            const model = compatibleChatModelLabel(localRagStream);
            const assistantMessage = await createMessage({
              conversation_id: conversation.id,
              role: "assistant",
              content: outputSecurity.maskedText,
              citations,
              model
            });
            await recordChatModelUsage({
              source_id: assistantMessage.id,
              conversation_id: conversation.id,
              user_id: user.id,
              provider: modelProviderFromLabel(model),
              model: modelNameFromLabel(model),
              inputText: joinUsageText([localRagPrompt, history]),
              outputText: outputSecurity.maskedText,
              metadata: {
                mode: "stream",
                rag_provider: "local_text",
                retrieval_strategy: localRagStrategyId,
                citations_count: citations.length,
                retrieval_confidence: retrievalDiagnostics.confidence,
                retrieval_top_score: retrievalDiagnostics.topScore,
                retrieval_reason: retrievalDiagnostics.reason,
                model_attempts: compatibleChatAttempts(localRagStream),
                knowledge_base_ids: knowledgeBases.map((kb) => kb.id)
              }
            });
            await recordSecurityFindings({
              findings: outputSecurity.findings,
              user,
              conversation_id: conversation.id,
              message_id: assistantMessage.id
            });
            const knowledgeTask = await recordNoCitationTask({
              conversation_id: conversation.id,
              message_id: assistantMessage.id,
              question,
              answer: outputSecurity.maskedText,
              citations,
              created_by: user.id,
              knowledge_base_names: knowledgeBaseNames,
              model,
              retrieval_note: retrievalDiagnostics.reason
            });

            send({
              type: "done",
              message_id: assistantMessage.id,
              citations,
              model,
              knowledge_task_id: knowledgeTask?.id ?? null
            });
            close();
            return;
          }
        }

        const responseStream = await streamAnswerWithFileSearch({
          question,
          history,
          vectorStoreIds
        });

        if (!responseStream) {
          const compatibleStream = vectorStoreIds.length === 0
            ? await streamCompatibleChat({
                question,
                history,
                hasSearchableKnowledge: false
              })
            : null;

          if (compatibleStream) {
            const prefix = `当前没有可用公司资料作为依据，以下内容仅供临时参考。\n\n`;
            let compatibleAnswer = prefix;
              send({ type: "delta", text: maskSensitiveText(prefix) });

            for await (const chunk of compatibleStream) {
              const delta = chunk.choices[0]?.delta?.content ?? "";
              if (!delta) {
                continue;
              }

              compatibleAnswer += delta;
              send({ type: "delta", text: maskSensitiveText(delta) });
            }

            const outputSecurity = analyzeModelOutput(compatibleAnswer);
            const model = compatibleChatModelLabel(compatibleStream);
            const assistantMessage = await createMessage({
              conversation_id: conversation.id,
              role: "assistant",
              content: outputSecurity.maskedText,
              citations: [],
              model
            });
            await recordChatModelUsage({
              source_id: assistantMessage.id,
              conversation_id: conversation.id,
              user_id: user.id,
              provider: modelProviderFromLabel(model),
              model: modelNameFromLabel(model),
              inputText: joinUsageText([question, history]),
              outputText: outputSecurity.maskedText,
              metadata: {
                mode: "stream",
                rag_provider: "compatible_fallback",
                citations_count: 0,
                model_attempts: compatibleChatAttempts(compatibleStream),
                knowledge_base_ids: knowledgeBases.map((kb) => kb.id)
              }
            });
            await recordSecurityFindings({
              findings: outputSecurity.findings,
              user,
              conversation_id: conversation.id,
              message_id: assistantMessage.id
            });
            const knowledgeTask = await recordNoCitationTask({
              conversation_id: conversation.id,
              message_id: assistantMessage.id,
              question,
              answer: outputSecurity.maskedText,
              citations: [],
              created_by: user.id,
              knowledge_base_names: knowledgeBaseNames,
              model
            });

            send({
              type: "done",
              message_id: assistantMessage.id,
              citations: [],
              model,
              knowledge_task_id: knowledgeTask?.id ?? null
            });
            close();
            return;
          }

          const answer = vectorStoreIds.length === 0
            ? noSearchableAnswer({
                accessibleCount: accessibleKnowledgeBases.length,
                selectedCount: knowledgeBases.length
              })
            : "当前智能客服服务暂不可用。请稍后重试，或联系管理员处理。";
          const maskedAnswer = maskSensitiveText(answer);
          send({ type: "delta", text: maskedAnswer });

          const assistantMessage = await createMessage({
            conversation_id: conversation.id,
            role: "assistant",
            content: maskedAnswer,
            citations: [],
            model: null
          });
          const knowledgeTask = await recordNoCitationTask({
            conversation_id: conversation.id,
            message_id: assistantMessage.id,
            question,
            answer: maskedAnswer,
            citations: [],
            created_by: user.id,
            knowledge_base_names: knowledgeBaseNames,
            model: null
          });

          send({
            type: "done",
            message_id: assistantMessage.id,
            citations: [],
            model: null,
            knowledge_task_id: knowledgeTask?.id ?? null
          });
          close();
          return;
        }

        let answer = "";
        let citations: Citation[] = [];
        const annotationEvents: unknown[] = [];
        let responseUsage: unknown = null;

        for await (const event of responseStream) {
          if (event.type === "response.output_text.delta") {
            answer += event.delta;
            send({ type: "delta", text: maskSensitiveText(event.delta) });
          }

          if (event.type === "response.output_text.annotation.added") {
            annotationEvents.push(event.annotation);
            citations = extractCitationsFromAnnotations(annotationEvents);
            send({ type: "citations", citations });
          }

          if (event.type === "response.completed") {
            responseUsage = event.response.usage ?? null;
            citations = extractCitations(event.response);
            if (citations.length === 0) {
              citations = extractCitationsFromAnnotations(annotationEvents);
            }
          }

          if (event.type === "response.failed") {
            send({ type: "error", error: "回答生成失败，请稍后重试或联系管理员。" });
            close();
            return;
          }
        }

        const outputSecurity = analyzeModelOutput(answer || "未能生成回答，请稍后重试。");
        const assistantMessage = await createMessage({
          conversation_id: conversation.id,
          role: "assistant",
          content: outputSecurity.maskedText,
          citations,
          model: env.openaiChatModel
        });
        await recordChatModelUsage({
          source_id: assistantMessage.id,
          conversation_id: conversation.id,
          user_id: user.id,
          provider: "openai",
          model: env.openaiChatModel,
          usage: responseUsage,
          inputText: joinUsageText([question, history]),
          outputText: outputSecurity.maskedText,
          metadata: {
            mode: "stream",
            rag_provider: "openai_file_search",
            citations_count: citations.length,
            knowledge_base_ids: knowledgeBases.map((kb) => kb.id)
          }
        });
        await recordSecurityFindings({
          findings: outputSecurity.findings,
          user,
          conversation_id: conversation.id,
          message_id: assistantMessage.id
        });
        const knowledgeTask = await recordNoCitationTask({
          conversation_id: conversation.id,
          message_id: assistantMessage.id,
          question,
          answer: outputSecurity.maskedText,
          citations,
          created_by: user.id,
          knowledge_base_names: knowledgeBaseNames,
          model: env.openaiChatModel
        });

        send({
          type: "done",
          message_id: assistantMessage.id,
          citations,
          model: env.openaiChatModel,
          knowledge_task_id: knowledgeTask?.id ?? null
        });
        close();
      } catch (error) {
        console.error("[chat-stream]", error);
        send({ type: "error", error: "对话暂时失败，请稍后重试或联系管理员。" });
        close();
      }
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      Connection: "keep-alive"
    }
  });
}
