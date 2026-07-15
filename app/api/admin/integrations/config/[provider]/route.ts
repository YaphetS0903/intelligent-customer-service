import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/db";
import { saveIntegrationConfig } from "@/lib/integrations/config";
import { refreshConnectorConfigState } from "@/lib/integrations/service";
import type { IntegrationProvider } from "@/lib/integrations/types";

type RouteContext = { params: Promise<{ provider: string }> };

export async function PUT(request: Request, { params }: RouteContext) {
  try {
    await requireAdmin();
    const { provider: rawProvider } = await params;
    const provider = normalizeProvider(rawProvider);
    const body = await request.json();
    const config = await saveIntegrationConfig(provider, body.settings ?? {});
    const connector = await refreshConnectorConfigState(provider);
    return NextResponse.json({ config, connector, notice: "配置已保存到服务器 .env.local，密钥不会返回前端。" });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "保存集成配置失败" }, { status: 400 });
  }
}

function normalizeProvider(value: string): IntegrationProvider {
  if (value === "wecom" || value === "winmail") return value;
  throw new Error("不支持的连接器");
}

