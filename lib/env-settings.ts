import { promises as fs } from "fs";
import path from "path";
import { env } from "@/lib/config";
import { resetOpenAIClient } from "@/lib/openai";

export const editableEnvKeys = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_ADMIN_EMAILS",
  "OPENAI_API_KEY",
  "OPENAI_CHAT_MODEL",
  "OPENAI_TTS_MODEL",
  "OPENAI_TTS_VOICE",
  "TTS_PROVIDER",
  "TTS_API_URL",
  "TTS_STATUS_URL",
  "TTS_API_KEY",
  "TTS_AUTH_HEADER",
  "TTS_HEADERS",
  "TTS_PAYLOAD_TEMPLATE",
  "TTS_MODEL",
  "TTS_VOICE",
  "AI_CHAT_PROVIDER",
  "AI_CHAT_BASE_URL",
  "AI_CHAT_API_KEY",
  "AI_CHAT_MODEL",
  "AI_CHAT_FALLBACK_1_PROVIDER",
  "AI_CHAT_FALLBACK_1_BASE_URL",
  "AI_CHAT_FALLBACK_1_API_KEY",
  "AI_CHAT_FALLBACK_1_MODEL",
  "AI_CHAT_FALLBACK_2_PROVIDER",
  "AI_CHAT_FALLBACK_2_BASE_URL",
  "AI_CHAT_FALLBACK_2_API_KEY",
  "AI_CHAT_FALLBACK_2_MODEL",
  "OCR_PROVIDER",
  "OCR_API_URL",
  "OCR_API_KEY",
  "OCR_AUTH_HEADER",
  "OCR_HEADERS",
  "OCR_REQUEST_FORMAT",
  "OCR_FILE_FIELD",
  "OCR_MODEL_FIELD",
  "OCR_PROVIDER_FIELD",
  "OCR_PAYLOAD_TEMPLATE",
  "OCR_MODEL",
  "RAG_PROVIDER",
  "RAG_RETRIEVAL_STRATEGY",
  "DIGITAL_HUMAN_PROVIDER",
  "DIGITAL_HUMAN_API_URL",
  "DIGITAL_HUMAN_STATUS_URL",
  "DIGITAL_HUMAN_API_KEY",
  "DIGITAL_HUMAN_AUTH_HEADER",
  "DIGITAL_HUMAN_HEADERS",
  "DIGITAL_HUMAN_PAYLOAD_TEMPLATE",
  "DIGITAL_HUMAN_MODEL",
  "DIGITAL_HUMAN_AVATAR_ID",
  "DIGITAL_HUMAN_VOICE_ID",
  "SSO_PROVIDER",
  "SSO_AUTHORIZE_URL",
  "SSO_TOKEN_URL",
  "SSO_USERINFO_URL",
  "SSO_CLIENT_ID",
  "SSO_CLIENT_SECRET",
  "SSO_SCOPES",
  "SSO_DEFAULT_DEPARTMENT",
  "LDAP_PROVIDER",
  "LDAP_URL",
  "LDAP_BIND_DN",
  "LDAP_BIND_PASSWORD",
  "LDAP_SEARCH_BASE",
  "LDAP_SEARCH_FILTER",
  "LDAP_USER_DN_TEMPLATE",
  "LDAP_EMAIL_ATTRIBUTE",
  "LDAP_NAME_ATTRIBUTE",
  "LDAP_DEPARTMENT_ATTRIBUTE",
  "LDAP_POSITION_ATTRIBUTE",
  "LDAP_DEFAULT_DOMAIN",
  "DATABASE_PROVIDER",
  "MYSQL_HOST",
  "MYSQL_PORT",
  "MYSQL_DATABASE",
  "MYSQL_USER",
  "MYSQL_PASSWORD",
  "AUTH_SECRET",
  "ALLOW_SELF_REGISTRATION",
  "APP_BASE_URL",
  "MAX_UPLOAD_MB"
] as const;

export type EditableEnvKey = (typeof editableEnvKeys)[number];
export type EditableEnvSettings = Record<EditableEnvKey, string>;

