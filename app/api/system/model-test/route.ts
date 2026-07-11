import { NextResponse } from "next/server";
import { requireSettingsAccess } from "@/lib/health";
import { testChatModelConnectivity } from "@/lib/model-connectivity";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    await requireSettingsAccess();
    const result = await testChatModelConnectivity();

    return NextResponse.json({ result }, { status: result.ok ? 200 : 400 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "模型连通性测试失败" },
      { status: 400 }
    );
  }
}
