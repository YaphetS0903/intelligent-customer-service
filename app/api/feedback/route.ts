import { NextResponse } from "next/server";
import { createFeedback, getCurrentUser, getOwnedMessage } from "@/lib/db";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const user = await getCurrentUser();

    if (!body.message_id || !["like", "dislike"].includes(body.rating)) {
      return NextResponse.json({ error: "反馈参数不完整" }, { status: 400 });
    }
    const message = await getOwnedMessage(String(body.message_id), user.id);
    if (!message || message.role !== "assistant") {
      return NextResponse.json({ error: "回答不存在或无权反馈" }, { status: 403 });
    }

    const feedback = await createFeedback({
      message_id: message.id,
      user_id: user.id,
      rating: body.rating,
      comment: body.comment ? String(body.comment) : null
    });

    return NextResponse.json({ feedback });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "反馈失败" },
      { status: 400 }
    );
  }
}
