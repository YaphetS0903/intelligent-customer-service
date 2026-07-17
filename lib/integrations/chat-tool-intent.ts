import { executeBusinessTool, ToolGatewayError, type BusinessToolResult } from "@/lib/integrations/tool-gateway";
import type { UserProfile } from "@/lib/types";
import { detectBusinessToolIntent } from "@/lib/integrations/chat-tool-intent-rules";

export { detectBusinessToolIntent } from "@/lib/integrations/chat-tool-intent-rules";

export type ChatBusinessToolResponse = {
  content: string;
  metadata: Record<string, unknown>;
  execution_id: string | null;
};

export async function executeChatBusinessTool(input: { question: string; user: UserProfile; conversationId: string }): Promise<ChatBusinessToolResponse | null> {
  const intent = detectBusinessToolIntent(input.question);
  if (!intent) return null;
  try {
    const executed = await executeBusinessTool({ ...intent, user: input.user, conversationId: input.conversationId, source: "chat" });
    return {
      content: resultText(executed.result),
      metadata: { kind: "business_tool", tool_id: executed.tool.id, tool_name: executed.tool.name, source_system: "Winmail", data_scope: "仅本人邮箱", queried_at: executed.result.queried_at, result: executed.result },
      execution_id: executed.execution.id
    };
  } catch (error) {
    const gatewayError = error instanceof ToolGatewayError ? error : new ToolGatewayError("TOOL_EXECUTION_FAILED", "邮箱查询暂时失败，请稍后重试", 502);
    return {
      content: gatewayError.code === "MAILBOX_NOT_BOUND" ? "你还没有连接个人 Winmail 邮箱。连接并验证邮箱后，我才能查询你本人的邮件。" : gatewayError.message,
      metadata: { kind: "business_tool_error", tool_id: intent.toolId, source_system: "Winmail", error_code: gatewayError.code, action_required: gatewayError.code === "MAILBOX_NOT_BOUND" ? "bind_winmail" : null },
      execution_id: null
    };
  }
}

function resultText(result: BusinessToolResult) {
  if (result.type === "winmail_unread") return result.unread > 0 ? `你的 Winmail 收件箱目前有 ${result.unread} 封未读邮件。` : "你的 Winmail 收件箱目前没有未读邮件。";
  if (result.matched === 0) return "没有找到符合这些条件的邮件摘要。你可以换一个发件人、主题或时间范围再试。";
  return `找到 ${result.matched} 封符合条件的邮件摘要，按 Winmail 返回顺序展示如下。`;
}
