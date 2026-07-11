import {
  type ChatEndpointConfig,
  getChatClientForEndpoint,
  getChatEndpointConfigs,
  getChatModel,
  getChatProviderLabel
} from "@/lib/openai";

export type CompatibleChatAttempt = {
  label: string;
  provider: string;
  model: string;
  role: "primary" | "fallback";
  index: number;
  ok: boolean;
  error: string | null;
};

type CompatibleResultMetadata = {
  __endpoint?: ChatEndpointConfig;
  __attempts?: CompatibleChatAttempt[];
};

export function buildCompatibleChatMessages(input: {
  question: string;
  history: { role: "user" | "assistant"; content: string }[];
  hasSearchableKnowledge: boolean;
  systemOverride?: string;
}) {
  const guardrail = input.systemOverride ?? (input.hasSearchableKnowledge
    ? "如果没有检索工具返回的企业资料，不要声称已经查询知识库。"
    : "当前没有可检索企业资料。你可以回答通用建议，但必须明确说明这不是基于企业知识库的正式依据。");

  return [
    {
      role: "system" as const,
      content: `你是企业内部智能客服。回答要简洁、准确、中文优先。${guardrail}`
    },
    ...input.history.slice(-8).map((message) => ({
      role: message.role,
      content: message.content
    })),
    {
      role: "user" as const,
      content: input.question
    }
  ];
}

export async function streamCompatibleChat(input: {
  question: string;
  history: { role: "user" | "assistant"; content: string }[];
  hasSearchableKnowledge: boolean;
  systemOverride?: string;
}) {
  const endpoints = getChatEndpointConfigs();

  if (endpoints.length === 0) {
    return null;
  }

  const messages = buildCompatibleChatMessages(input);
  const attempts: CompatibleChatAttempt[] = [];

  for (const endpoint of endpoints) {
    const client = getChatClientForEndpoint(endpoint);
    if (!client) {
      continue;
    }

    try {
      const stream = await client.chat.completions.create({
        model: endpoint.model,
        messages,
        stream: true
      });
      attachCompatibleMetadata(stream, endpoint, [...attempts, toAttempt(endpoint, true, null)]);
      return stream;
    } catch (error) {
      attempts.push(toAttempt(endpoint, false, error instanceof Error ? error.message : "模型调用失败"));
    }
  }

  throw createCompatibleChatError(attempts);
}

export async function completeCompatibleChat(input: {
  question: string;
  history: { role: "user" | "assistant"; content: string }[];
  hasSearchableKnowledge: boolean;
  systemOverride?: string;
}) {
  const endpoints = getChatEndpointConfigs();

  if (endpoints.length === 0) {
    return null;
  }

  const messages = buildCompatibleChatMessages(input);
  const attempts: CompatibleChatAttempt[] = [];

  for (const endpoint of endpoints) {
    const client = getChatClientForEndpoint(endpoint);
    if (!client) {
      continue;
    }

    try {
      const completion = await client.chat.completions.create({
        model: endpoint.model,
        messages
      });
      attachCompatibleMetadata(completion, endpoint, [...attempts, toAttempt(endpoint, true, null)]);
      return completion;
    } catch (error) {
      attempts.push(toAttempt(endpoint, false, error instanceof Error ? error.message : "模型调用失败"));
    }
  }

  throw createCompatibleChatError(attempts);
}

export function compatibleChatModelLabel(result?: unknown) {
  const metadata = compatibleMetadata(result);

  if (metadata?.__endpoint) {
    return metadata.__endpoint.label;
  }

  const model = getChatModel();
  return model ? `${getChatProviderLabel()} / ${model}` : null;
}

export function compatibleChatAttempts(result?: unknown) {
  return compatibleMetadata(result)?.__attempts ?? [];
}

function attachCompatibleMetadata<T extends object>(
  result: T,
  endpoint: ChatEndpointConfig,
  attempts: CompatibleChatAttempt[]
) {
  Object.defineProperty(result, "__endpoint", {
    value: endpoint,
    enumerable: false
  });
  Object.defineProperty(result, "__attempts", {
    value: attempts,
    enumerable: false
  });
}

function toAttempt(endpoint: ChatEndpointConfig, ok: boolean, error: string | null): CompatibleChatAttempt {
  return {
    label: endpoint.label,
    provider: endpoint.provider,
    model: endpoint.model,
    role: endpoint.role,
    index: endpoint.index,
    ok,
    error
  };
}

function formatAttemptErrors(attempts: CompatibleChatAttempt[]) {
  if (attempts.length === 0) {
    return "没有可用的对话模型配置。";
  }

  return `所有对话模型均调用失败：${attempts.map((attempt) =>
    `${attempt.label}：${attempt.error ?? "未知错误"}`
  ).join("；")}`;
}

function createCompatibleChatError(attempts: CompatibleChatAttempt[]) {
  const error = new Error(formatAttemptErrors(attempts));
  Object.defineProperty(error, "__attempts", {
    value: attempts,
    enumerable: false
  });
  return error;
}

function compatibleMetadata(result: unknown): CompatibleResultMetadata | null {
  if (!result || typeof result !== "object") {
    return null;
  }

  return result as CompatibleResultMetadata;
}
