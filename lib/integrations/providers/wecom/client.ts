import { getWecomConfig } from "@/lib/integrations/config";

type WecomApiResponse = { errcode?: number; errmsg?: string };
type WecomSendResponse = WecomApiResponse & {
  msgid?: string;
  invaliduser?: string;
  invalidparty?: string;
  invalidtag?: string;
  response_code?: string;
};
export type WecomDepartment = { id: number; name: string; name_en?: string; parentid: number; order?: number };
export type WecomUser = {
  userid: string;
  name: string;
  department: number[];
  order?: number[];
  position?: string;
  mobile?: string;
  gender?: string;
  email?: string;
  biz_mail?: string;
  avatar?: string;
  status?: number;
  enable?: number;
  alias?: string;
  telephone?: string;
  address?: string;
  main_department?: number;
};

export type WecomLoginIdentity = {
  userid: string;
  user_ticket?: string;
  user_doc_ticket?: string;
};

let tokenCache: { value: string; expiresAt: number; fingerprint: string } | null = null;
let jsApiTicketCache: { value: string; expiresAt: number; fingerprint: string } | null = null;

export async function testWecomConnection() {
  const startedAt = Date.now();
  const token = await getAccessToken();
  const response = await wecomGet<WecomApiResponse & { department?: WecomDepartment[] }>("/cgi-bin/department/list", { access_token: token });
  return { latency_ms: Date.now() - startedAt, department_count: response.department?.length ?? 0 };
}

export async function fetchWecomDirectory() {
  const config = getWecomConfig();
  const token = await getAccessToken();
  const [departmentResponse, userResponse] = await Promise.all([
    wecomGet<WecomApiResponse & { department?: WecomDepartment[] }>("/cgi-bin/department/list", { access_token: token }),
    wecomGet<WecomApiResponse & { userlist?: WecomUser[] }>("/cgi-bin/user/list", {
      access_token: token,
      department_id: String(config.rootDepartmentId),
      fetch_child: "1"
    })
  ]);
  return {
    departments: departmentResponse.department ?? [],
    users: userResponse.userlist ?? []
  };
}

export async function sendWecomTextCard(input: { toUser: string; title: string; description: string; url: string }) {
  const config = getWecomConfig();
  if (!config.notificationConfigured) throw new Error("企业微信应用消息缺少 AgentID 或应用凭据");
  const token = await getAccessToken();
  const response = await wecomPost<WecomSendResponse>("/cgi-bin/message/send", { access_token: token }, {
    touser: input.toUser,
    msgtype: "textcard",
    agentid: Number(config.agentId),
    textcard: {
      title: input.title.slice(0, 128),
      description: input.description.slice(0, 512),
      url: input.url,
      btntxt: "查看详情"
    },
    enable_duplicate_check: 1,
    duplicate_check_interval: 1800
  });
  if (response.invaliduser) throw new Error(`企业微信接收账号无效：${response.invaliduser}`);
  return response;
}

export async function fetchWecomLoginIdentity(code: string): Promise<WecomLoginIdentity> {
  const token = await getAccessToken();
  const response = await wecomGet<WecomApiResponse & Partial<WecomLoginIdentity> & { openid?: string }>(
    "/cgi-bin/auth/getuserinfo",
    { access_token: token, code }
  );
  if (!response.userid) {
    throw new Error(response.openid ? "当前微信账号不是本企业成员，请使用企业微信账号登录。" : "企业微信未返回成员身份，请重新登录。");
  }
  return {
    userid: response.userid,
    user_ticket: response.user_ticket,
    user_doc_ticket: response.user_doc_ticket
  };
}

export async function fetchWecomJsApiTicket() {
  const config = getWecomConfig();
  const fingerprint = `${config.baseUrl}:${config.corpId}:${config.corpSecret.slice(-6)}`;
  if (jsApiTicketCache && jsApiTicketCache.fingerprint === fingerprint && jsApiTicketCache.expiresAt > Date.now() + 60_000) {
    return jsApiTicketCache.value;
  }

  const token = await getAccessToken();
  const response = await wecomGet<WecomApiResponse & { ticket?: string; expires_in?: number }>("/cgi-bin/get_jsapi_ticket", {
    access_token: token
  });
  if (!response.ticket) throw new Error("企业微信未返回 JS-SDK ticket");
  jsApiTicketCache = {
    value: response.ticket,
    expiresAt: Date.now() + Math.max(300, Number(response.expires_in ?? 7200) - 120) * 1000,
    fingerprint
  };
  return jsApiTicketCache.value;
}

async function getAccessToken() {
  const config = getWecomConfig();
  if (!config.configured) throw new Error("企业微信 CorpID 或 CorpSecret 未配置");
  assertSafeWecomBaseUrl(config.baseUrl);
  const fingerprint = `${config.baseUrl}:${config.corpId}:${config.corpSecret.slice(-6)}`;
  if (tokenCache && tokenCache.fingerprint === fingerprint && tokenCache.expiresAt > Date.now() + 60_000) return tokenCache.value;
  const response = await wecomGet<WecomApiResponse & { access_token?: string; expires_in?: number }>("/cgi-bin/gettoken", {
    corpid: config.corpId,
    corpsecret: config.corpSecret
  });
  if (!response.access_token) throw new Error("企业微信未返回 access_token");
  tokenCache = {
    value: response.access_token,
    expiresAt: Date.now() + Math.max(300, Number(response.expires_in ?? 7200) - 120) * 1000,
    fingerprint
  };
  return tokenCache.value;
}

async function wecomGet<T extends WecomApiResponse>(pathname: string, params: Record<string, string>) {
  const config = getWecomConfig();
  assertSafeWecomBaseUrl(config.baseUrl);
  const url = new URL(pathname, `${config.baseUrl}/`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const response = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "tianrui-integration/1.0" },
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(8000)
  });
  const data = await response.json().catch(() => ({})) as T;
  if (!response.ok) throw new Error(`企业微信 HTTP ${response.status}`);
  if (Number(data.errcode ?? 0) !== 0) throw new Error(`企业微信 ${data.errcode}: ${data.errmsg || "请求失败"}`);
  return data;
}

async function wecomPost<T extends WecomApiResponse>(pathname: string, params: Record<string, string>, body: unknown) {
  const config = getWecomConfig();
  assertSafeWecomBaseUrl(config.baseUrl);
  const url = new URL(pathname, `${config.baseUrl}/`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const response = await fetch(url, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json", "User-Agent": "tianrui-integration/1.0" },
    body: JSON.stringify(body),
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(8000)
  });
  const data = await response.json().catch(() => ({})) as T;
  if (!response.ok) throw new Error(`企业微信 HTTP ${response.status}`);
  if (Number(data.errcode ?? 0) !== 0) throw new Error(`企业微信 ${data.errcode}: ${data.errmsg || "请求失败"}`);
  return data;
}

function assertSafeWecomBaseUrl(value: string) {
  const url = new URL(value);
  const extraHosts = (process.env.INTEGRATION_ALLOWED_HOSTS ?? "").split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);
  const developmentHosts = process.env.NODE_ENV === "production" ? [] : ["localhost", "127.0.0.1"];
  const allowed = new Set(["qyapi.weixin.qq.com", ...extraHosts, ...developmentHosts]);
  if (url.protocol !== "https:" && !developmentHosts.includes(url.hostname)) throw new Error("企业微信 API 必须使用 HTTPS");
  if (!allowed.has(url.hostname.toLowerCase())) throw new Error("企业微信 API 主机不在允许列表");
}
