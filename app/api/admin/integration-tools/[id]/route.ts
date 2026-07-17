import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/db";
import { getRegisteredTool } from "@/lib/integrations/tool-registry";
import { updateIntegrationTool } from "@/lib/integrations/tool-store";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: RouteContext) {
  try {
    await requireAdmin();
    const { id } = await params;
    const current = await getRegisteredTool(id);
    if (!current) return NextResponse.json({ error: "业务工具不存在" }, { status: 404 });
    const body = await request.json();
    const status = body.enabled === undefined ? current.status : body.enabled ? "published" : "disabled";
    const timeoutMs = body.timeout_ms === undefined ? current.timeout_ms : Number(body.timeout_ms);
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 60_000) throw new Error("超时时间必须在 1000 到 60000 毫秒之间");
    const roles: string[] = Array.isArray(body.allowed_roles)
      ? body.allowed_roles.map((role: unknown) => String(role)).filter((role: string) => role === "admin" || role === "employee")
      : [...current.allowed_roles];
    if (roles.length === 0) throw new Error("至少保留一个可用角色");
    return NextResponse.json({ tool: await updateIntegrationTool(id, { status, timeout_ms: timeoutMs, allowed_roles: Array.from(new Set<string>(roles)) }) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "更新业务工具失败" }, { status: 400 });
  }
}
