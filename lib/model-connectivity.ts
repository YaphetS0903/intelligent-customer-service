import {
  compatibleChatAttempts,
  type CompatibleChatAttempt,
  compatibleChatModelLabel,
  completeCompatibleChat
} from "@/lib/compatible-chat";
import { env } from "@/lib/config";
import { getChatEndpointConfigs } from "@/lib/openai";

export type ModelConnectivityResult = {
  ok: boolean;
  provider: string;
  model: string;
  modelLabel: string | null;
  latency_ms: number;
  answer: string | null;
  error: string | null;
  attempts: CompatibleChatAttempt[];
};

export async function testChatModelConnectivity(): Promise<ModelConnectivityResult> {
  const startedAt = Date.now();
  const provider = env.aiChatProvider;
  const model = provider === "custom" ? env.aiChatModel : env.openaiChatModel;
  const endpoints = getChatEndpointConfigs();

  if (endpoints.length === 0) {
    return {
      ok: false,
      provider,
      model,
      modelLabel: compatibleChatModelLabel(),
      latency_ms: Date.now() - startedAt,
      answer: null,
      error: provider === "custom"
        ? "自定义模型配置不完整，请填写 AI_CHAT_BASE_URL、AI_CHAT_API_KEY 和 AI_CHAT_MODEL。"
        : "OpenAI 模型配置不完整，请填写 OPENAI_API_KEY。",
      attempts: []
    };
  }

  try {
    const completion = await completeCompatibleChat({
      question: "请只回复：模型连通正常",
      history: [],
      hasSearchableKnowledge: false,
      systemOverride: "这是模型连通性测试。请用中文简短回答，不要输出额外说明。"
    });
    const answer = completion?.choices[0]?.message?.content?.trim() ?? "";

    return {
      ok: Boolean(answer),
      provider,
      model,
      modelLabel: compatibleChatModelLabel(),
      latency_ms: Date.now() - startedAt,
      answer: answer || null,
      error: answer ? null : "模型接口返回为空。",
      attempts: compatibleChatAttempts(completion)
    };
  } catch (error) {
    const attempts = error && typeof error === "object" && "__attempts" in error
      ? (error.__attempts as CompatibleChatAttempt[])
      : [];

    return {
      ok: false,
      provider,
      model,
      modelLabel: compatibleChatModelLabel(),
      latency_ms: Date.now() - startedAt,
      answer: null,
      error: error instanceof Error ? error.message : "模型连通性测试失败",
      attempts
    };
  }
}
