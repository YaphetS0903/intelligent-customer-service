import { NextResponse } from "next/server";
import { getCurrentUser, listConversations, upsertConversation } from "@/lib/db";
import type { ConversationArchiveFilter } from "@/lib/types";

export async function GET(request: Request) {
  try {
    const user = await getCurrentUser();
    const { searchParams } = new URL(request.url);
    const filter: ConversationArchiveFilter =
      searchParams.get("view") === "archived" || searchParams.get("archived") === "1"
        ? "archived"
        : "active";
    const query = String(searchParams.get("q") ?? searchParams.get("search") ?? "").trim().slice(0, 80);
    const conversations = await listConversations(user.id, filter, query);
    return NextResponse.json({ conversations });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "无权访问" },
      { status: 401 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const conversation = await upsertConversation(String(body.title ?? "新的对话"));
    return NextResponse.json({ conversation });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "创建失败" },
      { status: 400 }
    );
  }
}