const defaultSettings: EditableEnvSettings = {
  NEXT_PUBLIC_SUPABASE_URL: "",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "",
  SUPABASE_SERVICE_ROLE_KEY: "",
  SUPABASE_ADMIN_EMAILS: "",
  OPENAI_API_KEY: "",
  OPENAI_CHAT_MODEL: "gpt-5.5",
  OPENAI_TTS_MODEL: "gpt-4o-mini-tts",
  OPENAI_TTS_VOICE: "coral",
  TTS_PROVIDER: "openai",
  TTS_API_URL: "",
  TTS_STATUS_URL: "",
  TTS_API_KEY: "",
  TTS_AUTH_HEADER: "Authorization",
  TTS_HEADERS: "",
  TTS_PAYLOAD_TEMPLATE: "",
  TTS_MODEL: "",
  TTS_VOICE: "",
  AI_CHAT_PROVIDER: "openai",
  AI_CHAT_BASE_URL: "",
  AI_CHAT_API_KEY: "",
  AI_CHAT_MODEL: "",
  AI_CHAT_FALLBACK_1_PROVIDER: "none",
  AI_CHAT_FALLBACK_1_BASE_URL: "",
  AI_CHAT_FALLBACK_1_API_KEY: "",
  AI_CHAT_FALLBACK_1_MODEL: "",
  AI_CHAT_FALLBACK_2_PROVIDER: "none",
  AI_CHAT_FALLBACK_2_BASE_URL: "",
  AI_CHAT_FALLBACK_2_API_KEY: "",
  AI_CHAT_FALLBACK_2_MODEL: "",
  OCR_PROVIDER: "none",
  OCR_API_URL: "",
  OCR_API_KEY: "",
  OCR_AUTH_HEADER: "Authorization",
  OCR_HEADERS: "",
  OCR_REQUEST_FORMAT: "multipart",
  OCR_FILE_FIELD: "file",
  OCR_MODEL_FIELD: "model",
  OCR_PROVIDER_FIELD: "provider",
  OCR_PAYLOAD_TEMPLATE: "",
  OCR_MODEL: "",
  RAG_PROVIDER: "openai_file_search",
  RAG_RETRIEVAL_STRATEGY: "balanced",
  DIGITAL_HUMAN_PROVIDER: "none",
  DIGITAL_HUMAN_API_URL: "",
  DIGITAL_HUMAN_STATUS_URL: "",
  DIGITAL_HUMAN_API_KEY: "",
  DIGITAL_HUMAN_AUTH_HEADER: "Authorization",
  DIGITAL_HUMAN_HEADERS: "",
  DIGITAL_HUMAN_PAYLOAD_TEMPLATE: "",
  DIGITAL_HUMAN_MODEL: "",
  DIGITAL_HUMAN_AVATAR_ID: "",
  DIGITAL_HUMAN_VOICE_ID: "",
  SSO_PROVIDER: "none",
  SSO_AUTHORIZE_URL: "",
  SSO_TOKEN_URL: "",
  SSO_USERINFO_URL: "",
  SSO_CLIENT_ID: "",
  SSO_CLIENT_SECRET: "",
  SSO_SCOPES: "openid profile email",
  SSO_DEFAULT_DEPARTMENT: "",
  LDAP_PROVIDER: "none",
  LDAP_URL: "",
  LDAP_BIND_DN: "",
  LDAP_BIND_PASSWORD: "",
  LDAP_SEARCH_BASE: "",
  LDAP_SEARCH_FILTER: "(|(mail={{login}})(uid={{login}})(sAMAccountName={{login}}))",
  LDAP_USER_DN_TEMPLATE: "",
  LDAP_EMAIL_ATTRIBUTE: "mail",
  LDAP_NAME_ATTRIBUTE: "displayName",
  LDAP_DEPARTMENT_ATTRIBUTE: "department",
  LDAP_POSITION_ATTRIBUTE: "title",
  LDAP_DEFAULT_DOMAIN: "",
  DATABASE_PROVIDER: "memory",
  MYSQL_HOST: "",
  MYSQL_PORT: "3306",
  MYSQL_DATABASE: "",
  MYSQL_USER: "",
  MYSQL_PASSWORD: "",
  AUTH_SECRET: "",
  ALLOW_SELF_REGISTRATION: "false",
  APP_BASE_URL: "http://localhost:3000",
  MAX_UPLOAD_MB: "20"
};

