import { NextResponse } from "next/server";
import {
  createDocumentPermissionTemplate,
  listDocumentPermissionTemplates,
  requireAdmin
} from "@/lib/db";
import type { DocumentSecurityLevel, UserRole } from "@/lib/types";

const securityLevels = new Set<DocumentSecurityLevel>(["public", "internal", "confidential", "restricted"]);
const roles = new Set<UserRole>(["admin", "employee"]);
const stringList = (value: unknown) => Array.isArray(value)
  ? [...new Set(value.map((item) => String(item).trim()).filter(Boolean))]
  : [];

export async function GET() {
  try {
    await requireAdmin();
    return NextResponse.json({ templates: await listDocumentPermissionTemplates() });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "加载权限模板失败" }, { status: 400 });
  }
}

export async function POST(request: Request) {
  try {
    const admin = await requireAdmin();
    const body = await request.json();
    const name = String(body.name ?? "").trim();
    const securityLevel = String(body.security_level ?? "internal") as DocumentSecurityLevel;
    if (!name) return NextResponse.json({ error: "请填写模板名称" }, { status: 400 });
    if (!securityLevels.has(securityLevel)) return NextResponse.json({ error: "资料密级无效" }, { status: 400 });
    const template = await createDocumentPermissionTemplate({
      name,
      description: String(body.description ?? "").trim() || null,
      security_level: securityLevel,
      acl_departments: stringList(body.acl_departments),
      acl_positions: stringList(body.acl_positions),
      acl_roles: stringList(body.acl_roles).filter((role): role is UserRole => roles.has(role as UserRole)),
      acl_users: stringList(body.acl_users),
      created_by: admin.id
    });
    return NextResponse.json({ template });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "创建权限模板失败" }, { status: 400 });
  }
}
