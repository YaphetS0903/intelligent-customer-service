import { listUsers, updateUserProfile } from "@/lib/db";
import { getPublicIntegrationConfigs, getWecomConfig, maskEmail } from "@/lib/integrations/config";
import { fetchWecomDirectory } from "@/lib/integrations/providers/wecom/client";
import { decideWecomLifecycleAction, isWecomMemberActive } from "@/lib/integrations/providers/wecom/lifecycle-rules";
import {
  finishSyncRun,
  listDirectoryMembers,
  listUserIdentities,
  startSyncRun,
  updateConnectorState,
  upsertDirectoryMember,
  upsertUserIdentity
} from "@/lib/integrations/store";
import type { IntegrationUserIdentity, WecomDirectorySyncResult } from "@/lib/integrations/types";

type SyncInput = {
  startedBy: string;
  updateProfiles?: boolean;
  trigger?: "manual" | "schedule";
};

let activeSync: Promise<WecomDirectorySyncResult> | null = null;

export function syncWecomDirectory(input: SyncInput): Promise<WecomDirectorySyncResult> {
  activeSync ??= runWecomDirectorySync(input).finally(() => {
    activeSync = null;
  });
  return activeSync;
}

async function runWecomDirectorySync(input: SyncInput): Promise<WecomDirectorySyncResult> {
  const config = getWecomConfig();
  if (!config.enabled) throw new Error("企业微信连接器未启用");
  const operation = input.trigger === "schedule" ? "directory.sync.schedule" : "directory.sync";
  const run = await startSyncRun("wecom", operation, input.startedBy);
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
    const identityByExternalId = new Map(existingIdentities
      .filter((identity) => identity.connector_id === "wecom" && identity.status !== "conflict")
      .map((identity) => [identity.external_user_id, identity]));
    const boundUserIds = new Set(identityByExternalId.values().map((identity) => identity.user_id));
    const externalEmailCounts = new Map<string, number>();
    for (const member of directory.users) {
      const email = normalizeEmail(member.email || member.biz_mail || "");
      if (email) externalEmailCounts.set(email, (externalEmailCounts.get(email) ?? 0) + 1);
    }

    let matched = 0;
    let profilesUpdated = 0;
    let accountsDisabled = 0;
    let accountsRestored = 0;
    let disabledMembers = 0;
    let conflicts = 0;
    const activeExternalIds = new Set<string>();
    const syncedAt = new Date().toISOString();
    const shouldUpdateProfiles = input.updateProfiles ?? config.syncProfileFields;

    for (const member of directory.users) {
      activeExternalIds.add(member.userid);
      const email = normalizeEmail(member.email || member.biz_mail || "");
      const conflict = Boolean(email && (externalEmailCounts.get(email) ?? 0) > 1);
      const previousMember = previousMemberByExternalId.get(member.userid);
      const identity = identityByExternalId.get(member.userid);
      const identityUser = identity ? localById.get(identity.user_id) ?? null : null;
      const emailUser = email && !conflict && previousMember?.metadata.manual_unbound !== true
        ? localByEmail.get(email) ?? null
        : null;
      let localUser = identityUser ?? (emailUser && !boundUserIds.has(emailUser.id) ? emailUser : null);
      const active = isWecomMemberActive(member.enable, member.status);
      const names = member.department.map((id) => departmentNames.get(id)).filter((name): name is string => Boolean(name));

      if (conflict) conflicts += 1;
      if (!active) disabledMembers += 1;

      if (localUser) {
        matched += 1;
        const lifecycleAction = decideWecomLifecycleAction({
          memberActive: active,
          bindingSource: identity?.binding_source,
          identityMetadata: identity?.metadata,
          userRole: localUser.role,
          userStatus: localUser.status
        });
        if (lifecycleAction === "disable") {
          localUser = await updateUserProfile(localUser.id, { status: "disabled" });
          localById.set(localUser.id, localUser);
          accountsDisabled += 1;
        } else if (lifecycleAction === "restore") {
          localUser = await updateUserProfile(localUser.id, { status: "active" });
          localById.set(localUser.id, localUser);
          accountsRestored += 1;
        }

        if (active && shouldUpdateProfiles) {
          const department = names[0] ?? localUser.department;
          const position = member.position?.trim() || localUser.position;
          const name = member.name.trim() || localUser.name;
          if (department !== localUser.department || position !== localUser.position || name !== localUser.name) {
            localUser = await updateUserProfile(localUser.id, { name, department, position });
            localById.set(localUser.id, localUser);
            profilesUpdated += 1;
          }
        }

        const identityMetadata = lifecycleMetadata(identity, {
          active,
          action: lifecycleAction,
          reason: active ? null : "directory_disabled",
          syncedAt,
          userStatus: localUser.status
        });
        await upsertUserIdentity({
          connector_id: "wecom",
          user_id: localUser.id,
          external_user_id: member.userid,
          external_login: member.userid,
          external_email: email,
          binding_source: identity?.binding_source ?? "email",
          status: active ? "verified" : "inactive",
          verified_at: active ? identity?.verified_at ?? syncedAt : identity?.verified_at ?? null,
          last_synced_at: syncedAt,
          metadata: { ...identityMetadata, department_ids: member.department, main_department: member.main_department ?? null }
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

    const missingMembers = existingMembers.filter((member) => !activeExternalIds.has(member.external_user_id));
    for (const member of missingMembers) {
      const identity = identityByExternalId.get(member.external_user_id);
      let localUser = identity ? localById.get(identity.user_id) ?? null : null;
      const lifecycleAction = localUser ? decideWecomLifecycleAction({
        memberActive: false,
        bindingSource: identity?.binding_source,
        identityMetadata: identity?.metadata,
        userRole: localUser.role,
        userStatus: localUser.status
      }) : "none";
      if (localUser && lifecycleAction === "disable") {
        localUser = await updateUserProfile(localUser.id, { status: "disabled" });
        localById.set(localUser.id, localUser);
        accountsDisabled += 1;
      }
      if (identity) {
        await upsertUserIdentity({
          connector_id: "wecom",
          user_id: identity.user_id,
          external_user_id: identity.external_user_id,
          external_login: identity.external_login,
          external_email: identity.external_email,
          binding_source: identity.binding_source,
          status: "inactive",
          verified_at: identity.verified_at,
          last_synced_at: syncedAt,
          metadata: lifecycleMetadata(identity, {
            active: false,
            action: lifecycleAction,
            reason: "directory_missing",
            syncedAt,
            userStatus: localUser?.status ?? "disabled"
          })
        });
      }
      await upsertDirectoryMember({
        ...member,
        status: "missing",
        matched_user_id: identity?.user_id ?? member.matched_user_id,
        metadata: { ...member.metadata, missing_since: member.metadata.missing_since ?? syncedAt },
        synced_at: syncedAt
      });
    }

    const updatedCount = profilesUpdated + accountsDisabled + accountsRestored;
    const completed = await finishSyncRun(run.id, {
      status: conflicts > 0 ? "partial" : "success",
      total_count: directory.users.length,
      success_count: directory.users.length - conflicts,
      matched_count: matched,
      updated_count: updatedCount,
      failed_count: conflicts,
      error_message: conflicts > 0 ? `${conflicts} 个成员邮箱重复，未自动绑定` : null,
      metadata: {
        departments: directory.departments.length,
        missing: missingMembers.length,
        disabled_members: disabledMembers,
        profiles_updated: profilesUpdated,
        accounts_disabled: accountsDisabled,
        accounts_restored: accountsRestored,
        update_profiles: shouldUpdateProfiles,
        trigger: input.trigger ?? "manual"
      }
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
    return {
      departments: directory.departments.length,
      members: directory.users.length,
      matched,
      profiles_updated: profilesUpdated,
      disabled: disabledMembers + missingMembers.length,
      accounts_disabled: accountsDisabled,
      accounts_restored: accountsRestored,
      conflicts,
      run: completed ?? run
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "企业微信通讯录同步失败";
    await finishSyncRun(run.id, { status: "failed", failed_count: 1, error_message: message });
    await updateConnectorState("wecom", {
      enabled: config.enabled,
      health_status: "error",
      public_config: getPublicIntegrationConfigs().wecom,
      last_checked_at: new Date().toISOString(),
      last_error: message,
      latency_ms: Date.now() - startedAt
    });
    throw error;
  }
}

function lifecycleMetadata(
  identity: IntegrationUserIdentity | undefined,
  input: {
    active: boolean;
    action: "disable" | "restore" | "none";
    reason: "directory_disabled" | "directory_missing" | null;
    syncedAt: string;
    userStatus: string;
  }
) {
  const metadata = { ...identity?.metadata };
  if (input.action === "disable") {
    return {
      ...metadata,
      lifecycle_disabled: true,
      lifecycle_disabled_at: input.syncedAt,
      lifecycle_disabled_reason: input.reason
    };
  }
  if (input.action === "restore" || input.active && input.userStatus === "active" && metadata.lifecycle_disabled === true) {
    return {
      ...metadata,
      lifecycle_disabled: false,
      lifecycle_restored_at: input.syncedAt,
      lifecycle_disabled_reason: null
    };
  }
  return metadata;
}

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

function maskMobile(value: string) {
  const normalized = value.replace(/\s+/g, "");
  if (normalized.length < 7) return normalized ? "***" : "";
  return `${normalized.slice(0, 3)}****${normalized.slice(-4)}`;
}
