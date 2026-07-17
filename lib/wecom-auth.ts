import { createHash } from "node:crypto";
import { getUserProfile } from "@/lib/db";
import { getWecomConfig } from "@/lib/integrations/config";
import { fetchWecomLoginIdentity } from "@/lib/integrations/providers/wecom/client";
import {
  findDirectoryMemberByExternalId,
  findVerifiedUserIdentityByExternalId,
  upsertDirectoryMember,
  upsertUserIdentity
} from "@/lib/integrations/store";
import { getUserAuthByEmail, markUserLoggedIn, upsertExternalUser } from "@/lib/mysql-db";

export async function authenticateWecomCode(code: string) {
  const wecomUser = await fetchWecomLoginIdentity(code);
  const member = await findDirectoryMemberByExternalId("wecom", wecomUser.userid);
  if (member && member.status !== "active") throw new Error("该企业微信账号已不在应用的在职成员范围内，请联系管理员。");

  let identity = await findVerifiedUserIdentityByExternalId("wecom", wecomUser.userid);
  if (!identity) identity = await provisionWecomUser(wecomUser.userid, member);

  const user = await getUserProfile(identity.user_id);
  if (!user) throw new Error("绑定的系统账号不存在，请联系管理员。");
  if (user.status === "disabled") throw new Error("账号已被禁用，请联系管理员。");

  await markUserLoggedIn(user.id);
  return user;
}

async function provisionWecomUser(
  externalUserId: string,
  member: Awaited<ReturnType<typeof findDirectoryMemberByExternalId>>
) {
  if (!getWecomConfig().autoProvisionUsers) {
    throw new Error("该企业微信账号尚未绑定系统账号，请联系管理员完成绑定。");
  }
  if (!member) throw new Error("企业微信通讯录中未找到该成员，请联系管理员重新同步通讯录。");
  if (member.status !== "active") throw new Error("该企业微信账号已不在应用的在职成员范围内，请联系管理员。");

  const email = member.email.trim().toLowerCase() || fallbackWecomEmail(externalUserId);
  const existing = await getUserAuthByEmail(email);
  if (existing?.user.role === "admin") {
    throw new Error("该企业微信成员匹配到管理员账号，为防止误授权，请由管理员手工确认绑定。");
  }

  const user = await upsertExternalUser({
    email,
    name: member.name || externalUserId,
    department: member.department_names[0] ?? "未分配部门",
    position: member.position,
    provider: "wecom",
    subject: externalUserId
  });
  if (user.status !== "active") throw new Error("账号已被禁用，请联系管理员。");

  const now = new Date().toISOString();
  const identity = await upsertUserIdentity({
    connector_id: "wecom",
    user_id: user.id,
    external_user_id: externalUserId,
    external_login: externalUserId,
    external_email: member.email,
    binding_source: "jit",
    status: "verified",
    verified_at: now,
    last_synced_at: member.synced_at,
    metadata: { auto_provisioned: true, provisioned_at: now }
  });
  await upsertDirectoryMember({
    ...member,
    matched_user_id: user.id,
    metadata: { ...member.metadata, auto_provisioned: true, provisioned_at: now }
  });
  return identity;
}

function fallbackWecomEmail(externalUserId: string) {
  const stem = externalUserId.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "user";
  const digest = createHash("sha256").update(externalUserId).digest("hex").slice(0, 10);
  return `${stem}-${digest}@wecom.local`;
}
