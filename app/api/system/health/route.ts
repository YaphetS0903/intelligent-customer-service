import { NextResponse } from "next/server";
import { getSystemHealth, requireSettingsAccess } from "@/lib/health";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireSettingsAccess();
    const health = await getSystemHealth();
    return NextResponse.json({ health });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "无权访问配置检查" },
      { status: 403 }
    );
  }
}
