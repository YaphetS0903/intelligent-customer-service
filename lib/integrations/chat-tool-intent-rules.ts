export function detectBusinessToolIntent(question: string) {
  const normalized = question.replace(/\s+/g, " ").trim();
  if (!/(邮件|邮箱|收件箱)/.test(normalized)) return null;
  if (/(未读).*(多少|几封|数量|有没有)|(多少|几封).*(未读)/.test(normalized)) {
    return { toolId: "winmail.unread_count", params: {} };
  }
  if (!/(查|查询|看看|找|搜索|最近|今天|昨天|未读|收件箱)/.test(normalized)) return null;
  const params: Record<string, unknown> = { limit: extractLimit(normalized), unread_only: /未读/.test(normalized) };
  const sender = firstMatch(normalized, [/(?:来自|发件人(?:是|为)?)[：:]?\s*([^，。,.]{1,40})/, /([^，。,.]{1,40})发(?:来|的)的?邮件/]);
  const subject = firstMatch(normalized, [/(?:主题(?:包含|是|为)?)[：:]?\s*([^，。,.]{1,60})/, /关于([^，。,.]{1,60}?)(?:的)?邮件/]);
  if (sender) params.sender = trimQueryValue(sender);
  if (subject) params.subject = trimQueryValue(subject);
  const range = extractDateRange(normalized);
  if (range) Object.assign(params, range);
  return { toolId: "winmail.search_inbox", params };
}

function extractLimit(value: string) {
  const match = value.match(/(?:最近|前|查|看)\s*(\d{1,2})\s*封/);
  return Math.min(Math.max(Number(match?.[1] ?? 10), 1), 20);
}

function extractDateRange(value: string) {
  const now = new Date();
  const chinaNow = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const start = new Date(Date.UTC(chinaNow.getUTCFullYear(), chinaNow.getUTCMonth(), chinaNow.getUTCDate()) - 8 * 60 * 60 * 1000);
  if (/今天/.test(value)) return { date_from: start.toISOString(), date_to: now.toISOString() };
  if (/昨天/.test(value)) return { date_from: new Date(start.getTime() - 86_400_000).toISOString(), date_to: new Date(start.getTime() - 1).toISOString() };
  const days = value.match(/最近\s*(\d{1,2})\s*天/);
  if (days) return { date_from: new Date(now.getTime() - Math.min(Number(days[1]), 90) * 86_400_000).toISOString(), date_to: now.toISOString() };
  return null;
}

function firstMatch(value: string, patterns: RegExp[]) {
  for (const pattern of patterns) {
    const match = value.match(pattern);
    if (match?.[1]) return match[1];
  }
  return "";
}

function trimQueryValue(value: string) {
  return value.replace(/(?:最近|今天|昨天|未读|邮件|邮箱|收件箱|帮我|请|查一下|查询).*$/g, "").replace(/(?:发来|发的|的)$/g, "").trim();
}
