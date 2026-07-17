import { NextResponse } from "next/server";
import { bindCurrentWinmailMailbox, getCurrentWinmailBinding, unbindCurrentWinmailMailbox } from "@/lib/integrations/providers/winmail/bindings";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json({ binding: await getCurrentWinmailBinding() });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "读取邮箱绑定失败" }, { status: 401 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    return NextResponse.json({ binding: await bindCurrentWinmailMailbox({
      email: String(body.email ?? ""),
      password: String(body.password ?? "")
    }) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "绑定邮箱失败" }, { status: 400 });
  }
}

export async function DELETE() {
  try {
    return NextResponse.json({ binding: await unbindCurrentWinmailMailbox() });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "解绑邮箱失败" }, { status: 400 });
  }
}
