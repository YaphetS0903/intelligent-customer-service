import { NextResponse } from "next/server";
import { authCookieOptions } from "@/lib/auth-session";
import { safeInternalPath } from "@/lib/safe-navigation";
import {
  buildWecomAuthorizeUrl,
  createWecomSsoState,
  getWecomSsoAppOrigin,
  isWecomClient,
  isWecomSsoEnabled,
  wecomSsoNextCookieName,
  wecomSsoStateCookieName
} from "@/lib/wecom-sso";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  try {
    if (!isWecomSsoEnabled()) {
      return redirectToLogin(requestUrl, "企业微信单点登录尚未启用，请联系管理员。");
    }

    const state = createWecomSsoState();
    const next = safeInternalPath(requestUrl.searchParams.get("next"));
    const mode = isWecomClient(request.headers.get("user-agent")) ? "client" : "web";
    const response = NextResponse.redirect(buildWecomAuthorizeUrl(state, mode));
    response.cookies.set(wecomSsoStateCookieName, state, authCookieOptions(600));
    response.cookies.set(wecomSsoNextCookieName, next, authCookieOptions(600));
    return response;
  } catch (error) {
    return redirectToLogin(requestUrl, error instanceof Error ? error.message : "企业微信登录启动失败");
  }
}

function redirectToLogin(requestUrl: URL, message: string) {
  const loginUrl = new URL("/login", getWecomSsoAppOrigin());
  loginUrl.searchParams.set("error", message);
  return NextResponse.redirect(loginUrl);
}
