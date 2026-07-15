import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/db";
import { syncWecomDirectory } from "@/lib/integrations/providers/wecom/sync";

export async function POST(request: Request) {
  try {
    const user = await requireAdmin();
    const body = await request.json().catch(() => ({}));
    const result = await syncWecomDirectory({ startedBy: user.id, updateProfiles: body.update_profiles === true });
    return NextResponse.json({ result });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "企业微信通讯录同步失败" }, { status: 400 });
  }
}

