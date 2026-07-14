import { NextResponse } from "next/server";
import { createServiceTicket, getCurrentUser, getOwnedConversation, getOwnedMessage, listServiceTicketComments, listServiceTicketsByUser } from "@/lib/db";
import { notifyAdmins } from "@/lib/notification-events";
import type { ServiceTicketPriority } from "@/lib/types";

function normalizePriority(value: unknown): ServiceTicketPriority {
  if (value === "low" || value === "high" || value === "urgent") {
    return value;
  }

  return "normal";
}

export async function GET() {
  try {
    const user = await getCurrentUser();
    const tickets = await listServiceTicketsByUser(user.id);
    const commentEntries = await Promise.all(
      tickets.map(async (ticket) => [
        ticket.id,
        (await listServiceTicketComments(ticket.id)).filter((comment) => !comment.is_internal)
      ] as const)
    );
    const commentsByTicket = Object.fromEntries(commentEntries);

    return NextResponse.json({ tickets, commentsByTicket });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "读取工单失败" },
      { status: 401 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    const body = await request.json();
    const conversationId = String(body.conversation_id ?? "").trim();
    const title = String(body.title ?? "").trim();
    const description = String(body.description ?? "").trim();

    if (!conversationId || !title || !description) {
      return NextResponse.json({ error: "请提供会话、标题和问题描述" }, { status: 400 });
    }
    const conversation = await getOwnedConversation(conversationId, user.id);
    if (!conversation) {
      return NextResponse.json({ error: "会话不存在或无权提交工单" }, { status: 403 });
    }
    const messageId = body.message_id ? String(body.message_id) : null;
    if (messageId && !await getOwnedMessage(messageId, user.id, conversation.id)) {
      return NextResponse.json({ error: "关联消息不属于当前会话" }, { status: 403 });
    }

    const ticket = await createServiceTicket({
      conversation_id: conversationId,
      message_id: messageId,
      user_id: user.id,
      title: title.slice(0, 120),
      description,
      priority: normalizePriority(body.priority)
    });

    await notifyAdmins({
      category: "ticket",
      severity: ticket.priority === "urgent" ? "critical" : ticket.priority === "high" ? "warning" : "info",
      title: "收到新的人工工单",
      body: `${user.name} 提交了「${ticket.title}」，请及时分派处理。`,
      href: "/admin/insights?tab=tickets",
      source_type: "service_ticket",
      source_id: ticket.id,
      dedupe_key: `ticket-created:${ticket.id}`,
      metadata: { ticket_id: ticket.id, priority: ticket.priority, user_id: user.id }
    });

    return NextResponse.json({ ticket });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "提交工单失败" },
      { status: 400 }
    );
  }
}
