type ProviderHeadersInput = {
  apiKey: string;
  authHeader?: string;
  extraHeaders?: string;
  contentType?: string;
};

export function buildProviderHeaders(input: ProviderHeadersInput) {
  const headers: Record<string, string> = {};

  if (input.contentType) {
    headers["Content-Type"] = input.contentType;
  }

  const authHeader = (input.authHeader || "Authorization").trim();
  if (input.apiKey && authHeader && authHeader.toLowerCase() !== "none") {
    headers[authHeader] = authHeader.toLowerCase() === "authorization"
      ? `Bearer ${input.apiKey}`
      : input.apiKey;
  }

  return {
    ...headers,
    ...parseExtraHeaders(input.extraHeaders, input.apiKey)
  };
}

export function renderJsonTemplate(template: string | undefined, variables: Record<string, unknown>, fallback: Record<string, unknown>) {
  const trimmed = template?.trim();
  if (!trimmed) {
    return fallback;
  }

  const rendered = replaceVariables(normalizeTemplateJson(trimmed), variables);

  try {
    const parsed = JSON.parse(rendered) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("模板根节点必须是 JSON 对象");
    }

    return removeUndefinedValues(parsed as Record<string, unknown>);
  } catch (error) {
    throw new Error(`请求体模板不是合法 JSON：${error instanceof Error ? error.message : "解析失败"}`);
  }
}

function normalizeTemplateJson(value: string) {
  if (!value.includes('\\"')) {
    return value;
  }

  return value
    .replace(/\\"/g, '"')
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t");
}

function replaceVariables(value: string, variables: Record<string, unknown>) {
  return value.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key: string) => {
    const variable = variables[key];

    if (variable === null || variable === undefined) {
      return "";
    }

    if (key.endsWith("_json") && typeof variable === "string") {
      return variable;
    }

    if (typeof variable === "string") {
      return JSON.stringify(variable).slice(1, -1);
    }

    if (typeof variable === "number" || typeof variable === "boolean") {
      return String(variable);
    }

    return JSON.stringify(variable);
  });
}

function removeUndefinedValues(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entryValue]) => entryValue !== undefined)
      .map(([key, entryValue]) => {
        if (entryValue && typeof entryValue === "object" && !Array.isArray(entryValue)) {
          return [key, removeUndefinedValues(entryValue as Record<string, unknown>)];
        }

        return [key, entryValue];
      })
  );
}

function parseExtraHeaders(value: string | undefined, apiKey: string) {
  const trimmed = value?.trim();
  if (!trimmed) {
    return {};
  }

  const replaceVariables = (input: string) => input
    .replaceAll("{{api_key}}", apiKey)
    .replaceAll("{api_key}", apiKey);

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return Object.fromEntries(
        Object.entries(parsed as Record<string, unknown>)
          .filter(([key, headerValue]) => key.trim() && headerValue !== null && headerValue !== undefined)
          .map(([key, headerValue]) => [key.trim(), replaceVariables(String(headerValue))])
      );
    }
  } catch {
    // Fall through to line parser.
  }

  return Object.fromEntries(
    trimmed
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const separatorIndex = line.indexOf(":");
        if (separatorIndex === -1) {
          return null;
        }

        const key = line.slice(0, separatorIndex).trim();
        const headerValue = line.slice(separatorIndex + 1).trim();
        return key ? [key, replaceVariables(headerValue)] : null;
      })
      .filter((entry): entry is [string, string] => Boolean(entry))
  );
}