const envLocalPath = path.join(process.cwd(), ".env.local");

function parseEnv(content: string) {
  const parsed = new Map<string, string>();

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const normalized = trimmed.startsWith("export ") ? trimmed.slice(7).trimStart() : trimmed;
    const equalIndex = normalized.indexOf("=");

    if (equalIndex === -1) {
      continue;
    }

    const key = normalized.slice(0, equalIndex).trim();
    let value = normalized.slice(equalIndex + 1).trim();

    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    parsed.set(key, value.replace(/\\n/g, "\n"));
  }

  return parsed;
}

function envSnapshot(): EditableEnvSettings {
  return {
    NEXT_PUBLIC_SUPABASE_URL: env.supabaseUrl,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: env.supabaseAnonKey,
    SUPABASE_SERVICE_ROLE_KEY: env.supabaseServiceRoleKey,
    SUPABASE_ADMIN_EMAILS: env.adminEmails.join(","),
    OPENAI_API_KEY: env.openaiApiKey,
    OPENAI_CHAT_MODEL: env.openaiChatModel,
    OPENAI_TTS_MODEL: env.openaiTtsModel,
    OPENAI_TTS_VOICE: env.openaiTtsVoice,
    TTS_PROVIDER: env.ttsProvider,
    TTS_API_URL: env.ttsApiUrl,
    TTS_STATUS_URL: env.ttsStatusUrl,
    TTS_API_KEY: env.ttsApiKey,
    TTS_AUTH_HEADER: env.ttsAuthHeader,
    TTS_HEADERS: env.ttsHeaders,
    TTS_PAYLOAD_TEMPLATE: env.ttsPayloadTemplate,
    TTS_MODEL: env.ttsModel,
    TTS_VOICE: env.ttsVoice,
    AI_CHAT_PROVIDER: env.aiChatProvider,
    AI_CHAT_BASE_URL: env.aiChatBaseUrl,
    AI_CHAT_API_KEY: env.aiChatApiKey,
    AI_CHAT_MODEL: env.aiChatModel,
    AI_CHAT_FALLBACK_1_PROVIDER: env.aiChatFallback1Provider,
    AI_CHAT_FALLBACK_1_BASE_URL: env.aiChatFallback1BaseUrl,
    AI_CHAT_FALLBACK_1_API_KEY: env.aiChatFallback1ApiKey,
    AI_CHAT_FALLBACK_1_MODEL: env.aiChatFallback1Model,
    AI_CHAT_FALLBACK_2_PROVIDER: env.aiChatFallback2Provider,
    AI_CHAT_FALLBACK_2_BASE_URL: env.aiChatFallback2BaseUrl,
    AI_CHAT_FALLBACK_2_API_KEY: env.aiChatFallback2ApiKey,
    AI_CHAT_FALLBACK_2_MODEL: env.aiChatFallback2Model,
    OCR_PROVIDER: env.ocrProvider,
    OCR_API_URL: env.ocrApiUrl,
    OCR_API_KEY: env.ocrApiKey,
    OCR_AUTH_HEADER: env.ocrAuthHeader,
    OCR_HEADERS: env.ocrHeaders,
    OCR_REQUEST_FORMAT: env.ocrRequestFormat,
    OCR_FILE_FIELD: env.ocrFileField,
    OCR_MODEL_FIELD: env.ocrModelField,
    OCR_PROVIDER_FIELD: env.ocrProviderField,
    OCR_PAYLOAD_TEMPLATE: env.ocrPayloadTemplate,
    OCR_MODEL: env.ocrModel,
    RAG_PROVIDER: env.ragProvider,
    RAG_RETRIEVAL_STRATEGY: env.ragRetrievalStrategy,
    DIGITAL_HUMAN_PROVIDER: env.digitalHumanProvider,
    DIGITAL_HUMAN_API_URL: env.digitalHumanApiUrl,
    DIGITAL_HUMAN_STATUS_URL: env.digitalHumanStatusUrl,
    DIGITAL_HUMAN_API_KEY: env.digitalHumanApiKey,
    DIGITAL_HUMAN_AUTH_HEADER: env.digitalHumanAuthHeader,
    DIGITAL_HUMAN_HEADERS: env.digitalHumanHeaders,
    DIGITAL_HUMAN_PAYLOAD_TEMPLATE: env.digitalHumanPayloadTemplate,
    DIGITAL_HUMAN_MODEL: env.digitalHumanModel,
    DIGITAL_HUMAN_AVATAR_ID: env.digitalHumanAvatarId,
    DIGITAL_HUMAN_VOICE_ID: env.digitalHumanVoiceId,
    SSO_PROVIDER: env.ssoProvider,
    SSO_AUTHORIZE_URL: env.ssoAuthorizeUrl,
    SSO_TOKEN_URL: env.ssoTokenUrl,
    SSO_USERINFO_URL: env.ssoUserinfoUrl,
    SSO_CLIENT_ID: env.ssoClientId,
    SSO_CLIENT_SECRET: env.ssoClientSecret,
    SSO_SCOPES: env.ssoScopes,
    SSO_DEFAULT_DEPARTMENT: env.ssoDefaultDepartment,
    LDAP_PROVIDER: env.ldapProvider,
    LDAP_URL: env.ldapUrl,
    LDAP_BIND_DN: env.ldapBindDn,
    LDAP_BIND_PASSWORD: env.ldapBindPassword,
    LDAP_SEARCH_BASE: env.ldapSearchBase,
    LDAP_SEARCH_FILTER: env.ldapSearchFilter,
    LDAP_USER_DN_TEMPLATE: env.ldapUserDnTemplate,
    LDAP_EMAIL_ATTRIBUTE: env.ldapEmailAttribute,
    LDAP_NAME_ATTRIBUTE: env.ldapNameAttribute,
    LDAP_DEPARTMENT_ATTRIBUTE: env.ldapDepartmentAttribute,
    LDAP_POSITION_ATTRIBUTE: env.ldapPositionAttribute,
    LDAP_DEFAULT_DOMAIN: env.ldapDefaultDomain,
    DATABASE_PROVIDER: env.databaseProvider,
    MYSQL_HOST: env.mysqlHost,
    MYSQL_PORT: String(env.mysqlPort),
    MYSQL_DATABASE: env.mysqlDatabase,
    MYSQL_USER: env.mysqlUser,
    MYSQL_PASSWORD: env.mysqlPassword,
    AUTH_SECRET: process.env.AUTH_SECRET ?? "",
    ALLOW_SELF_REGISTRATION: String(env.allowSelfRegistration),
    APP_BASE_URL: env.appBaseUrl,
    MAX_UPLOAD_MB: String(env.maxUploadMb)
  };
}

