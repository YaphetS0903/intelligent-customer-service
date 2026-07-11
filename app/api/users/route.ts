import { NextResponse } from "next/server";
import { env } from "@/lib/config";
import { createUser, listUsers, requireAdmin } from "@/lib/db";
import type { DocumentSecurityLevel, UserRole } from "@/lib/types";

function normalizeRole(value: unknown): UserRole {
  return value === "admin" ? "admin" : "employee";
}

function normalizeSecurityClearance(value: unknown): DocumentSecurityLevel {
  if (value === "public" || value === "confidential" || value === "restricted") return value;
  return "internal";
}

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireAdmin();
    const users = await listUsers();

    return NextResponse.json({
      users: users.map((user) => {
        const adminLocked = env.adminEmails.includes(user.email.toLowerCase());

        return {
          ...user,
          role: adminLocked ? "admin" : user.role,
          admin_locked: adminLocked
        };
      })
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "无权访问" },
      { status: 403 }
    );
  }
}

export async function POST(request: Request) {
  try {
    await requireAdmin();
    const body = await request.json();
    const email = String(body.email ?? "").trim().toLowerCase();
    const password = String(body.password ?? "");
    const name = String(body.name ?? "").trim();
    const department = String(body.department ?? "").trim();
    const position = String(body.position ?? "").trim();

    if (!email || !password || !name) {
      return NextResponse.json({ error: "请填写姓名、邮箱和初始密码" }, { status: 400 });
    }

    if (password.length < 8) {
      return NextResponse.json({ error: "初始密码至少需要 8 位" }, { status: 400 });
    }

    const user = await createUser({
      email,
      password,
      name,
      department,
      position,
      security_clearance: normalizeSecurityClearance(body.security_clearance),
      role: normalizeRole(body.role),
      status: body.status === "disabled" ? "disabled" : "active"
    });

    return NextResponse.json({ user });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "创建失败" },
      { status: 400 }
    );
  }
}
