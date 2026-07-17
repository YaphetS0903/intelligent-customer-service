import { env, isMySqlDatabase } from "@/lib/config";
import { getWecomConfig } from "@/lib/integrations/config";

export const wecomSsoStateCookieName = "tr_wecom_sso_state";
export const wecomSsoNextCookieName = "tr_wecom_sso_next";
const externalStateMaxAgeSeconds = 120;

type ExternalStatePayload = {
  exp: number;
  next: string;
  nonce: string;
};

export function isWecomSsoEnabled() {
  const config = getWecomConfig();
  return isMySqlDatabase() && config.enabled && config.ssoEnabled && config.configured && Boolean(config.agentId);
}

export function createWecomSsoState() {
  return crypto.randomUUID();
}

export function getWecomSsoRedirectUri() {
  return `${env.appBaseUrl.replace(/\/$/, "")}/api/auth/wecom/callback`;
}

export function getWecomExternalRedirectUri() {
  return `${env.appBaseUrl.replace(/\/$/, "")}/api/auth/wecom/external/callback`;
}

export function getWecomSsoAppOrigin() {
  return new URL(env.appBaseUrl).origin;
}

export function isWecomClient(userAgent: string | null) {
  return /wxwork/i.test(userAgent ?? "");
}

export function buildWecomAuthorizeUrl(state: string, mode: "web" | "client") {
  if (!isWecomSsoEnabled()) {
    throw new Error("企业微信单点登录尚未启用，请联系管理员。");
  }

  const config = getWecomConfig();
  if (mode === "client") {
    const url = new URL("https://open.weixin.qq.com/connect/oauth2/authorize");
    url.searchParams.set("appid", config.corpId);
    url.searchParams.set("redirect_uri", getWecomSsoRedirectUri());
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", "snsapi_base");
    url.searchParams.set("state", state);
    url.searchParams.set("agentid", config.agentId);
    return `${url.toString()}#wechat_redirect`;
  }

  const url = new URL("https://login.work.weixin.qq.com/wwlogin/sso/login");
  url.searchParams.set("login_type", "CorpApp");
  url.searchParams.set("appid", config.corpId);
  url.searchParams.set("agentid", config.agentId);
  url.searchParams.set("redirect_uri", getWecomSsoRedirectUri());
  url.searchParams.set("state", state);
  url.searchParams.set("lang", "zh");
  return url.toString();
}

export async function createWecomExternalState(next: string) {
  const payload: ExternalStatePayload = {
    exp: Math.floor(Date.now() / 1000) + externalStateMaxAgeSeconds,
    next,
    nonce: crypto.randomUUID()
  };
  const encoded = base64UrlEncode(JSON.stringify(payload));
  return `${encoded}.${await signExternalState(encoded)}`;
}

export async function verifyWecomExternalState(value: string | null) {
  if (!value) return null;
  const [encoded, signature] = value.split(".");
  if (!encoded || !signature) return null;
  const expected = await signExternalState(encoded);
  if (!constantTimeEqual(signature, expected)) return null;

  try {
    const payload = JSON.parse(base64UrlDecode(encoded)) as ExternalStatePayload;
    if (!payload.nonce || !payload.next.startsWith("/") || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

export function buildWecomExternalAuthorizeUrl(state: string) {
  if (!isWecomSsoEnabled()) {
    throw new Error("企业微信单点登录尚未启用，请联系管理员。");
  }

  const config = getWecomConfig();
  const url = new URL("https://open.weixin.qq.com/connect/oauth2/authorize");
  url.searchParams.set("appid", config.corpId);
  url.searchParams.set("redirect_uri", getWecomExternalRedirectUri());
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "snsapi_base");
  url.searchParams.set("state", state);
  url.searchParams.set("agentid", config.agentId);
  return `${url.toString()}#wechat_redirect`;
}

function base64UrlEncode(value: string | Uint8Array) {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function base64UrlDecode(value: string) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const bytes = Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

async function signExternalState(value: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.authSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return base64UrlEncode(new Uint8Array(signature));
}

function constantTimeEqual(left: string, right: string) {
  const length = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
}
