import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createSessionToken, sessionCookieName, sessionMaxAgeSeconds } from "@/lib/auth-session";
import { upsertExternalUser } from "@/lib/db";
import { markUserLoggedIn } from "@/lib/mysql-db";
import {
  exchangeSsoCode,
  fetchSsoUserInfo,
  ssoNextCookieName,
  ssoStateCookieName
} from "@/lib/sso";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);

  try {
    const code = requestUrl.searchParams.get("code");
    const state = requestUrl.searchParams.get("state");
    const error = requestUrl.searchParams.get("error");

    if (error) {
      throw new Error(`统一登录失败：${error}`);
    }

    if (!code || !state) {
      throw new Error("统一登录回调缺少 code 或 state。");
    }

    const cookieStore = await cookies();
    const expectedState = cookieStore.get(ssoStateCookieName)?.value;
    const next = sanitizeNext(cookieStore.get(ssoNextCookieName)?.value ?? "/");

    if (!expectedState || expectedState !== state) {
      throw new Error("统一登录 state 校验失败，请重新登录。");
    }

    const accessToken = await exchangeSsoCode(code);
    const ssoUser = await fetchSsoUserInfo(accessToken);
    const user = await upsertExternalUser({
      email: ssoUser.email,
      name: ssoUser.name,
      department: ssoUser.department,
      provider: "oidc",
      subject: ssoUser.subject
    });

    if (user.status === "disabled") {
      throw new Error("账号已被禁用，请联系管理员。");
    }

    await markUserLoggedIn(user.id);

    const token = await createSessionToken(user.id);
    const response = NextResponse.redirect(new URL(next, requestUrl.origin));
    response.cookies.set(sessionCookieName, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: sessionMaxAgeSeconds(),
      path: "/"
    });
    response.cookies.set(ssoStateCookieName, "", {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 0,
      path: "/"
    });
    response.cookies.set(ssoNextCookieName, "", {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 0,
      path: "/"
    });

    return response;
  } catch (callbackError) {
    const loginUrl = new URL("/login", requestUrl.origin);
    loginUrl.searchParams.set("error", callbackError instanceof Error ? callbackError.message : "统一登录失败");
    return NextResponse.redirect(loginUrl);
  }
}

function sanitizeNext(value: string) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return "/";
  }

  return value;
}
