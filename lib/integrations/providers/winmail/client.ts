import { createHash } from "node:crypto";
import { getWinmailConfig } from "@/lib/integrations/config";

export type WinmailResponse = {
  result?: string | number;
  info?: { sessid?: string; email?: string; fullname?: string } & Record<string, unknown>;
  error?: string;
  msg?: string;
  message?: string;
  [key: string]: unknown;
};

let sessionCache: { sessid: string; fingerprint: string; expiresAt: number } | null = null;
const mailboxSessionCache = new Map<string, { sessid: string; fingerprint: string; expiresAt: number }>();

export async function testWinmailConnection() {
  const startedAt = Date.now();
  const sessid = await getWinmailSession(true);
  return { latency_ms: Date.now() - startedAt, session_ready: Boolean(sessid) };
}

export async function sendWinmailMessage(input: { to: string; subject: string; text: string; html?: boolean; cc?: string }) {
  const config = getWinmailConfig();
  if (!config.enabled) throw new Error("Winmail 连接器未启用");
  const recipients = normalizeRecipients(input.to);
  if (!recipients) throw new Error("请填写有效收件人");
  const sessid = await getWinmailSession(false);
  return winmailRequest({
    method: "newmsg.send",
    sessid,
    to: recipients,
    cc: normalizeRecipients(input.cc ?? ""),
    subject: safeHeader(input.subject).slice(0, 200),
    msgbody: input.text,
    ishtml: input.html ? "1" : "0",
    priority: "0",
    requestnotify: "0",
    savetosent: "1",
    from: `${safeHeader(config.senderName)}<${config.senderUser}>`
  });
}

export async function verifyWinmailMailboxCredentials(email: string, password: string) {
  const response = await loginWinmailMailbox(email, password, true);
  return {
    email: String(response.info?.email ?? "").trim().toLowerCase(),
    user: String(response.info?.uid ?? "").trim(),
    name: String(response.info?.fullname ?? "").trim()
  };
}

export async function fetchWinmailMailboxUnread(email: string, password: string) {
  return withMailboxSession(email, password, (sessid) => winmailRequest({ method: "msgnum", sessid }, false));
}

export async function fetchWinmailInboxPage(email: string, password: string, page: number) {
  return withMailboxSession(email, password, (sessid) => winmailRequest({
    method: "msglist",
    sessid,
    folder: "INBOX",
    pag: String(Math.max(1, Math.trunc(page)))
  }, false));
}

async function getWinmailSession(forceRefresh: boolean) {
  const config = getWinmailConfig();
  if (!config.configured) throw new Error("Winmail API 或专用发件账号未配置");
  assertSafeWinmailUrl(config.apiUrl, config.allowInsecureHttp);
  const fingerprint = `${config.apiUrl}:${config.apiKey}:${config.senderUser}:${config.senderPassword.slice(-4)}`;
  if (!forceRefresh && sessionCache && sessionCache.fingerprint === fingerprint && sessionCache.expiresAt > Date.now()) return sessionCache.sessid;
  const response = await winmailRequest({ method: "login", user: config.senderUser, pass: config.senderPassword }, false);
  const sessid = String(response.info?.sessid ?? "");
  if (!sessid) throw new Error("Winmail 登录成功但未返回 sessid");
  sessionCache = { sessid, fingerprint, expiresAt: Date.now() + 25 * 60 * 1000 };
  return sessid;
}

async function withMailboxSession<T>(email: string, password: string, operation: (sessid: string) => Promise<T>) {
  const normalizedEmail = email.trim().toLowerCase();
  let session = await loginWinmailMailbox(normalizedEmail, password, false);
  try {
    return await operation(String(session.info?.sessid ?? ""));
  } catch (error) {
    if (!/session|sessid|login|expire|登录|会话/i.test(error instanceof Error ? error.message : String(error))) throw error;
    mailboxSessionCache.delete(normalizedEmail);
    session = await loginWinmailMailbox(normalizedEmail, password, true);
    return operation(String(session.info?.sessid ?? ""));
  }
}

