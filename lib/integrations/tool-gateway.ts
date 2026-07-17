import { queryWinmailUnread, searchWinmailInbox } from "@/lib/integrations/providers/winmail/mailbox";
import { getRegisteredTool } from "@/lib/integrations/tool-registry";
import { finishToolExecution, startToolExecution } from "@/lib/integrations/tool-store";
import type { IntegrationToolExecution, WinmailMessageSummary } from "@/lib/integrations/types";
import type { UserProfile } from "@/lib/types";

export class ToolGatewayError extends Error {
  constructor(public code: string, message: string, public status = 400) {
    super(message);
  }
}

export type BusinessToolResult =
  | { type: "winmail_unread"; unread: number; mailbox: string; queried_at: string; scope: string }
  | { type: "winmail_message_list"; messages: WinmailMessageSummary[]; matched: number; inbox_total: number; inbox_unread: number; mailbox: string; queried_at: string; scope: string; filters: Record<string, unknown> };

export async function executeBusinessTool(input: {
  toolId: string;
  user: UserProfile;
  params?: Record<string, unknown>;
  conversationId?: string | null;
  source?: IntegrationToolExecution["source"];
}) {
  const startedAt = Date.now();
  const rawParams = input.params ?? {};
  const tool = await getRegisteredTool(input.toolId);
  if (!tool) throw new ToolGatewayError("TOOL_NOT_FOUND", "业务工具不存在", 404);
  const execution = await startToolExecution({
    tool_id: tool.id,
    connector_id: tool.connector_id,
    user_id: input.user.id,
    conversation_id: input.conversationId ?? null,
    assistant_message_id: null,
    source: input.source ?? "api",
    input_summary: summarizeRawInput(rawParams)
  });

  try {
    const params = validateToolInput(input.toolId, rawParams);
    if (tool.status !== "published") throw new ToolGatewayError("TOOL_DISABLED", "该业务工具当前未启用", 503);
    if (!tool.allowed_roles.includes(input.user.role)) throw new ToolGatewayError("TOOL_FORBIDDEN", "当前账号无权使用该业务工具", 403);
    if (input.user.status !== "active") throw new ToolGatewayError("ACCOUNT_DISABLED", "当前系统账号已被禁用", 403);
    const result = await withTimeout(
      executeWithReadRetry(() => invokeTool(tool.id, input.user.id, params)),
      tool.timeout_ms
    );
    await finishToolExecution(execution.id, {
      status: "success",
      result_summary: summarizeResult(result),
      latency_ms: Date.now() - startedAt
    });
    return { tool, execution: { ...execution, status: "success" as const }, result };
  } catch (error) {
    const normalized = normalizeGatewayError(error);
    await finishToolExecution(execution.id, {
      status: normalized.status === 403 ? "denied" : "failed",
      error_code: normalized.code,
      error_message: normalized.message,
      latency_ms: Date.now() - startedAt
    }).catch(() => undefined);
    throw normalized;
  }
}

async function invokeTool(toolId: string, userId: string, params: Record<string, unknown>): Promise<BusinessToolResult> {
  if (toolId === "winmail.unread_count") return { type: "winmail_unread", ...await queryWinmailUnread(userId) };
  if (toolId === "winmail.search_inbox") {
    return { type: "winmail_message_list", ...await searchWinmailInbox(userId, {
      sender: stringValue(params.sender),
      subject: stringValue(params.subject),
      date_from: stringValue(params.date_from),
      date_to: stringValue(params.date_to),
      unread_only: params.unread_only === true,
      limit: Number(params.limit ?? 10)
    }) };
  }
  throw new ToolGatewayError("TOOL_HANDLER_MISSING", "业务工具尚未实现", 500);
}

