import { NextResponse } from "next/server";
import { getServiceTicket, requireAdmin, updateServiceTicket } from "@/lib/db";
import { notifyUsers } from "@/lib/notification-events";
import type { ServiceTicket, ServiceTicketPriority, WorkStatus } from "@/lib/types";

type RouteContext = {
  params: Promise<{ id: string }>;
};

function normalizeStatus(value: unknown): WorkStatus | undefined {
  if (value === "pending" || value === "processing" || value === "resolved" || value === "ignored") {
    return value;
  }

  return undefined;
}

function normalizePriority(value: unknown): ServiceTicketPriority | undefined {
  if (value === "low" || value === "normal" || value === "high" || value === "urgent") {
    return value;
  }

  return undefined;
}

export async function PATCH(request: Request, { params }: RouteContext) {
  try {
    const user = await requireAdmin();
    const { id } = await params;
    const current = await getServiceTicket(id);
    if (!current) return NextResponse.json({ error: "工单不存在" }, { status: 404 });
    const body = await request.json();
    const input: Partial<Pick<ServiceTicket, "status" | "priority" | "assignee_id" | "resolution_note" | "due_at">> = {};
    const status = normalizeStatus(body.status);
    const priority = normalizePriority(body.priority);

    if (status) {
      input.status = status;
    }

    if (priority) {
      input.priority = priority;
    }

    if (body.assignee_id !== undefined) {
      input.assignee_id = String(body.assignee_id || "") || null;
    } else if (status === "processing" || status === "resolved") {
      input.assignee_id = user.id;
    }

    if (body.resolution_note !== undefined) {
      input.resolution_note = String(body.resolution_note || "") || null;
    }

    if (body.due_at !== undefined) {
      input.due_at = body.due_at ? new Date(String(body.due_at)).toISOString() : null;
    }

    const ticket = await updateServiceTicket(id, input);

    if (ticket.assignee_id && ticket.assignee_id !== current.assignee_id) {
      await notifyUsers([ticket.assignee_id], {
        category: "ticket",
        severity: ticket.priority === "urgent" ? "critical" : "warning",
        title: "有工单分派给你",
        body: `工单「${ticket.title}」已分派给你，请查看处理要求。`,
        href: "/admin/insights?tab=tickets",
        source_type: "service_ticket",
        source_id: ticket.id,
        dedupe_key: `ticket-assigned:${ticket.id}:${ticket.assignee_id}:${ticket.updated_at}`,
        metadata: { ticket_id: ticket.id, assigned_by: user.id, priority: ticket.priority }
      });
    }

    if (ticket.status !== current.status || ticket.resolution_note !== current.resolution_note) {
      await notifyUsers([ticket.user_id], {
        category: "ticket",
        severity: ticket.status === "resolved" ? "success" : ticket.status === "ignored" ? "warning" : "info",
        title: ticket.status === "resolved" ? "人工工单已处理完成" : "人工工单状态已更新",
        body: ticket.status === "resolved"
          ? `工单「${ticket.title}」已处理完成${ticket.resolution_note ? `：${ticket.resolution_note}` : "。"}`
          : `工单「${ticket.title}」当前状态：${ticketStatusLabel(ticket.status)}。`,
        href: "/chat?panel=tickets",
        source_type: "service_ticket",
        source_id: ticket.id,
        dedupe_key: `ticket-status:${ticket.id}:${ticket.status}:${ticket.updated_at}`,
        metadata: { ticket_id: ticket.id, status: ticket.status, updated_by: user.id }
      });
    }

    return NextResponse.json({ ticket });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "更新工单失败" },
      { status: 400 }
    );
  }
}

function ticketStatusLabel(status: ServiceTicket["status"]) {
  return ({ pending: "待处理", processing: "处理中", resolved: "已完成", ignored: "已关闭" })[status];
}
