import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/db";
import { bindWecomIdentity, unbindWecomIdentity } from "@/lib/integrations/providers/wecom/bindings";

export async function POST(request: Request) {
  try {
    const actor = await requireAdmin();
    const body = await request.json();
    const externalUserId = String(body.external_user_id ?? "").trim();
    const userId = String(body.user_id ?? "").trim();
    if (!externalUserId || !userId) return NextResponse.json({ error: "请选择企业微信成员和系统账号" }, { status: 400 });
    return NextResponse.json({ result: await bindWecomIdentity({ externalUserId, userId, actorId: actor.id }) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "绑定企业微信账号失败" }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  try {
    const actor = await requireAdmin();
    const body = await request.json();
    const externalUserId = String(body.external_user_id ?? "").trim();
    if (!externalUserId) return NextResponse.json({ error: "请选择需要解绑的企业微信成员" }, { status: 400 });
    return NextResponse.json({ result: await unbindWecomIdentity({ externalUserId, actorId: actor.id }) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "解除企业微信绑定失败" }, { status: 400 });
  }
}
