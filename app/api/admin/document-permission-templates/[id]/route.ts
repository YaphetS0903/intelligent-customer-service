import { NextResponse } from "next/server";
import {
  deleteDocumentPermissionTemplate,
  requireAdmin,
  updateDocumentPermissionTemplate
} from "@/lib/db";
import type { DocumentSecurityLevel, UserRole } from "@/lib/types";

type RouteContext = { params: Promise<{ id: string }> };
const securityLevels = new Set<DocumentSecurityLevel>(["public", "internal", "confidential", "restricted"]);
const roles = new Set<UserRole>(["admin", "employee"]);
const stringList = (value: unknown) => Array.isArray(value)
  ? [...new Set(value.map((item) => String(item).trim()).filter(Boolean))]
  : [];

export async function PATCH(request: Request, { params }: RouteContext) {
  try {
    await requireAdmin();
    const { id } = await params;
    const body = await request.json();
    const securityLevel = body.security_level === undefined ? undefined : String(body.security_level) as DocumentSecurityLevel;
    if (securityLevel && !securityLevels.has(securityLevel)) {
      return NextResponse.json({ error: "资料密级无效" }, { status: 400 });
    }
    const template = await updateDocumentPermissionTemplate(id, {
      name: body.name === undefined ? undefined : String(body.name).trim(),
      description: body.description === undefined ? undefined : String(body.description).trim() || null,
      security_level: securityLevel,
      acl_departments: body.acl_departments === undefined ? undefined : stringList(body.acl_departments),
      acl_positions: body.acl_positions === undefined ? undefined : stringList(body.acl_positions),
      acl_roles: body.acl_roles === undefined
        ? undefined
        : stringList(body.acl_roles).filter((role): role is UserRole => roles.has(role as UserRole)),
      acl_users: body.acl_users === undefined ? undefined : stringList(body.acl_users)
    });
    return NextResponse.json({ template });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "更新权限模板失败" }, { status: 400 });
  }
}

export async function DELETE(_request: Request, { params }: RouteContext) {
  try {
    await requireAdmin();
    const { id } = await params;
    await deleteDocumentPermissionTemplate(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "删除权限模板失败" }, { status: 400 });
  }
}
