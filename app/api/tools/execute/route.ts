import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/db";
import { executeBusinessTool, ToolGatewayError } from "@/lib/integrations/tool-gateway";

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    const body = await request.json();
    const result = await executeBusinessTool({
      toolId: String(body.tool_id ?? ""),
      params: body.params && typeof body.params === "object" ? body.params : {},
      user,
      conversationId: body.conversation_id ? String(body.conversation_id) : null,
      source: "api"
    });
    return NextResponse.json({ tool: { id: result.tool.id, name: result.tool.name }, execution_id: result.execution.id, result: result.result });
  } catch (error) {
    const status = error instanceof ToolGatewayError ? error.status : 400;
    return NextResponse.json({ error: error instanceof Error ? error.message : "业务工具执行失败", code: error instanceof ToolGatewayError ? error.code : "TOOL_EXECUTION_FAILED" }, { status });
  }
}
