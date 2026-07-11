import { NextResponse } from "next/server";
import { createSessionToken, sessionCookieName, sessionMaxAgeSeconds } from "@/lib/auth-session";
import { env, isMySqlDatabase } from "@/lib/config";
import { authenticateLdapUser, isLdapEnabled } from "@/lib/ldap";
import { ensureDefaultAdmin, getUserAuthByEmail, markUserLoggedIn, upsertExternalUser } from "@/lib/mysql-db";
import { verifyPassword } from "@/lib/password";
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

    const auth = await getUserAuthByEmail(email);
    const localPasswordOk = Boolean(auth && auth.password_hash && await verifyPassword(password, auth.password_hash));

    if (localPasswordOk && auth) {
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

        return createLoginResponse(user);
      }
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
  response.cookies.set(sessionCookieName, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.appBaseUrl.startsWith("https://"),
    maxAge: sessionMaxAgeSeconds(),
    path: "/"
  });

  return response;
}
