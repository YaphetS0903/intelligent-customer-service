import { NextResponse } from "next/server";
import { authCookieOptions, createSessionToken, sessionCookieName } from "@/lib/auth-session";
import { safePostLoginPath } from "@/lib/safe-navigation";
import { authenticateWecomCode } from "@/lib/wecom-auth";
import { getWecomSsoAppOrigin, isWecomSsoEnabled, verifyWecomExternalState } from "@/lib/wecom-sso";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);

  try {
    if (!isWecomSsoEnabled()) throw new Error("企业微信单点登录尚未启用，请联系管理员。");
    const code = requestUrl.searchParams.get("code");
    const state = await verifyWecomExternalState(requestUrl.searchParams.get("state"));
    if (!code || !state) throw new Error("浏览器登录凭证无效或已过期，请从企业微信工作台重新进入。");

    const user = await authenticateWecomCode(code);
    const token = await createSessionToken(user.id);
    const next = safePostLoginPath(state.next, user.role === "admin");
    const response = NextResponse.redirect(new URL(next, getWecomSsoAppOrigin()));
    response.cookies.set(sessionCookieName, token, authCookieOptions());
    return response;
  } catch (error) {
    const loginUrl = new URL("/login", getWecomSsoAppOrigin());
    loginUrl.searchParams.set("error", error instanceof Error ? error.message : "企业微信浏览器登录失败");
    return NextResponse.redirect(loginUrl);
  }
}
