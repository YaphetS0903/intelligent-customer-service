import { listUsers, updateUserProfile } from "@/lib/db";
import { getPublicIntegrationConfigs, getWecomConfig, maskEmail } from "@/lib/integrations/config";
import { fetchWecomDirectory } from "@/lib/integrations/providers/wecom/client";
import {
  finishSyncRun,
  markMissingDirectoryMembers,
  startSyncRun,
  updateConnectorState,
  upsertDirectoryMember,
  upsertUserIdentity,
  listDirectoryMembers,
  listUserIdentities
} from "@/lib/integrations/store";
import type { WecomDirectorySyncResult } from "@/lib/integrations/types";

export async function syncWecomDirectory(input: { startedBy: string; updateProfiles?: boolean }): Promise<WecomDirectorySyncResult> {
  const config = getWecomConfig();
  if (!config.enabled) throw new Error("企业微信连接器未启用");
  const run = await startSyncRun("wecom", "directory.sync", input.startedBy);
  const startedAt = Date.now();
  try {
    const [directory, localUsers, existingMembers, existingIdentities] = await Promise.all([
      fetchWecomDirectory(),
      listUsers(),
      listDirectoryMembers({ connectorId: "wecom", limit: 5000 }),
      listUserIdentities(5000)
    ]);
    const departmentNames = new Map(directory.departments.map((item) => [item.id, item.name]));
    const localByEmail = new Map(localUsers.map((user) => [normalizeEmail(user.email), user]));
    const localById = new Map(localUsers.map((user) => [user.id, user]));
    const previousMemberByExternalId = new Map(existingMembers.map((member) => [member.external_user_id, member]));
    const verifiedIdentityByExternalId = new Map(existingIdentities
      .filter((identity) => identity.connector_id === "wecom" && identity.status === "verified")
      .map((identity) => [identity.external_user_id, identity]));
    const boundUserIds = new Set(verifiedIdentityByExternalId.values().map((identity) => identity.user_id));
    const externalEmailCounts = new Map<string, number>();
    for (const member of directory.users) {
      const email = normalizeEmail(member.email || member.biz_mail || "");
      if (email) externalEmailCounts.set(email, (externalEmailCounts.get(email) ?? 0) + 1);
    }

    let matched = 0;
    let profilesUpdated = 0;
    let disabled = 0;
    let conflicts = 0;
    const activeExternalIds = new Set<string>();
    const syncedAt = new Date().toISOString();
    const shouldUpdateProfiles = input.updateProfiles ?? config.syncProfileFields;

    for (const member of directory.users) {
      activeExternalIds.add(member.userid);
      const email = normalizeEmail(member.email || member.biz_mail || "");
      const conflict = Boolean(email && (externalEmailCounts.get(email) ?? 0) > 1);
      const previousMember = previousMemberByExternalId.get(member.userid);
      const verifiedIdentity = verifiedIdentityByExternalId.get(member.userid);
      const identityUser = verifiedIdentity ? localById.get(verifiedIdentity.user_id) ?? null : null;
      const emailUser = conflict || previousMember?.metadata.manual_unbound === true ? null : localByEmail.get(email) ?? null;
      const localUser = identityUser ?? (emailUser && !boundUserIds.has(emailUser.id) ? emailUser : null);
      const active = member.enable !== 0 && member.status !== 5;
      const names = member.department.map((id) => departmentNames.get(id)).filter((name): name is string => Boolean(name));
      if (conflict) conflicts += 1;
      if (!active) disabled += 1;
      if (localUser) {
        matched += 1;
        if (shouldUpdateProfiles) {
          const department = names[0] ?? localUser.department;
          const position = member.position?.trim() || localUser.position;
          if (department !== localUser.department || position !== localUser.position || member.name.trim() !== localUser.name) {
            await updateUserProfile(localUser.id, { name: member.name.trim() || localUser.name, department, position });
            profilesUpdated += 1;
          }
        }
        await upsertUserIdentity({
          connector_id: "wecom",
          user_id: localUser.id,
          external_user_id: member.userid,
          external_login: member.userid,
          external_email: email,
          binding_source: verifiedIdentity?.binding_source ?? "email",
          status: active ? "verified" : "inactive",
          verified_at: syncedAt,
          last_synced_at: syncedAt,
          metadata: { ...verifiedIdentity?.metadata, department_ids: member.department, main_department: member.main_department ?? null }
        });
      }
      await upsertDirectoryMember({
        connector_id: "wecom",
        external_user_id: member.userid,
        name: member.name.trim(),
        email,
        mobile_masked: maskMobile(member.mobile ?? ""),
        department_ids: member.department,
        department_names: names,
        position: member.position?.trim() ?? "",
        status: active ? "active" : "disabled",
        matched_user_id: localUser?.id ?? null,
        metadata: {
          ...previousMember?.metadata,
          email_masked: maskEmail(email),
          alias: member.alias ?? "",
          main_department: member.main_department ?? null
        },
        synced_at: syncedAt
      });
    }

    const missing = await markMissingDirectoryMembers("wecom", activeExternalIds);
    const completed = await finishSyncRun(run.id, {
      status: conflicts > 0 ? "partial" : "success",
      total_count: directory.users.length,
      success_count: directory.users.length - conflicts,
      matched_count: matched,
      updated_count: profilesUpdated,
      failed_count: conflicts,
      error_message: conflicts > 0 ? `${conflicts} 个成员邮箱重复，未自动绑定` : null,
      metadata: { departments: directory.departments.length, missing, update_profiles: shouldUpdateProfiles }
    });
    await updateConnectorState("wecom", {
      enabled: true,
      health_status: conflicts > 0 ? "degraded" : "healthy",
      public_config: getPublicIntegrationConfigs().wecom,
      last_checked_at: syncedAt,
      last_success_at: syncedAt,
      last_error: conflicts > 0 ? `${conflicts} 个成员邮箱冲突` : null,
      latency_ms: Date.now() - startedAt
    });
    return { departments: directory.departments.length, members: directory.users.length, matched, profiles_updated: profilesUpdated, disabled, conflicts, run: completed ?? run };
  } catch (error) {
    const message = error instanceof Error ? error.message : "企业微信通讯录同步失败";
    await finishSyncRun(run.id, { status: "failed", failed_count: 1, error_message: message });
    await updateConnectorState("wecom", { enabled: config.enabled, health_status: "error", public_config: getPublicIntegrationConfigs().wecom, last_checked_at: new Date().toISOString(), last_error: message, latency_ms: Date.now() - startedAt });
    throw error;
  }
}

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

function maskMobile(value: string) {
  const normalized = value.replace(/\s+/g, "");
  if (normalized.length < 7) return normalized ? "***" : "";
  return `${normalized.slice(0, 3)}****${normalized.slice(-4)}`;
}
