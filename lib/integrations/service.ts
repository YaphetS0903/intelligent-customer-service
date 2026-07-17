import { listUsers } from "@/lib/db";
import { getPublicIntegrationConfigs, getWecomConfig, getWinmailConfig } from "@/lib/integrations/config";
import { testWecomConnection } from "@/lib/integrations/providers/wecom/client";
import { testWinmailConnection } from "@/lib/integrations/providers/winmail/client";
import {
  listDeliveryLogs,
  listDirectoryMembers,
  listIntegrationConnectors,
  listSyncRuns,
  listUserIdentities,
  updateConnectorState
} from "@/lib/integrations/store";
import type { IntegrationProvider } from "@/lib/integrations/types";
import { listRegisteredTools } from "@/lib/integrations/tool-registry";
import { listToolExecutions } from "@/lib/integrations/tool-store";

export async function getIntegrationDashboard() {
  const configs = getPublicIntegrationConfigs();
  const wecom = getWecomConfig();
  const winmail = getWinmailConfig();
  await Promise.all([
    syncConnectorConfig("wecom", wecom.enabled, wecom.configured, configs.wecom),
    syncConnectorConfig("winmail", winmail.enabled, winmail.configured, configs.winmail)
  ]);
  const [connectors, members, identities, syncRuns, deliveryLogs, users, tools, toolExecutions] = await Promise.all([
    listIntegrationConnectors(),
    listDirectoryMembers({ connectorId: "wecom", limit: 1000 }),
    listUserIdentities(1000),
    listSyncRuns(50),
    listDeliveryLogs(100),
    listUsers(),
    listRegisteredTools(),
    listToolExecutions(100)
  ]);
  const userMap = new Map(users.map((user) => [user.id, { id: user.id, name: user.name, email: user.email, department: user.department, position: user.position }]));
  return {
    connectors,
    configs,
    directory: {
      members: members.map((member) => ({ ...member, local_user: member.matched_user_id ? userMap.get(member.matched_user_id) ?? null : null })),
      total: members.length,
      active: members.filter((member) => member.status === "active").length,
      matched: members.filter((member) => Boolean(member.matched_user_id)).length,
      unmatched: members.filter((member) => member.status === "active" && !member.matched_user_id).length
    },
    identities: identities.map((identity) => ({ ...identity, local_user: userMap.get(identity.user_id) ?? null })),
    users: users
      .filter((user) => user.status === "active")
      .map((user) => ({ id: user.id, name: user.name, email: user.email, department: user.department, position: user.position }))
      .sort((left, right) => left.name.localeCompare(right.name, "zh-CN")),
    sync_runs: syncRuns,
    delivery_logs: deliveryLogs,
    tools,
    tool_executions: toolExecutions
  };
}

export async function testIntegrationConnector(provider: IntegrationProvider) {
  const publicConfig = getPublicIntegrationConfigs()[provider];
  const enabled = provider === "wecom" ? getWecomConfig().enabled : getWinmailConfig().enabled;
  const startedAt = Date.now();
  try {
    const result = provider === "wecom" ? await testWecomConnection() : await testWinmailConnection();
    const checkedAt = new Date().toISOString();
    await updateConnectorState(provider, {
      enabled,
      health_status: enabled ? "healthy" : "disabled",
      public_config: publicConfig,
      last_checked_at: checkedAt,
      last_success_at: checkedAt,
      last_error: null,
      latency_ms: result.latency_ms
    });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : "连通测试失败";
    await updateConnectorState(provider, {
      enabled,
      health_status: "error",
      public_config: publicConfig,
      last_checked_at: new Date().toISOString(),
      last_error: message,
      latency_ms: Date.now() - startedAt
    });
    throw error;
  }
}

export async function refreshConnectorConfigState(provider: IntegrationProvider) {
  const configs = getPublicIntegrationConfigs();
  const config = provider === "wecom" ? getWecomConfig() : getWinmailConfig();
  return updateConnectorState(provider, {
    enabled: config.enabled,
    health_status: !config.configured ? "unconfigured" : config.enabled ? "degraded" : "disabled",
    public_config: configs[provider],
    last_error: null
  });
}

async function syncConnectorConfig(provider: IntegrationProvider, enabled: boolean, configured: boolean, publicConfig: Record<string, unknown>) {
  const current = (await listIntegrationConnectors()).find((item) => item.provider === provider);
  const health = !configured ? "unconfigured" : !enabled ? "disabled" : current?.health_status === "healthy" || current?.health_status === "error" ? current.health_status : "degraded";
  return updateConnectorState(provider, { enabled, health_status: health, public_config: publicConfig });
}
