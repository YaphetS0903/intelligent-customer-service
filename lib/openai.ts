import OpenAI from "openai";
import { env, hasChatModelConfig, hasOpenAIConfig } from "@/lib/config";

let cachedClient: OpenAI | null = null;
let cachedChatClient: OpenAI | null = null;
const cachedFallbackClients = new Map<string, OpenAI>();

export type ChatEndpointRole = "primary" | "fallback";

export type ChatEndpointConfig = {
  role: ChatEndpointRole;
  index: number;
  provider: "openai" | "custom";
  providerLabel: string;
  baseURL: string | null;
  apiKey: string;
  model: string;
  label: string;
};

export function getOpenAIClient() {
  if (!hasOpenAIConfig()) {
    return null;
  }

  cachedClient ??= new OpenAI({
    apiKey: env.openaiApiKey
  });

  return cachedClient;
}

export function getChatClient() {
  if (!hasChatModelConfig()) {
    return null;
  }

  if (env.aiChatProvider === "custom") {
    cachedChatClient ??= new OpenAI({
      apiKey: env.aiChatApiKey,
      baseURL: env.aiChatBaseUrl
    });

    return cachedChatClient;
  }

  return getOpenAIClient();
}

export function getChatClientForEndpoint(endpoint: ChatEndpointConfig) {
  if (endpoint.provider === "openai") {
    return getOpenAIClient();
  }

  const key = `${endpoint.baseURL ?? ""}|${endpoint.apiKey}`;
  let client = cachedFallbackClients.get(key);

  if (!client) {
    client = new OpenAI({
      apiKey: endpoint.apiKey,
      baseURL: endpoint.baseURL ?? undefined
    });
    cachedFallbackClients.set(key, client);
  }

  return client;
}

export function getChatModel() {
  return env.aiChatProvider === "custom" ? env.aiChatModel : env.openaiChatModel;
}

export function getChatProviderLabel() {
  return env.aiChatProvider === "custom" ? "自定义兼容模型" : "OpenAI";
}

export function getChatEndpointConfigs() {
  const endpoints: ChatEndpointConfig[] = [];

  if (hasChatModelConfig()) {
    const provider = env.aiChatProvider === "custom" ? "custom" : "openai";
    const model = getChatModel();
    endpoints.push({
      role: "primary",
      index: 0,
      provider,
      providerLabel: getChatProviderLabel(),
      baseURL: provider === "custom" ? env.aiChatBaseUrl : null,
      apiKey: provider === "custom" ? env.aiChatApiKey : env.openaiApiKey,
      model,
      label: `${getChatProviderLabel()} / ${model}`
    });
  }

  addFallbackEndpoint(endpoints, 1, {
    provider: env.aiChatFallback1Provider,
    baseURL: env.aiChatFallback1BaseUrl,
    apiKey: env.aiChatFallback1ApiKey,
    model: env.aiChatFallback1Model
  });
  addFallbackEndpoint(endpoints, 2, {
    provider: env.aiChatFallback2Provider,
    baseURL: env.aiChatFallback2BaseUrl,
    apiKey: env.aiChatFallback2ApiKey,
    model: env.aiChatFallback2Model
  });

  return endpoints;
}

function addFallbackEndpoint(
  endpoints: ChatEndpointConfig[],
  index: 1 | 2,
  input: {
    provider: string;
    baseURL: string;
    apiKey: string;
    model: string;
  }
) {
  if (input.provider !== "openai" && input.provider !== "custom") {
    return;
  }

  if (input.provider === "openai") {
    if (!env.openaiApiKey || !input.model) {
      return;
    }

    endpoints.push({
      role: "fallback",
      index,
      provider: "openai",
      providerLabel: `备用 ${index} OpenAI`,
      baseURL: null,
      apiKey: env.openaiApiKey,
      model: input.model,
      label: `备用 ${index} OpenAI / ${input.model}`
    });
    return;
  }

  if (!input.baseURL || !input.apiKey || !input.model) {
    return;
  }

  endpoints.push({
    role: "fallback",
    index,
    provider: "custom",
    providerLabel: `备用 ${index} 自定义兼容模型`,
    baseURL: input.baseURL,
    apiKey: input.apiKey,
    model: input.model,
    label: `备用 ${index} 自定义兼容模型 / ${input.model}`
  });
}

export function resetOpenAIClient() {
  cachedClient = null;
  cachedChatClient = null;
  cachedFallbackClients.clear();
}
