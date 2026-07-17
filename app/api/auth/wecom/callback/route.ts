import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { authCookieOptions, createSessionToken, sessionCookieName } from "@/lib/auth-session";
import { safePostLoginPath } from "@/lib/safe-navigation";
import { authenticateWecomCode } from "@/lib/wecom-auth";
import {
  getWecomSsoAppOrigin,
  isWecomSsoEnabled,
  wecomSsoNextCookieName,
  wecomSsoStateCookieName
} from "@/lib/wecom-sso";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const cookieStore = await cookies();
  const expectedState = cookieStore.get(wecomSsoStateCookieName)?.value;
  const requestedNext = cookieStore.get(wecomSsoNextCookieName)?.value ?? "/";

  try {
    if (!isWecomSsoEnabled()) throw new Error("企业微信单点登录尚未启用，请联系管理员。");
    const code = requestUrl.searchParams.get("code");
    const state = requestUrl.searchParams.get("state");
    if (!code || !state) throw new Error("企业微信登录回调缺少授权信息，请重新登录。");
    if (!expectedState || expectedState !== state) throw new Error("企业微信登录校验失败，请重新登录。");

    const user = await authenticateWecomCode(code);
    const token = await createSessionToken(user.id);
    const response = NextResponse.redirect(new URL(safePostLoginPath(requestedNext, user.role === "admin"), getWecomSsoAppOrigin()));
    response.cookies.set(sessionCookieName, token, authCookieOptions());
    clearWecomSsoCookies(response);
    return response;
  } catch (error) {
    const loginUrl = new URL("/login", getWecomSsoAppOrigin());
    loginUrl.searchParams.set("error", error instanceof Error ? error.message : "企业微信登录失败");
    const response = NextResponse.redirect(loginUrl);
    clearWecomSsoCookies(response);
    return response;
  }
}

function clearWecomSsoCookies(response: NextResponse) {
  response.cookies.set(wecomSsoStateCookieName, "", authCookieOptions(0));
  response.cookies.set(wecomSsoNextCookieName, "", authCookieOptions(0));
}
