import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/db";
import { deliverWinmailEmail } from "@/lib/integrations/providers/winmail/delivery";

export async function POST(request: Request) {
  try {
    const user = await requireAdmin();
    const body = await request.json();
    const recipientEmail = String(body.email ?? "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail)) return NextResponse.json({ error: "请填写有效的测试收件邮箱" }, { status: 400 });
    const result = await deliverWinmailEmail({
      recipientUserId: user.id,
      recipientEmail,
      subject: "天瑞智能客服 Winmail 集成测试",
      text: `Winmail 邮件通知已成功接入。\n\n测试时间：${new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}`,
      metadata: { kind: "manual_test", actor_id: user.id },
      force: true
    });
    if (!result.ok) return NextResponse.json({ error: result.error || "测试邮件发送失败" }, { status: 400 });
    return NextResponse.json({ result });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "测试邮件发送失败" }, { status: 400 });
  }
}
