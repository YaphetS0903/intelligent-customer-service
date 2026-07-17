import { promises as fs } from "node:fs";
import path from "node:path";
import type { IntegrationProvider } from "@/lib/integrations/types";

const envPath = path.join(process.cwd(), ".env.local");

const providerKeys = {
  wecom: [
    "WECOM_ENABLED",
    "WECOM_SSO_ENABLED",
    "WECOM_NOTIFICATION_ENABLED",
    "WECOM_CORP_ID",
    "WECOM_CORP_SECRET",
    "WECOM_AGENT_ID",
    "WECOM_API_BASE_URL",
    "WECOM_ROOT_DEPARTMENT_ID",
    "WECOM_SYNC_PROFILE_FIELDS",
    "WECOM_AUTO_PROVISION_USERS",
    "WECOM_DIRECTORY_SYNC_ENABLED",
    "WECOM_DIRECTORY_SYNC_INTERVAL_MINUTES"
  ],
  winmail: [
    "WINMAIL_ENABLED",
    "WINMAIL_NOTIFICATION_ENABLED",
    "WINMAIL_API_URL",
    "WINMAIL_API_KEY",
    "WINMAIL_API_SECRET",
    "WINMAIL_SENDER_USER",
    "WINMAIL_SENDER_PASSWORD",
    "WINMAIL_SENDER_NAME",
    "WINMAIL_ALLOW_INSECURE_HTTP",
    "WINMAIL_TIMEOUT_MS"
  ]
} as const;

const secretKeys = new Set([
  "WECOM_CORP_SECRET",
  "WECOM_SYNC_CRON_SECRET",
  "WINMAIL_API_SECRET",
  "WINMAIL_SENDER_PASSWORD"
]);
const preserveWhenBlankKeys = new Set([
  ...secretKeys,
  "WECOM_CORP_ID",
  "WINMAIL_API_KEY",
  "WINMAIL_SENDER_USER"
]);

export type IntegrationConfigInput = Record<string, string | boolean | number | undefined>;

export function getWecomConfig() {
  const baseUrl = normalizeBaseUrl(process.env.WECOM_API_BASE_URL || "https://qyapi.weixin.qq.com");
  const corpId = process.env.WECOM_CORP_ID?.trim() ?? "";
  const corpSecret = process.env.WECOM_CORP_SECRET?.trim() ?? "";
  const agentId = process.env.WECOM_AGENT_ID?.trim() ?? "";
  return {
    enabled: process.env.WECOM_ENABLED === "true",
    ssoEnabled: process.env.WECOM_SSO_ENABLED === "true",
    notificationEnabled: process.env.WECOM_NOTIFICATION_ENABLED === "true",
    configured: Boolean(corpId && corpSecret),
    notificationConfigured: Boolean(corpId && corpSecret && agentId),
    corpId,
    corpSecret,
    agentId,
    baseUrl,
    rootDepartmentId: positiveInt(process.env.WECOM_ROOT_DEPARTMENT_ID, 1),
    syncProfileFields: process.env.WECOM_SYNC_PROFILE_FIELDS === "true",
    autoProvisionUsers: process.env.WECOM_AUTO_PROVISION_USERS === "true",
    directorySyncEnabled: process.env.WECOM_DIRECTORY_SYNC_ENABLED === "true",
    directorySyncIntervalMinutes: boundedInt(process.env.WECOM_DIRECTORY_SYNC_INTERVAL_MINUTES, 30, 15, 1440),
    syncCronSecret: process.env.WECOM_SYNC_CRON_SECRET?.trim() ?? ""
  };
}

export function getWinmailConfig() {
  const apiUrl = process.env.WINMAIL_API_URL?.trim() ?? "";
  const apiKey = process.env.WINMAIL_API_KEY?.trim() ?? "";
  const apiSecret = process.env.WINMAIL_API_SECRET?.trim() ?? "";
  const senderUser = process.env.WINMAIL_SENDER_USER?.trim() ?? "";
  const senderPassword = process.env.WINMAIL_SENDER_PASSWORD?.trim() ?? "";
  return {
    enabled: process.env.WINMAIL_ENABLED === "true",
    notificationEnabled: process.env.WINMAIL_NOTIFICATION_ENABLED === "true",
    configured: Boolean(apiUrl && apiKey && apiSecret && senderUser && senderPassword),
    apiUrl,
    apiKey,
    apiSecret,
    senderUser,
    senderPassword,
    senderName: process.env.WINMAIL_SENDER_NAME?.trim() || "天瑞智能客服",
    allowInsecureHttp: process.env.WINMAIL_ALLOW_INSECURE_HTTP === "true",
    timeoutMs: positiveInt(process.env.WINMAIL_TIMEOUT_MS, 8000)
  };
}