async function loginWinmailMailbox(email: string, password: string, forceRefresh: boolean) {
  const config = getWinmailConfig();
  if (!config.enabled || !config.apiKey || !config.apiSecret) throw new Error("Winmail 个人邮箱接口未配置");
  if (!email || !password) throw new Error("邮箱账号或密码为空");
  const normalizedEmail = email.trim().toLowerCase();
  const fingerprint = createHash("sha256").update(`${config.apiUrl}:${normalizedEmail}:${password}`).digest("hex");
  const cached = mailboxSessionCache.get(normalizedEmail);
  if (!forceRefresh && cached?.fingerprint === fingerprint && cached.expiresAt > Date.now()) {
    return { result: "ok", info: { sessid: cached.sessid, email: normalizedEmail } } satisfies WinmailResponse;
  }
  const response = await winmailRequest({ method: "login", user: normalizedEmail, pass: password }, false);
  const sessid = String(response.info?.sessid ?? "");
  if (!sessid) throw new Error("Winmail 登录成功但未返回 sessid");
  mailboxSessionCache.set(normalizedEmail, { sessid, fingerprint, expiresAt: Date.now() + 25 * 60 * 1000 });
  if (mailboxSessionCache.size > 500) mailboxSessionCache.delete(mailboxSessionCache.keys().next().value ?? "");
  return response;
}

async function winmailRequest(params: Record<string, string>, retrySession = true): Promise<WinmailResponse> {
  const config = getWinmailConfig();
  assertSafeWinmailUrl(config.apiUrl, config.allowInsecureHttp);
  const signed = signWinmailParams(params, config.apiKey, config.apiSecret);
  const response = await fetch(config.apiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8", Accept: "application/json", "User-Agent": "tianrui-integration/1.0" },
    body: new URLSearchParams(signed),
    redirect: "error",
    cache: "no-store",
    signal: AbortSignal.timeout(config.timeoutMs)
  });
  const text = await response.text();
  let data: WinmailResponse;
  try { data = JSON.parse(text) as WinmailResponse; } catch { throw new Error(`Winmail 返回非 JSON 数据（HTTP ${response.status}）`); }
  if (!response.ok) throw new Error(`Winmail HTTP ${response.status}`);
  if (String(data.result).toLowerCase() !== "ok") {
    const message = String(data.error || data.msg || data.message || data.result || "Winmail 请求失败");
    if (retrySession && /session|sessid|login|expire/i.test(message)) {
      sessionCache = null;
      return winmailRequest({ ...params, sessid: await getWinmailSession(true) }, false);
    }
    throw new Error(`Winmail: ${message}`);
  }
  return data;
}

export function signWinmailParams(params: Record<string, string>, apiKey: string, apiSecret: string, timestamp = Math.floor(Date.now() / 1000)) {
  if (!apiKey || !apiSecret) throw new Error("Winmail ApiKey 或 ApiSecret 未配置");
  const values: Record<string, string> = { ...params, apikey: apiKey, timestamp: String(timestamp) };
  const source = Object.keys(values).sort().reduce((text, key) => `${text}${key}${values[key]}`, apiSecret) + apiSecret;
  return { ...values, sign: createHash("md5").update(source, "utf8").digest("hex") };
}

function assertSafeWinmailUrl(value: string, allowInsecureHttp: boolean) {
  if (!value) throw new Error("Winmail API URL 未配置");
  const url = new URL(value);
  if (!/^\/.*openapi\.php$/i.test(url.pathname)) throw new Error("Winmail API URL 必须指向 openapi.php");
  if (url.protocol !== "https:" && !(allowInsecureHttp && url.protocol === "http:")) throw new Error("Winmail 必须使用 HTTPS；仅受控内网可显式允许 HTTP");
}

function normalizeRecipients(value: string) {
  return value.split(/[;,]/).map((item) => item.trim().toLowerCase()).filter((item) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item)).join(";");
}

function safeHeader(value: string) {
  return value.replace(/[\r\n]+/g, " ").trim();
}
