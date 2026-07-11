import { env, hasSsoConfig } from "@/lib/config";

export const ssoStateCookieName = "tr_sso_state";
export const ssoNextCookieName = "tr_sso_next";

export type SsoUserInfo = {
  subject: string;
  email: string;
  name: string;
  department: string;
  raw: Record<string, unknown>;
};

export function isSsoEnabled() {
  return hasSsoConfig();
}

export function getSsoRedirectUri() {
  return `${env.appBaseUrl.replace(/\/$/, "")}/api/auth/sso/callback`;
}

export function createSsoState() {
  return crypto.randomUUID();
}

export function buildSsoAuthorizeUrl(state: string) {
  if (!hasSsoConfig()) {
    throw new Error("未配置统一登录。请先在系统配置中填写 SSO/OIDC 参数。");
  }

  const url = new URL(env.ssoAuthorizeUrl);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", env.ssoClientId);
  url.searchParams.set("redirect_uri", getSsoRedirectUri());
  url.searchParams.set("scope", env.ssoScopes);
  url.searchParams.set("state", state);
  return url;
}

export async function exchangeSsoCode(code: string) {
  if (!hasSsoConfig()) {
    throw new Error("未配置统一登录。请先在系统配置中填写 SSO/OIDC 参数。");
  }

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: getSsoRedirectUri(),
    client_id: env.ssoClientId,
    client_secret: env.ssoClientSecret
  });
  const response = await fetch(env.ssoTokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;

  if (!response.ok) {
    throw new Error(readString(payload, ["error_description", "error", "message"]) ?? `SSO Token 换取失败：${response.status}`);
  }

  const accessToken = readString(payload, ["access_token"]);
  if (!accessToken) {
    throw new Error("SSO Token 响应缺少 access_token。");
  }

  return accessToken;
}

export async function fetchSsoUserInfo(accessToken: string): Promise<SsoUserInfo> {
  const response = await fetch(env.ssoUserinfoUrl, {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;

  if (!response.ok) {
    throw new Error(readString(payload, ["error_description", "error", "message"]) ?? `SSO 用户信息读取失败：${response.status}`);
  }

  const subject = readString(payload, ["sub", "id", "uid", "user_id", "openid"]);
  const email = readString(payload, ["email", "mail", "preferred_username", "username"]);
  const name = readString(payload, ["name", "display_name", "nickname", "realname"]) ?? email?.split("@")[0] ?? "";
  const department = readString(payload, ["department", "dept", "organization", "org"]) ?? env.ssoDefaultDepartment;

  if (!subject) {
    throw new Error("SSO 用户信息缺少 sub/id 字段。");
  }

  if (!email || !email.includes("@")) {
    throw new Error("SSO 用户信息缺少有效邮箱字段。");
  }

  return {
    subject,
    email: email.toLowerCase(),
    name,
    department,
    raw: payload
  };
}

function readString(payload: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return null;
}
