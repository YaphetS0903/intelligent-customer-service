import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/db";
import { testIntegrationConnector } from "@/lib/integrations/service";
import type { IntegrationProvider } from "@/lib/integrations/types";

type RouteContext = { params: Promise<{ provider: string }> };

export async function POST(_request: Request, { params }: RouteContext) {
  try {
    await requireAdmin();
    const { provider: rawProvider } = await params;
    const provider = normalizeProvider(rawProvider);
    return NextResponse.json({ result: await testIntegrationConnector(provider) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "连通测试失败" }, { status: 400 });
  }
}

function normalizeProvider(value: string): IntegrationProvider {
  if (value === "wecom" || value === "winmail") return value;
  throw new Error("不支持的连接器");
}

