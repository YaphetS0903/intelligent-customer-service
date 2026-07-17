import { NextResponse } from "next/server";
import { getUserProfile, requireAdmin } from "@/lib/db";
import { findDeliveryByNotification, findVerifiedUserIdentity } from "@/lib/integrations/store";
import { notifyUsers } from "@/lib/notification-events";

export async function POST(request: Request) {
  try {
    const actor = await requireAdmin();
    const body = await request.json();
    const recipientUserId = String(body.user_id ?? "").trim();
    const recipient = recipientUserId ? await getUserProfile(recipientUserId) : null;
    if (!recipient || recipient.status !== "active") return NextResponse.json({ error: "请选择启用中的系统账号" }, { status: 400 });
    const identity = await findVerifiedUserIdentity("wecom", recipient.id);
    if (!identity) return NextResponse.json({ error: "该系统账号没有已验证的企业微信映射" }, { status: 400 });
    const acceptanceId = `wecom-business-acceptance:${recipient.id}:${Date.now()}`;
    const notifications = await notifyUsers([recipient.id], {
      category: "system",
      severity: "info",
      title: "智能客服业务通知验收",
      body: "企业微信业务通知链路已启用。后续课程、审批、工单和安全告警将按账号映射发送。",
      href: "/notifications",
      source_type: "integration_acceptance",
      source_id: acceptanceId,
      dedupe_key: acceptanceId,
      metadata: { kind: "business_acceptance", actor_id: actor.id, connector: "wecom" }
    });
    if (notifications.length !== 1) throw new Error("业务通知创建失败");
    const delivery = await findDeliveryByNotification("wecom", "app_message", notifications[0].id);
    if (delivery?.status !== "sent") throw new Error(delivery?.error_message || "企业微信业务消息未确认送达");
    return NextResponse.json({ result: { notification: notifications[0], delivery, recipient: { id: recipient.id, name: recipient.name, email: recipient.email } } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "企业微信业务通知验收失败" }, { status: 400 });
  }
}
