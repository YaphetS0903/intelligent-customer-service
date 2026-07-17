import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/db";
import { bindCurrentWinmailMailbox, getCurrentWinmailBinding, unbindCurrentWinmailMailbox } from "@/lib/integrations/providers/winmail/bindings";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await getCurrentUser();
    return NextResponse.json({ binding: await getCurrentWinmailBinding(user) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "读取邮箱绑定失败";
    return NextResponse.json({ error: message }, { status: message === "请先登录" ? 401 : 500 });
  }
}

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    const body = await request.json();
    return NextResponse.json({ binding: await bindCurrentWinmailMailbox({
      email: String(body.email ?? ""),
      password: String(body.password ?? "")
    }, user) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "绑定邮箱失败";
    return NextResponse.json({ error: message }, { status: message === "请先登录" ? 401 : 400 });
  }
}

export async function DELETE() {
  try {
    const user = await getCurrentUser();
    return NextResponse.json({ binding: await unbindCurrentWinmailMailbox(user) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "解绑邮箱失败";
    return NextResponse.json({ error: message }, { status: message === "请先登录" ? 401 : 400 });
  }
}
