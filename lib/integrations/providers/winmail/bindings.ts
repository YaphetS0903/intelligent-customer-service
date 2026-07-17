import { getCurrentUser } from "@/lib/db";
import { integrationCredentialEncryptionConfigured, encryptIntegrationCredential } from "@/lib/integrations/credential-crypto";
import { maskEmail } from "@/lib/integrations/config";
import { verifyWinmailMailboxCredentials } from "@/lib/integrations/providers/winmail/client";
import { deleteUserIdentity, listUserIdentities, upsertUserIdentity } from "@/lib/integrations/store";
import { deleteUserCredential, findUserCredential, upsertUserCredential } from "@/lib/integrations/tool-store";
import type { UserProfile } from "@/lib/types";

export async function getCurrentWinmailBinding(currentUser?: UserProfile) {
  const user = currentUser ?? await getCurrentUser();
  const [identities, credential] = await Promise.all([listUserIdentities(5000), findUserCredential("winmail", user.id)]);
  const identity = identities.find((item) => item.connector_id === "winmail" && item.user_id === user.id && item.status === "verified");
  return {
    bound: Boolean(identity && credential),
    email_masked: identity ? maskEmail(identity.external_email || identity.external_user_id) : "",
    verified_at: identity?.verified_at ?? null,
    encryption_ready: integrationCredentialEncryptionConfigured()
  };
}

export async function bindCurrentWinmailMailbox(input: { email: string; password: string }, currentUser?: UserProfile) {
  const user = currentUser ?? await getCurrentUser();
  if (!integrationCredentialEncryptionConfigured()) throw new Error("服务器尚未配置邮箱凭证加密密钥");
  const email = normalizeEmail(input.email);
  if (!email || !input.password) throw new Error("请输入完整邮箱地址和邮箱密码");
  const verified = await verifyWinmailMailboxCredentials(email, input.password);
  if (!verified.email || verified.email !== email) throw new Error("Winmail 返回的邮箱身份与填写地址不一致");
  const identities = await listUserIdentities(5000);
  const occupied = identities.find((item) => item.connector_id === "winmail" && item.external_user_id.toLowerCase() === email && item.user_id !== user.id && item.status === "verified");
  if (occupied) throw new Error("该邮箱已绑定其他系统账号");

  const now = new Date().toISOString();
  const context = `winmail:${user.id}`;
  await upsertUserCredential({
    connector_id: "winmail",
    user_id: user.id,
    encrypted_secret: encryptIntegrationCredential(input.password, context),
    key_version: 1,
    last_verified_at: now
  });
  try {
    const identity = await upsertUserIdentity({
      connector_id: "winmail",
      user_id: user.id,
      external_user_id: email,
      external_login: verified.user || email,
      external_email: email,
      binding_source: "manual",
      status: "verified",
      verified_at: now,
      last_synced_at: now,
      metadata: { self_bound: true, mailbox_name: verified.name, bound_at: now }
    });
    return { bound: true, email_masked: maskEmail(email), verified_at: now, identity_id: identity.id };
  } catch (error) {
    await deleteUserCredential("winmail", user.id).catch(() => undefined);
    throw error;
  }
}

export async function unbindCurrentWinmailMailbox(currentUser?: UserProfile) {
  const user = currentUser ?? await getCurrentUser();
  await deleteUserCredential("winmail", user.id);
  await deleteUserIdentity("winmail", user.id);
  return { bound: false };
}

function normalizeEmail(value: string) {
  const email = value.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}
