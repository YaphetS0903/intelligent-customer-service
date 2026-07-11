import { NextResponse } from "next/server";
import { isMySqlDatabase } from "@/lib/config";
import { buildSsoAuthorizeUrl, createSsoState, isSsoEnabled, ssoNextCookieName, ssoStateCookieName } from "@/lib/sso";

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

    response.cookies.set(ssoStateCookieName, state, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 600,
      path: "/"
    });
    response.cookies.set(ssoNextCookieName, next, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 600,
      path: "/"
    });

    return response;
  } catch {
    return NextResponse.redirect(new URL("/login?error=sso_start_failed", request.url));
  }
}

function sanitizeNext(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return "/";
  }

  return value;
}
