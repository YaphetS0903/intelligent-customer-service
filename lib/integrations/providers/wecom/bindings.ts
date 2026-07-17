import { getUserProfile, listUsers } from "@/lib/db";
import {
  deleteUserIdentity,
  listDirectoryMembers,
  listUserIdentities,
  upsertDirectoryMember,
  upsertUserIdentity
} from "@/lib/integrations/store";

export async function bindWecomIdentity(input: { externalUserId: string; userId: string; actorId: string }) {
  const [members, users, identities] = await Promise.all([
    listDirectoryMembers({ connectorId: "wecom", limit: 5000 }),
    listUsers(),
    listUserIdentities(5000)
  ]);
  const member = members.find((item) => item.external_user_id === input.externalUserId);
  if (!member) throw new Error("企业微信成员不存在，请先同步通讯录");
  if (member.status !== "active") throw new Error("只能绑定在职的企业微信成员");
  const user = users.find((item) => item.id === input.userId);
  if (!user) throw new Error("系统账号不存在");
  if (user.status !== "active") throw new Error("只能绑定启用中的系统账号");

  const wecomIdentities = identities.filter((item) => item.connector_id === "wecom");
  const externalBinding = wecomIdentities.find((item) => item.external_user_id === member.external_user_id);
  const userBinding = wecomIdentities.find((item) => item.user_id === user.id);
  if (externalBinding && externalBinding.user_id !== user.id) throw new Error("该企业微信成员已绑定其他系统账号，请先解绑");
  if (userBinding && userBinding.external_user_id !== member.external_user_id) throw new Error("该系统账号已绑定其他企业微信成员，请先解绑");
  if (member.matched_user_id && member.matched_user_id !== user.id) throw new Error("该企业微信成员已匹配其他系统账号，请先解绑");

  const now = new Date().toISOString();
  const identity = await upsertUserIdentity({
    connector_id: "wecom",
    user_id: user.id,
    external_user_id: member.external_user_id,
    external_login: member.external_user_id,
    external_email: member.email,
    binding_source: "manual",
    status: "verified",
    verified_at: now,
    last_synced_at: member.synced_at,
    metadata: { ...externalBinding?.metadata, bound_by: input.actorId, bound_at: now }
  });
  await upsertDirectoryMember({
    ...member,
    matched_user_id: user.id,
    metadata: {
      ...member.metadata,
      manual_binding: true,
      manual_unbound: false,
      bound_by: input.actorId,
      bound_at: now
    }
  });
  return { identity, member: { ...member, matched_user_id: user.id }, user: publicUser(user) };
}

export async function unbindWecomIdentity(input: { externalUserId: string; actorId: string }) {
  const members = await listDirectoryMembers({ connectorId: "wecom", limit: 5000 });
  const member = members.find((item) => item.external_user_id === input.externalUserId);
  if (!member) throw new Error("企业微信成员不存在，请先同步通讯录");
  if (!member.matched_user_id) throw new Error("该企业微信成员尚未绑定系统账号");
  const user = await getUserProfile(member.matched_user_id);
  const previousUserId = member.matched_user_id;
  const now = new Date().toISOString();
  await deleteUserIdentity("wecom", previousUserId);
  await upsertDirectoryMember({
    ...member,
    matched_user_id: null,
    metadata: {
      ...member.metadata,
      manual_binding: false,
      manual_unbound: true,
      unbound_by: input.actorId,
      unbound_at: now
    }
  });
  return { external_user_id: member.external_user_id, previous_user: user ? publicUser(user) : { id: previousUserId } };
}

function publicUser(user: { id: string; name: string; email: string; department: string; position: string }) {
  return { id: user.id, name: user.name, email: user.email, department: user.department, position: user.position };
}