export function getPublicIntegrationConfigs() {
  const wecom = getWecomConfig();
  const winmail = getWinmailConfig();
  return {
    wecom: {
      enabled: wecom.enabled,
      sso_enabled: wecom.ssoEnabled,
      notification_enabled: wecom.notificationEnabled,
      configured: wecom.configured,
      notification_configured: wecom.notificationConfigured,
      corp_id_masked: maskValue(wecom.corpId),
      corp_secret_configured: Boolean(wecom.corpSecret),
      agent_id: wecom.agentId,
      api_base_url: wecom.baseUrl,
      root_department_id: wecom.rootDepartmentId,
      sync_profile_fields: wecom.syncProfileFields,
      auto_provision_users: wecom.autoProvisionUsers,
      directory_sync_enabled: wecom.directorySyncEnabled,
      directory_sync_interval_minutes: wecom.directorySyncIntervalMinutes,
      sync_cron_secret_configured: wecom.syncCronSecret.length >= 32
    },
    winmail: {
      enabled: winmail.enabled,
      notification_enabled: winmail.notificationEnabled,
      configured: winmail.configured,
      api_url: winmail.apiUrl,
      api_key_masked: maskValue(winmail.apiKey),
      api_secret_configured: Boolean(winmail.apiSecret),
      sender_user_masked: maskEmail(winmail.senderUser),
      sender_password_configured: Boolean(winmail.senderPassword),
      sender_name: winmail.senderName,
      allow_insecure_http: winmail.allowInsecureHttp,
      timeout_ms: winmail.timeoutMs
    }
  };
}

export async function saveIntegrationConfig(provider: IntegrationProvider, input: IntegrationConfigInput) {
  const keys = providerKeys[provider];
  const previous = await fs.readFile(envPath, "utf8").catch(() => "");
  const lines = previous ? previous.split(/\r?\n/) : [];
  const replacements = new Map<string, string>();

  for (const key of keys) {
    const raw = input[key];
    if (raw === undefined) continue;
    const value = typeof raw === "boolean" ? String(raw) : String(raw).trim();
    if (preserveWhenBlankKeys.has(key) && !value) continue;
    validateSetting(key, value);
    replacements.set(key, value);
  }

  const seen = new Set<string>();
  const nextLines = lines.map((line) => {
    const key = envLineKey(line);
    if (!key || !replacements.has(key)) return line;
    seen.add(key);
    return `${key}=${quoteEnv(replacements.get(key) ?? "")}`;
  });

  for (const [key, value] of replacements) {
    if (!seen.has(key)) nextLines.push(`${key}=${quoteEnv(value)}`);
    process.env[key] = value;
  }

  const content = `${nextLines.join("\n").replace(/\n+$/g, "")}\n`;
  await fs.writeFile(envPath, content, { encoding: "utf8", mode: 0o600 });
  return getPublicIntegrationConfigs()[provider];
}

function validateSetting(key: string, value: string) {
  if (["WECOM_ENABLED", "WECOM_SSO_ENABLED", "WECOM_NOTIFICATION_ENABLED", "WECOM_SYNC_PROFILE_FIELDS", "WECOM_AUTO_PROVISION_USERS", "WECOM_DIRECTORY_SYNC_ENABLED", "WINMAIL_ENABLED", "WINMAIL_NOTIFICATION_ENABLED", "WINMAIL_ALLOW_INSECURE_HTTP"].includes(key)) {
    if (!["true", "false"].includes(value)) throw new Error(`${key} 只能为 true 或 false`);
  }
  if (["WECOM_AGENT_ID", "WECOM_ROOT_DEPARTMENT_ID", "WINMAIL_TIMEOUT_MS"].includes(key) && value && (!/^\d+$/.test(value) || Number(value) <= 0)) {
    throw new Error(`${key} 必须为正整数`);
  }
  if (key === "WECOM_DIRECTORY_SYNC_INTERVAL_MINUTES" && value && (!/^\d+$/.test(value) || Number(value) < 15 || Number(value) > 1440)) {
    throw new Error("WECOM_DIRECTORY_SYNC_INTERVAL_MINUTES 必须在 15 到 1440 之间");
  }
  if (["WECOM_API_BASE_URL", "WINMAIL_API_URL"].includes(key) && value) {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) throw new Error(`${key} 必须是 HTTP(S) 地址`);
  }
}

function envLineKey(line: string) {
  const normalized = line.trim().replace(/^export\s+/, "");
  const index = normalized.indexOf("=");
  return index > 0 ? normalized.slice(0, index).trim() : "";
}

function quoteEnv(value: string) {
  if (!value || /[\s#'"\\]/.test(value)) return JSON.stringify(value);
  return value;
}

function positiveInt(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function boundedInt(value: string | undefined, fallback: number, min: number, max: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? Math.min(Math.max(parsed, min), max) : fallback;
}

function normalizeBaseUrl(value: string) {
  return value.replace(/\/+$/, "");
}

export function maskValue(value: string) {
  if (!value) return "";
  if (value.length <= 6) return `${value.slice(0, 1)}***${value.slice(-1)}`;
  return `${value.slice(0, 3)}***${value.slice(-3)}`;
}

export function maskEmail(value: string) {
  const [local, domain] = value.split("@");
  if (!domain) return maskValue(value);
  return `${local.slice(0, 2)}***@${domain}`;
}
