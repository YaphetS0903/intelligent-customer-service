import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/db";
import { deliverWecomAppMessage } from "@/lib/integrations/providers/wecom/delivery";

export async function POST(request: Request) {
  try {
    const actor = await requireAdmin();
    const body = await request.json();
    const recipientUserId = String(body.user_id ?? "").trim();
    if (!recipientUserId) return NextResponse.json({ error: "请选择已匹配的系统账号" }, { status: 400 });
    const result = await deliverWecomAppMessage({
      recipientUserId,
      title: "天瑞智能客服 企业微信集成测试",
      text: `企业微信应用消息通知已成功接入。\n测试时间：${new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}`,
      href: "/notifications",
      metadata: { kind: "manual_test", actor_id: actor.id },
      force: true
    });
    if (!result.ok) return NextResponse.json({ error: result.error || "企业微信测试消息发送失败" }, { status: 400 });
    return NextResponse.json({ result });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "企业微信测试消息发送失败" }, { status: 400 });
  }
}