export function validateToolInput(toolId: string, raw: Record<string, unknown>) {
  if (toolId === "winmail.unread_count") {
    if (Object.keys(raw).length > 0) throw new ToolGatewayError("INVALID_INPUT", "未读邮件数量查询不接受额外参数");
    return {};
  }
  if (toolId !== "winmail.search_inbox") throw new ToolGatewayError("TOOL_NOT_FOUND", "业务工具不存在", 404);
  const allowed = new Set(["sender", "subject", "date_from", "date_to", "unread_only", "limit"]);
  if (Object.keys(raw).some((key) => !allowed.has(key))) throw new ToolGatewayError("INVALID_INPUT", "邮件查询包含不支持的参数");
  const sender = boundedString(raw.sender, 120, "发件人");
  const subject = boundedString(raw.subject, 160, "邮件主题");
  const dateFrom = optionalDate(raw.date_from, "开始时间");
  const dateTo = optionalDate(raw.date_to, "结束时间");
  if (dateFrom && dateTo && Date.parse(dateFrom) > Date.parse(dateTo)) throw new ToolGatewayError("INVALID_INPUT", "开始时间不能晚于结束时间");
  const limit = raw.limit === undefined ? 10 : Number(raw.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 20) throw new ToolGatewayError("INVALID_INPUT", "邮件数量必须在 1 到 20 之间");
  if (raw.unread_only !== undefined && typeof raw.unread_only !== "boolean") throw new ToolGatewayError("INVALID_INPUT", "未读筛选参数无效");
  return { sender, subject, date_from: dateFrom, date_to: dateTo, unread_only: raw.unread_only === true, limit };
}

function summarizeRawInput(params: Record<string, unknown>) {
  const allowed = new Set(["sender", "subject", "date_from", "date_to", "unread_only", "limit"]);
  const known = Object.fromEntries(Object.entries(params).filter(([key]) => allowed.has(key)));
  return {
    provided_fields: Object.keys(params).sort(),
    sender_filter: Boolean(known.sender),
    subject_filter: Boolean(known.subject),
    date_from: typeof known.date_from === "string" ? known.date_from.slice(0, 40) : null,
    date_to: typeof known.date_to === "string" ? known.date_to.slice(0, 40) : null,
    unread_only: known.unread_only === true,
    limit: Number.isInteger(Number(known.limit)) ? Number(known.limit) : null,
    scope: "self"
  };
}

function summarizeResult(result: BusinessToolResult) {
  return result.type === "winmail_unread"
    ? { result_type: result.type, unread: result.unread, scope: "self" }
    : { result_type: result.type, matched: result.matched, inbox_total: result.inbox_total, inbox_unread: result.inbox_unread, scope: "self" };
}

async function executeWithReadRetry<T>(operation: () => Promise<T>) {
  try {
    return await operation();
  } catch (error) {
    if (!isTransient(error)) throw error;
    await new Promise((resolve) => setTimeout(resolve, 250));
    return operation();
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number) {
  return Promise.race<T>([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new ToolGatewayError("TOOL_TIMEOUT", "邮箱查询超时，请稍后重试", 504)), Math.max(1000, timeoutMs)))
  ]);
}

function normalizeGatewayError(error: unknown) {
  if (error instanceof ToolGatewayError) return error;
  const message = error instanceof Error ? error.message : "业务工具执行失败";
  if (/尚未绑定/.test(message)) return new ToolGatewayError("MAILBOX_NOT_BOUND", message, 409);
  if (/密码|登录|认证|credential/i.test(message)) return new ToolGatewayError("MAILBOX_AUTH_FAILED", "邮箱身份验证失败，请重新绑定邮箱", 401);
  return new ToolGatewayError("TOOL_EXECUTION_FAILED", message.replace(/pass(word)?|sessid|secret|token/gi, "凭证"), 502);
}

function isTransient(error: unknown) {
  return /timeout|timed out|ECONN|socket|network|HTTP 5\d\d|暂时/i.test(error instanceof Error ? error.message : String(error));
}

function boundedString(value: unknown, max: number, label: string) {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value !== "string") throw new ToolGatewayError("INVALID_INPUT", `${label}必须是文本`);
  const normalized = value.replace(/[\u0000-\u001f\u007f]+/g, " ").trim();
  if (normalized.length > max) throw new ToolGatewayError("INVALID_INPUT", `${label}过长`);
  return normalized;
}

function optionalDate(value: unknown, label: string) {
  const normalized = boundedString(value, 40, label);
  if (!normalized) return "";
  const time = Date.parse(normalized);
  if (!Number.isFinite(time)) throw new ToolGatewayError("INVALID_INPUT", `${label}格式无效`);
  return new Date(time).toISOString();
}

function stringValue(value: unknown) {
  return typeof value === "string" && value ? value : undefined;
}
