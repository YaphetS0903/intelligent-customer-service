import { NextResponse } from "next/server";
import {
  createMessage,
  canAccessDocument,
  createModelUsageEvent,
  createSecurityEvent,
  getCurrentUser,
  listAccessibleKnowledgeBases,
  listDocuments,
  listMessages,
  upsertConversation
} from "@/lib/db";
import { completeCompatibleChat, compatibleChatAttempts, compatibleChatModelLabel } from "@/lib/compatible-chat";
import { isLocalTextRag } from "@/lib/config";
import { createNoCitationKnowledgeTask } from "@/lib/no-citation-task";
import { joinUsageText, modelNameFromLabel, modelProviderFromLabel, normalizeModelUsage } from "@/lib/model-usage";
import { answerWithFileSearch } from "@/lib/openai-rag";
import {
  buildLocalRagPrompt,
  configuredLocalRagStrategyId,
  evaluateLocalRagHits,
  localRagCitations,
  localRagNoEvidenceAnswer,
  searchLocalTextRag
} from "@/lib/local-rag";
import { detectSecurityEventBurst } from "@/lib/security-monitor";
import {
  analyzeModelOutput,
  analyzeUserInput,
  buildAbnormalAccessEvent,
  buildSecurityEvent
} from "@/lib/security-audit";
import { executeChatBusinessTool } from "@/lib/integrations/chat-tool-intent";
import { linkToolExecutionMessage } from "@/lib/integrations/tool-store";

function noSearchableAnswer(input: { accessibleCount: number; selectedCount: number }) {
  if (input.accessibleCount === 0) {
    return "当前账号暂无可用资料。请联系管理员确认账号资料范围。";
  }

  if (input.selectedCount === 0) {
    return "本次选择的资料范围暂无可用内容。请换一个范围，或联系管理员确认资料是否已处理完成。";
  }

  return "当前可访问资料还没有处理完成。请稍后重试，或联系管理员确认资料状态。";
}

