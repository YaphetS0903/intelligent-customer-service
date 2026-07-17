import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getWecomConfig } from "@/lib/integrations/config";
import { runScheduledWecomDirectorySync } from "@/lib/integrations/providers/wecom/schedule";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const config = getWecomConfig();
  if (config.syncCronSecret.length < 32) {
    return NextResponse.json({ error: "企业微信定时同步密钥未配置" }, { status: 503 });
  }
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!sameSecret(supplied, config.syncCronSecret)) {
    return NextResponse.json({ error: "无权执行企业微信定时同步" }, { status: 401 });
  }

  try {
    return NextResponse.json({ schedule: await runScheduledWecomDirectorySync() });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "企业微信定时同步失败" },
      { status: 500 }
    );
  }
}

function sameSecret(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}
