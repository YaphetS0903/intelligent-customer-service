import { NextResponse } from "next/server";
import { authCookieOptions, createSessionToken, sessionCookieName } from "@/lib/auth-session";
import { env, isMySqlDatabase } from "@/lib/config";
import { createUser } from "@/lib/db";
import { consumeRateLimit, getRequestIp } from "@/lib/request-security";

export async function POST(request: Request) {
  try {
    if (!isMySqlDatabase()) {
      return NextResponse.json({ error: "当前仅 MySQL 模式支持自定义注册" }, { status: 400 });
    }
    if (!env.allowSelfRegistration) {
      return NextResponse.json({ error: "系统已关闭员工自助注册，请联系管理员开通账号" }, { status: 403 });
    }
    const rateLimit = consumeRateLimit(`register:ip:${getRequestIp(request)}`, { limit: 5, windowMs: 60 * 60_000 });
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: "注册请求过于频繁，请稍后再试" },
        { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } }
      );
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
    response.cookies.set(sessionCookieName, token, authCookieOptions());

    return response;
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "注册失败" },
      { status: 400 }
    );
  }
}
