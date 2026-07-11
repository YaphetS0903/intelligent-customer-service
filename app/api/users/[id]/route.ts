import { NextResponse } from "next/server";
import { env } from "@/lib/config";
import { getUserProfile, requireAdmin, updateUserPassword, updateUserProfile } from "@/lib/db";
import type { DocumentSecurityLevel, UserRole } from "@/lib/types";

type RouteContext = {
  params: Promise<{ id: string }>;
};

function normalizeRole(value: unknown): UserRole {
  return value === "admin" ? "admin" : "employee";
}

function normalizeSecurityClearance(value: unknown, fallback: DocumentSecurityLevel): DocumentSecurityLevel {
  if (value === "public" || value === "internal" || value === "confidential" || value === "restricted") return value;
  return fallback;
}

export async function PATCH(request: Request, { params }: RouteContext) {
  try {
    const currentUser = await requireAdmin();
    const { id } = await params;
    const body = await request.json();
    const target = await getUserProfile(id);

    if (!target) {
      return NextResponse.json({ error: "用户不存在" }, { status: 404 });
    }

    const adminLocked = env.adminEmails.includes(target.email.toLowerCase());
    const nextRole = adminLocked ? "admin" : normalizeRole(body.role);
    const nextStatus = body.status === "disabled" ? "disabled" : "active";

    if (target.id === currentUser.id && nextRole !== "admin") {
      return NextResponse.json({ error: "不能取消自己的管理员权限" }, { status: 400 });
    }

    if (target.id === currentUser.id && nextStatus === "disabled") {
      return NextResponse.json({ error: "不能禁用自己的账号" }, { status: 400 });
    }

    const name = String(body.name ?? target.name).trim();
    if (!name) {
      return NextResponse.json({ error: "姓名不能为空" }, { status: 400 });
    }

    const nextPassword = String(body.password ?? "");
    if (nextPassword && nextPassword.length < 8) {
      return NextResponse.json({ error: "新密码至少需要 8 位" }, { status: 400 });
    }

    const user = await updateUserProfile(id, {
      name,
      role: nextRole,
      department: String(body.department ?? "").trim(),
      position: String(body.position ?? "").trim(),
      security_clearance: normalizeSecurityClearance(body.security_clearance, target.security_clearance),
      status: nextStatus
    });

    if (nextPassword) {
      await updateUserPassword(id, nextPassword);
    }

    return NextResponse.json({
      user: {
        ...user,
        role: adminLocked ? "admin" : user.role,
        admin_locked: adminLocked
      }
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "更新失败" },
      { status: 400 }
    );
  }
}
