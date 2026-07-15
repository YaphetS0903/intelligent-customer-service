import { getWecomConfig } from "@/lib/integrations/config";

type WecomApiResponse = { errcode?: number; errmsg?: string };
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

let tokenCache: { value: string; expiresAt: number; fingerprint: string } | null = null;

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

function assertSafeWecomBaseUrl(value: string) {
  const url = new URL(value);
  const extraHosts = (process.env.INTEGRATION_ALLOWED_HOSTS ?? "").split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);
  const developmentHosts = process.env.NODE_ENV === "production" ? [] : ["localhost", "127.0.0.1"];
  const allowed = new Set(["qyapi.weixin.qq.com", ...extraHosts, ...developmentHosts]);
  if (url.protocol !== "https:" && !developmentHosts.includes(url.hostname)) throw new Error("企业微信 API 必须使用 HTTPS");
  if (!allowed.has(url.hostname.toLowerCase())) throw new Error("企业微信 API 主机不在允许列表");
}
