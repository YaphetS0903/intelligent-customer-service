import { NextResponse } from "next/server";
import { getCurrentUser, listConversations, listMessages } from "@/lib/db";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const user = await getCurrentUser();
    const conversations = await listConversations(user.id, "all");
    const allowed = conversations.some((conversation) => conversation.id === id);

    if (!allowed && user.role !== "admin") {
      return NextResponse.json({ error: "无权访问该会话" }, { status: 403 });
    }

    const messages = await listMessages(id);
    return NextResponse.json({ messages });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "无权访问" },
      { status: 401 }
    );
  }
}