async function readEnvLocalContent() {
  try {
    return await fs.readFile(envLocalPath, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return "";
    }

    throw error;
  }
}

function quoteEnvValue(value: string) {
  if (!value) {
    return "";
  }

  if (/[\s#"'\\]/.test(value)) {
    return JSON.stringify(value);
  }

  return value;
}

function assertSafeValue(key: EditableEnvKey, value: string) {
  if (value.includes("\n") || value.includes("\r")) {
    throw new Error(`${key} 不能包含换行符`);
  }

  if (key === "MAX_UPLOAD_MB") {
    const size = Number(value);

    if (!Number.isFinite(size) || size <= 0 || size > 200) {
      throw new Error("MAX_UPLOAD_MB 必须是 1-200 之间的数字");
    }
  }

  if (key === "ALLOW_SELF_REGISTRATION" && !["true", "false"].includes(value)) {
    throw new Error("ALLOW_SELF_REGISTRATION 只能是 true 或 false");
  }

  if (key === "AI_CHAT_PROVIDER" && value && !["openai", "custom"].includes(value)) {
    throw new Error("AI_CHAT_PROVIDER 只能是 openai 或 custom");
  }

  if (
    (key === "AI_CHAT_FALLBACK_1_PROVIDER" || key === "AI_CHAT_FALLBACK_2_PROVIDER") &&
    value &&
    !["none", "openai", "custom"].includes(value)
  ) {
    throw new Error(`${key} 只能是 none、openai 或 custom`);
  }

  if (key === "TTS_PROVIDER" && value && !["openai", "custom"].includes(value)) {
    throw new Error("TTS_PROVIDER 只能是 openai 或 custom");
  }

  if (key === "OCR_PROVIDER" && value && !["none", "custom"].includes(value)) {
    throw new Error("OCR_PROVIDER 只能是 none 或 custom");
  }

  if (key === "OCR_REQUEST_FORMAT" && value && !["multipart", "json_base64"].includes(value)) {
    throw new Error("OCR_REQUEST_FORMAT 只能是 multipart 或 json_base64");
  }

  if (key === "RAG_PROVIDER" && value && !["openai_file_search", "local_text"].includes(value)) {
    throw new Error("RAG_PROVIDER 只能是 openai_file_search 或 local_text");
  }

  if (
    key === "RAG_RETRIEVAL_STRATEGY" &&
    value &&
    !["balanced", "content_first", "governance_enhanced", "synonym_expanded"].includes(value)
  ) {
    throw new Error("RAG_RETRIEVAL_STRATEGY 只能是 balanced、content_first、governance_enhanced 或 synonym_expanded");
  }

  if (key === "DIGITAL_HUMAN_PROVIDER" && value && !["none", "custom"].includes(value)) {
    throw new Error("DIGITAL_HUMAN_PROVIDER 只能是 none 或 custom");
  }

  if (key === "SSO_PROVIDER" && value && !["none", "oidc"].includes(value)) {
    throw new Error("SSO_PROVIDER 只能是 none 或 oidc");
  }

  if (key === "LDAP_PROVIDER" && value && !["none", "custom"].includes(value)) {
    throw new Error("LDAP_PROVIDER 只能是 none 或 custom");
  }

  if (key === "DATABASE_PROVIDER" && value && !["memory", "supabase", "mysql"].includes(value)) {
    throw new Error("DATABASE_PROVIDER 只能是 memory、supabase 或 mysql");
  }
}

function normalizeSettings(input: Partial<Record<EditableEnvKey, unknown>>): EditableEnvSettings {
  const normalized = { ...defaultSettings };

  for (const key of editableEnvKeys) {
    const value = input[key];

    if (typeof value !== "string") {
      continue;
    }

    normalized[key] = value.trim();
    assertSafeValue(key, normalized[key]);
  }

  return normalized;
}

export async function readEditableEnvSettings() {
  const fileContent = await readEnvLocalContent();
  const parsed = parseEnv(fileContent);
  const snapshot = envSnapshot();

  for (const key of editableEnvKeys) {
    if (parsed.has(key)) {
      snapshot[key] = parsed.get(key) ?? "";
    }
  }

  return {
    path: envLocalPath,
    exists: fileContent.length > 0,
    settings: snapshot
  };
}

export async function writeEditableEnvSettings(input: Partial<Record<EditableEnvKey, unknown>>) {
  const previous = await readEnvLocalContent();
  const nextSettings = normalizeSettings(input);
  const lines = previous ? previous.split(/\r?\n/) : [];
  const seen = new Set<string>();
  const nextLines = lines.map((line) => {
    const trimmed = line.trim();
    const normalizedLine = trimmed.startsWith("export ") ? trimmed.slice(7).trimStart() : trimmed;
    const equalIndex = normalizedLine.indexOf("=");
    const key = equalIndex === -1 ? "" : normalizedLine.slice(0, equalIndex).trim();

    if (!editableEnvKeys.includes(key as EditableEnvKey)) {
      return line;
    }

    seen.add(key);
    return `${key}=${quoteEnvValue(nextSettings[key as EditableEnvKey])}`;
  });

  if (!previous) {
    nextLines.push("# 本文件由系统配置页生成，可手动修改。");
  }

  for (const key of editableEnvKeys) {
    if (!seen.has(key)) {
      nextLines.push(`${key}=${quoteEnvValue(nextSettings[key])}`);
    }

    process.env[key] = nextSettings[key];
  }

  const nextContent = `${nextLines.join("\n").replace(/\n+$/g, "")}\n`;
  await fs.writeFile(envLocalPath, nextContent, { encoding: "utf8", mode: 0o600 });
  resetOpenAIClient();

  return {
    path: envLocalPath,
    settings: nextSettings
  };
}
