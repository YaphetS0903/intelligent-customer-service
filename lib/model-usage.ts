type RawUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  input_tokens?: number;
  output_tokens?: number;
  total_tokens_details?: unknown;
};

export type NormalizedModelUsage = {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  estimated: boolean;
  cost_usd: number | null;
};

export function estimateTokensFromText(text: string) {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return 0;
  }

  const cjkChars = normalized.match(/[\u3400-\u9fff\uf900-\ufaff]/g)?.length ?? 0;
  const nonCjkChars = normalized.replace(/[\u3400-\u9fff\uf900-\ufaff]/g, "").length;

  return Math.max(1, cjkChars + Math.ceil(nonCjkChars / 4));
}

export function joinUsageText(parts: Array<unknown>) {
  return parts
    .flatMap((part) => {
      if (Array.isArray(part)) {
        return part;
      }

      return [part];
    })
    .map((part) => {
      if (typeof part === "string") {
        return part;
      }

      if (!part) {
        return "";
      }

      try {
        return JSON.stringify(part);
      } catch {
        return String(part);
      }
    })
    .filter(Boolean)
    .join("\n\n");
}

export function normalizeModelUsage(input: {
  usage?: unknown;
  inputText: string;
  outputText: string;
}): NormalizedModelUsage {
  const actual = normalizeRawUsage(input.usage);
  const inputTokens = actual?.input_tokens ?? estimateTokensFromText(input.inputText);
  const outputTokens = actual?.output_tokens ?? estimateTokensFromText(input.outputText);
  const totalTokens = actual?.total_tokens ?? inputTokens + outputTokens;
  const estimated = !actual;

  return {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens: totalTokens,
    estimated,
    cost_usd: estimateCostUsd(inputTokens, outputTokens)
  };
}

export function normalizeRawUsage(usage: unknown): Omit<NormalizedModelUsage, "estimated" | "cost_usd"> | null {
  if (!usage || typeof usage !== "object") {
    return null;
  }

  const raw = usage as RawUsage;
  const inputTokens = toTokenNumber(raw.input_tokens ?? raw.prompt_tokens);
  const outputTokens = toTokenNumber(raw.output_tokens ?? raw.completion_tokens);
  const totalTokens = toTokenNumber(raw.total_tokens);

  if (inputTokens === null && outputTokens === null && totalTokens === null) {
    return null;
  }

  const input = inputTokens ?? Math.max((totalTokens ?? 0) - (outputTokens ?? 0), 0);
  const output = outputTokens ?? Math.max((totalTokens ?? 0) - input, 0);

  return {
    input_tokens: input,
    output_tokens: output,
    total_tokens: totalTokens ?? input + output
  };
}

export function modelProviderFromLabel(label: string | null | undefined) {
  if (!label) {
    return null;
  }

  const [provider] = label.split("/").map((part) => part.trim());
  return provider || null;
}

export function modelNameFromLabel(label: string | null | undefined) {
  if (!label) {
    return null;
  }

  const parts = label.split("/").map((part) => part.trim()).filter(Boolean);
  return parts.at(-1) ?? label;
}

function toTokenNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.round(number) : null;
}

function estimateCostUsd(inputTokens: number, outputTokens: number) {
  const inputPrice = Number(
    process.env.MODEL_INPUT_PRICE_PER_1M_TOKENS ??
      process.env.AI_INPUT_PRICE_PER_1M_TOKENS ??
      "0"
  );
  const outputPrice = Number(
    process.env.MODEL_OUTPUT_PRICE_PER_1M_TOKENS ??
      process.env.AI_OUTPUT_PRICE_PER_1M_TOKENS ??
      "0"
  );

  if (!Number.isFinite(inputPrice + outputPrice) || inputPrice <= 0 && outputPrice <= 0) {
    return null;
  }

  const cost = inputTokens * inputPrice / 1_000_000 + outputTokens * outputPrice / 1_000_000;
  return Number(cost.toFixed(8));
}
