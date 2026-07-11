import { NextResponse } from "next/server";
import { createSessionToken, sessionCookieName, sessionMaxAgeSeconds } from "@/lib/auth-session";
import { isMySqlDatabase } from "@/lib/config";
import { createUser } from "@/lib/db";

export async function POST(request: Request) {
  try {
    if (!isMySqlDatabase()) {
      return NextResponse.json({ error: "当前仅 MySQL 模式支持自定义注册" }, { status: 400 });
    }

    const body = await request.json();
    const email = String(body.email ?? "").trim().toLowerCase();
    const password = String(body.password ?? "");
    const name = String(body.name ?? "").trim();
    const department = String(body.department ?? "").trim();
    const position = String(body.position ?? "").trim();

    if (!email || !password || !name) {
      return NextResponse.json({ error: "请填写姓名、邮箱和密码" }, { status: 400 });
    }

    if (password.length < 8) {
      return NextResponse.json({ error: "密码至少需要 8 位" }, { status: 400 });
    }

    const user = await createUser({
      email,
      password,
      name,
      department,
      position,
      role: "employee",
      status: "active"
    });
    const token = await createSessionToken(user.id);
    const response = NextResponse.json({ user });
    response.cookies.set(sessionCookieName, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: sessionMaxAgeSeconds(),
      path: "/"
    });

    return response;
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "注册失败" },
      { status: 400 }
    );
  }
}