async function recordNoCitationTask(input: Parameters<typeof createNoCitationKnowledgeTask>[0]) {
  const taskPromise = createNoCitationKnowledgeTask(input).catch((error) => {
    console.error("[chat:no-citation-task]", error);
    return null;
  });

  return Promise.race([
    taskPromise,
    new Promise<null>((resolve) => {
      setTimeout(() => resolve(null), 1800);
    })
  ]);
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const rawQuestion = String(body.message ?? "").trim();

    if (!rawQuestion) {
      return NextResponse.json({ error: "请输入问题" }, { status: 400 });
    }

    const user = await getCurrentUser();
    const inputSecurity = analyzeUserInput(rawQuestion);
    const question = inputSecurity.maskedText;
    const conversation = await upsertConversation(question, body.conversation_id);

    const userMessage = await createMessage({
      conversation_id: conversation.id,
      role: "user",
      content: question,
      citations: [],
      model: null
    });
    await Promise.all(inputSecurity.findings.map((finding) =>
      createSecurityEvent(buildSecurityEvent({
        finding,
        user,
        conversation_id: conversation.id,
        message_id: userMessage.id
      })).catch(() => null)
    ));
    await detectSecurityEventBurst({
      user,
      conversation_id: conversation.id,
      message_id: userMessage.id
    }).catch(() => null);

    const history = (await listMessages(conversation.id))
      .filter((message) => message.id !== userMessage.id)
      .map((message) => ({
        role: message.role,
        content: message.content
      }));

    const selectedKnowledgeBaseIds = Array.isArray(body.knowledge_base_ids)
      ? body.knowledge_base_ids.map((id: unknown) => String(id)).filter(Boolean)
      : [];
    const accessibleKnowledgeBases = await listAccessibleKnowledgeBases(user);
    const knowledgeBases = selectedKnowledgeBaseIds.length > 0
      ? accessibleKnowledgeBases.filter((kb) => selectedKnowledgeBaseIds.includes(kb.id))
      : accessibleKnowledgeBases;
    const knowledgeBaseNames = knowledgeBases.map((kb) => kb.name);

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
      return NextResponse.json({ error: "所选资料范围不可访问" }, { status: 403 });
    }

    const businessTool = await executeChatBusinessTool({ question, user, conversationId: conversation.id });
    if (businessTool) {
      const assistantMessage = await createMessage({
        conversation_id: conversation.id,
        role: "assistant",
        content: businessTool.content,
        citations: [],
        model: null,
        metadata: businessTool.metadata
      });
      if (businessTool.execution_id) await linkToolExecutionMessage(businessTool.execution_id, assistantMessage.id).catch(() => undefined);
      return NextResponse.json({ conversation, messages: [userMessage, assistantMessage], knowledge_task_id: null });
    }

    const documents = (await listDocuments()).filter((document) => canAccessDocument(user, document));
    const accessibleDocumentIds = new Set(documents.map((document) => document.id));
    const searchableKnowledgeBases = knowledgeBases.filter((kb) =>
      documents.some((document) => document.knowledge_base_id === kb.id && document.status === "ready")
    );
    const vectorStoreIds = searchableKnowledgeBases
      .map((kb) => kb.openai_vector_store_id)
      .filter((id): id is string => Boolean(id));

    if (isLocalTextRag()) {
      let retrievalError: string | null = null;
      const localRagStrategyId = configuredLocalRagStrategyId();
      const hits = searchableKnowledgeBases.length > 0
        ? await searchLocalTextRag({
            question,
            knowledgeBases: searchableKnowledgeBases,
            limit: 6,
            allowedDocumentIds: [...accessibleDocumentIds],
            strategyId: localRagStrategyId
          }).catch((error) => {
            retrievalError = error instanceof Error ? error.message : "知识库检索失败";
            console.error("[chat:local-rag]", error);
            return [];
          })
        : [];
      const retrievalDiagnostics = evaluateLocalRagHits(hits);
      const citations = retrievalDiagnostics.hasEvidence
        ? localRagCitations(hits)
        : hits.length > 0
          ? localRagCitations(hits.slice(0, 3))
          : [];
      const prompt = retrievalDiagnostics.hasEvidence
        ? buildLocalRagPrompt({ question, hits })
        : question;
      const completion = retrievalDiagnostics.hasEvidence
        ? await completeCompatibleChat({
            question: prompt,
            history,
            hasSearchableKnowledge: true,
            systemOverride:
              "你是企业内部智能客服。必须严格基于用户消息中的企业知识片段回答，不得编造片段外的信息。回答要包含清晰结论，并在末尾列出参考来源编号。"
          })
        : null;
      const model = retrievalDiagnostics.hasEvidence ? compatibleChatModelLabel(completion) : null;
      const answer = retrievalDiagnostics.hasEvidence
        ? completion?.choices[0]?.message?.content?.trim() || "已检索到知识片段，但对话模型未返回有效回答。"
        : retrievalError
          ? "知识库检索暂时失败，请稍后重试。系统已避免在没有可靠资料依据时生成回答。"
        : searchableKnowledgeBases.length > 0
          ? localRagNoEvidenceAnswer(retrievalDiagnostics)
          : noSearchableAnswer({
              accessibleCount: accessibleKnowledgeBases.length,
              selectedCount: knowledgeBases.length
            });
      const outputSecurity = analyzeModelOutput(answer);
      const assistantMessage = await createMessage({
        conversation_id: conversation.id,
        role: "assistant",
        content: outputSecurity.maskedText,
        citations,
        model
      });

      if (model || completion?.usage) {
        const usage = normalizeModelUsage({
          usage: completion?.usage,
          inputText: joinUsageText([prompt, history]),
          outputText: outputSecurity.maskedText
        });
        await createModelUsageEvent({
          source: "chat",
          source_id: assistantMessage.id,
          conversation_id: conversation.id,
          user_id: user.id,
          provider: modelProviderFromLabel(model),
          model: modelNameFromLabel(model),
          ...usage,
          metadata: {
            mode: "non_stream",
            rag_provider: "local_text",
            retrieval_strategy: localRagStrategyId,
            citations_count: citations.length,
            retrieval_confidence: retrievalDiagnostics.confidence,
            retrieval_top_score: retrievalDiagnostics.topScore,
            retrieval_reason: retrievalError ?? retrievalDiagnostics.reason,
            retrieval_error: retrievalError,
            model_attempts: compatibleChatAttempts(completion),
            knowledge_base_ids: knowledgeBases.map((kb) => kb.id)
          }
        }).catch((error) => {
          console.error("[chat:usage]", error);
        });
      }

      await Promise.all(outputSecurity.findings.map((finding) =>
        createSecurityEvent(buildSecurityEvent({
          finding,
          user,
          conversation_id: conversation.id,
          message_id: assistantMessage.id
        })).catch(() => null)
      ));
      await detectSecurityEventBurst({
        user,
        conversation_id: conversation.id,
        message_id: assistantMessage.id
      }).catch(() => null);
      const knowledgeTask = await recordNoCitationTask({
        conversation_id: conversation.id,
        message_id: assistantMessage.id,
        question,
        answer: outputSecurity.maskedText,
        citations,
        created_by: user.id,
        knowledge_base_names: knowledgeBaseNames,
        model,
        retrieval_note: retrievalError ?? retrievalDiagnostics.reason
      });

      return NextResponse.json({
        conversation,
        messages: [userMessage, assistantMessage],
        knowledge_task_id: knowledgeTask?.id ?? null
      });
    }

    const result = vectorStoreIds.length > 0
      ? await answerWithFileSearch({
          question,
          history,
          vectorStoreIds
        })
      : {
          answer: noSearchableAnswer({
            accessibleCount: accessibleKnowledgeBases.length,
            selectedCount: knowledgeBases.length
          }),
          citations: [],
          model: null,
          usage: null
        };

    const outputSecurity = analyzeModelOutput(result.answer);
    const assistantMessage = await createMessage({
      conversation_id: conversation.id,
      role: "assistant",
      content: outputSecurity.maskedText,
      citations: result.citations,
      model: result.model
    });
    if (result.model || result.usage) {
      const usage = normalizeModelUsage({
        usage: result.usage,
        inputText: joinUsageText([question, history]),
        outputText: outputSecurity.maskedText
      });
      await createModelUsageEvent({
        source: "chat",
        source_id: assistantMessage.id,
        conversation_id: conversation.id,
        user_id: user.id,
        provider: result.model ? "openai" : null,
        model: result.model,
        ...usage,
        metadata: {
          mode: "non_stream",
          rag_provider: "openai_file_search",
          citations_count: result.citations.length,
          knowledge_base_ids: knowledgeBases.map((kb) => kb.id)
        }
      }).catch((error) => {
        console.error("[chat:usage]", error);
      });
    }
    await Promise.all(outputSecurity.findings.map((finding) =>
      createSecurityEvent(buildSecurityEvent({
        finding,
        user,
        conversation_id: conversation.id,
        message_id: assistantMessage.id
      })).catch(() => null)
    ));
    await detectSecurityEventBurst({
      user,
      conversation_id: conversation.id,
      message_id: assistantMessage.id
    }).catch(() => null);
    const knowledgeTask = await recordNoCitationTask({
      conversation_id: conversation.id,
      message_id: assistantMessage.id,
      question,
      answer: outputSecurity.maskedText,
      citations: result.citations,
      created_by: user.id,
      knowledge_base_names: knowledgeBaseNames,
      model: result.model
    });

    return NextResponse.json({
      conversation,
      messages: [userMessage, assistantMessage],
      knowledge_task_id: knowledgeTask?.id ?? null
    });
  } catch (error) {
    console.error("[chat]", error);
    return NextResponse.json(
      { error: "对话暂时失败，请稍后重试或联系管理员。" },
      { status: 400 }
    );
  }
}
