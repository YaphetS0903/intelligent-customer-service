import { NextResponse } from "next/server";
import { createFeedback, getCurrentUser } from "@/lib/db";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const user = await getCurrentUser();

    if (!body.message_id || !["like", "dislike"].includes(body.rating)) {
      return NextResponse.json({ error: "反馈参数不完整" }, { status: 400 });
    }

    const feedback = await createFeedback({
      message_id: String(body.message_id),
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
