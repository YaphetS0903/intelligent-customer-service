import { NextResponse } from "next/server";
import { authCookieOptions, createSessionToken, sessionCookieName } from "@/lib/auth-session";
import { isMySqlDatabase } from "@/lib/config";
import { createSecurityEvent } from "@/lib/db";
import { authenticateLdapUser, isLdapEnabled } from "@/lib/ldap";
import { ensureDefaultAdmin, getUserAuthByEmail, markUserLoggedIn, upsertExternalUser } from "@/lib/mysql-db";
import { verifyPassword } from "@/lib/password";
import { checkRateLimit, clearRateLimit, consumeRateLimit, getRequestIp } from "@/lib/request-security";
import type { UserProfile } from "@/lib/types";

export async function POST(request: Request) {
  try {
    if (!isMySqlDatabase()) {
      return NextResponse.json({ error: "当前仅 MySQL 模式支持自定义账号登录" }, { status: 400 });
    }

    await ensureDefaultAdmin();

    const body = await request.json();
    const email = String(body.email ?? "").trim().toLowerCase();
    const password = String(body.password ?? "");

    if (!email || !password) {
      return NextResponse.json({ error: "请输入邮箱和密码" }, { status: 400 });
    }

    const ip = getRequestIp(request);
    const requestLimit = consumeRateLimit(`login:request:${ip}`, { limit: 120, windowMs: 15 * 60_000, blockMs: 15 * 60_000 });
    if (!requestLimit.allowed) return rateLimitedResponse(requestLimit.retryAfterSeconds);
    const accountLimit = checkRateLimit(`login:failure:${email}`);
    if (!accountLimit.allowed) return rateLimitedResponse(accountLimit.retryAfterSeconds);

    const auth = await getUserAuthByEmail(email);
    const localPasswordOk = Boolean(auth && auth.password_hash && await verifyPassword(password, auth.password_hash));

    if (localPasswordOk && auth) {
      clearRateLimit(`login:failure:${email}`);
      return createLoginResponse(auth.user);
    }

    if (isLdapEnabled()) {
      const ldapUser = await authenticateLdapUser(email, password).catch((error) => {
        console.warn("LDAP login failed", error);
        return null;
      });

      if (ldapUser) {
        const user = await upsertExternalUser({
          email: ldapUser.email,
          name: ldapUser.name,
          department: ldapUser.department,
          position: ldapUser.position,
          provider: "ldap",
          subject: ldapUser.subject
        });

        clearRateLimit(`login:failure:${email}`);
        return createLoginResponse(user);
      }
    }

    const failureLimit = consumeRateLimit(`login:failure:${email}`, { limit: 5, windowMs: 15 * 60_000, blockMs: 15 * 60_000 });
    if (!failureLimit.allowed) {
      if (failureLimit.blockedNow) {
        void recordLoginLockout(email, ip);
      }
      return rateLimitedResponse(failureLimit.retryAfterSeconds);
    }
    return NextResponse.json({ error: "邮箱或密码不正确" }, { status: 401 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "登录失败" },
      { status: 400 }
    );
  }
}

async function createLoginResponse(user: UserProfile) {
  if (user.status === "disabled") {
    return NextResponse.json({ error: "账号已被禁用，请联系管理员" }, { status: 403 });
  }

  await markUserLoggedIn(user.id);
  const token = await createSessionToken(user.id);
  const response = NextResponse.json({ user });
  response.cookies.set(sessionCookieName, token, authCookieOptions());

  return response;
}

function rateLimitedResponse(retryAfterSeconds: number) {
  return NextResponse.json(
    { error: "登录尝试过于频繁，请稍后再试" },
    { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } }
  );
}

async function recordLoginLockout(email: string, ip: string) {
  await createSecurityEvent({
    category: "abnormal_access",
    severity: "high",
    user_id: null,
    conversation_id: null,
    message_id: null,
    title: "账号连续登录失败",
    detail: "同一账号在短时间内连续登录失败，系统已临时限制后续尝试。",
    raw_excerpt: null,
    masked_excerpt: null,
    metadata: { detector: "login_failure_lockout", email, ip }
  }).catch((error) => console.warn("Failed to record login lockout", error));
}
