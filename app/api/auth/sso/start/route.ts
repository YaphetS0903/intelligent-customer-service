import { NextResponse } from "next/server";
import { isMySqlDatabase } from "@/lib/config";
import { buildSsoAuthorizeUrl, createSsoState, isSsoEnabled, ssoNextCookieName, ssoStateCookieName } from "@/lib/sso";
import { authCookieOptions } from "@/lib/auth-session";
import { safeInternalPath } from "@/lib/safe-navigation";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    if (!isMySqlDatabase()) {
      return NextResponse.redirect(new URL("/login?error=sso_database", request.url));
    }

    if (!isSsoEnabled()) {
      return NextResponse.redirect(new URL("/login?error=sso_not_configured", request.url));
    }

    const url = new URL(request.url);
    const next = sanitizeNext(url.searchParams.get("next"));
    const state = createSsoState();
    const authorizeUrl = buildSsoAuthorizeUrl(state);
    const response = NextResponse.redirect(authorizeUrl);

    response.cookies.set(ssoStateCookieName, state, authCookieOptions(600));
    response.cookies.set(ssoNextCookieName, next, authCookieOptions(600));

    return response;
  } catch {
    return NextResponse.redirect(new URL("/login?error=sso_start_failed", request.url));
  }
}

function sanitizeNext(value: string | null) {
  return safeInternalPath(value);
}
