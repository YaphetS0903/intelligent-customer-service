import { NextResponse } from "next/server";
import { createServiceTicketComment, getCurrentUser, getServiceTicket, listServiceTicketComments } from "@/lib/db";
import { notifyAdmins, notifyUsers } from "@/lib/notification-events";

type RouteContext = {
  params: Promise<{ id: string }>;
};

async function getAuthorizedTicket(id: string) {
  const user = await getCurrentUser();
  const ticket = await getServiceTicket(id);

  if (!ticket) {
    throw new Error("工单不存在");
  }

  if (user.role !== "admin" && ticket.user_id !== user.id) {
    throw new Error("无权查看该工单");
  }

  return { user, ticket };
}

export async function GET(_request: Request, { params }: RouteContext) {
  try {
    const { id } = await params;
    const { user } = await getAuthorizedTicket(id);
    const comments = await listServiceTicketComments(id);

    return NextResponse.json({
      comments: user.role === "admin" ? comments : comments.filter((comment) => !comment.is_internal)
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "读取工单评论失败" },
      { status: 403 }
    );
  }
}

export async function POST(request: Request, { params }: RouteContext) {
  try {
    const { id } = await params;
    const { user, ticket } = await getAuthorizedTicket(id);
    const body = await request.json();
    const text = String(body.body ?? "").trim();

    if (!text) {
      return NextResponse.json({ error: "请输入处理记录" }, { status: 400 });
    }

    const comment = await createServiceTicketComment({
      ticket_id: id,
      author_id: user.id,
      author_role: user.role,
      body: text.slice(0, 4000),
      is_internal: user.role === "admin" ? Boolean(body.is_internal) : false
    });

    if (user.role === "admin" && !comment.is_internal) {
      await notifyUsers([ticket.user_id], {
        category: "ticket",
        severity: "info",
        title: "人工工单有新的处理回复",
        body: `工单「${ticket.title}」收到处理回复：${comment.body.slice(0, 120)}`,
        href: "/chat?panel=tickets",
        source_type: "service_ticket_comment",
        source_id: comment.id,
        dedupe_key: `ticket-comment:${comment.id}`,
        metadata: { ticket_id: ticket.id, comment_id: comment.id, author_id: user.id }
      });
    } else if (user.role === "employee") {
      const payload = {
        category: "ticket" as const,
        severity: "info" as const,
        title: "员工补充了工单信息",
        body: `${user.name} 在工单「${ticket.title}」中补充：${comment.body.slice(0, 120)}`,
        href: "/admin/insights?tab=tickets",
        source_type: "service_ticket_comment",
        source_id: comment.id,
        dedupe_key: `ticket-comment:${comment.id}`,
        metadata: { ticket_id: ticket.id, comment_id: comment.id, author_id: user.id }
      };
      if (ticket.assignee_id) await notifyUsers([ticket.assignee_id], payload);
      await notifyAdmins(payload, { excludeUserIds: ticket.assignee_id ? [ticket.assignee_id] : [] });
    }

    return NextResponse.json({ comment });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "提交工单评论失败" },
      { status: 400 }
    );
  }
}
