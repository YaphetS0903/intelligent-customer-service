"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Building2, CheckCircle2, ChevronDown, CircleAlert, Link2, Loader2, Mail, RefreshCw, Search, Send, Settings2, Unlink, UsersRound, X } from "lucide-react";
import { ActionConfirmDialog, ErrorRetry, PanelSkeleton, useToast, type ActionConfirmRequest } from "@/components/ui-feedback";
import type { IntegrationConnector, IntegrationDeliveryLog, IntegrationDirectoryMember, IntegrationSyncRun, IntegrationUserIdentity } from "@/lib/integrations/types";

type Dashboard = {
  connectors: IntegrationConnector[];
  configs: {
    wecom: { enabled: boolean; sso_enabled: boolean; notification_enabled: boolean; configured: boolean; notification_configured: boolean; corp_id_masked: string; corp_secret_configured: boolean; agent_id: string; api_base_url: string; root_department_id: number; sync_profile_fields: boolean; auto_provision_users: boolean; directory_sync_enabled: boolean; directory_sync_interval_minutes: number; sync_cron_secret_configured: boolean };
    winmail: { enabled: boolean; notification_enabled: boolean; configured: boolean; api_url: string; api_key_masked: string; api_secret_configured: boolean; sender_user_masked: string; sender_password_configured: boolean; sender_name: string; allow_insecure_http: boolean; timeout_ms: number };
  };
  directory: { members: Array<IntegrationDirectoryMember & { local_user?: { id: string; name: string; email: string; department: string; position: string } | null }>; total: number; active: number; matched: number; unmatched: number };
  identities: Array<IntegrationUserIdentity & { local_user?: { id: string; name: string; email: string; department: string; position: string } | null }>;
  users: Array<{ id: string; name: string; email: string; department: string; position: string }>;
  sync_runs: IntegrationSyncRun[];
  delivery_logs: IntegrationDeliveryLog[];
};

type View = "connectors" | "directory" | "logs";
type DirectoryMember = Dashboard["directory"]["members"][number];
type ConfirmState = ActionConfirmRequest & { action: () => Promise<void> };

export function IntegrationAdmin() {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [view, setView] = useState<View>("connectors");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [working, setWorking] = useState<string | null>(null);
  const [updateProfiles, setUpdateProfiles] = useState(false);
  const [testEmail, setTestEmail] = useState("");
  const [testWecomUserId, setTestWecomUserId] = useState("");
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [bindingMember, setBindingMember] = useState<DirectoryMember | null>(null);
  const [bindingUserId, setBindingUserId] = useState("");
  const { pushToast } = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/admin/integrations", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "读取集成中心失败");
      setDashboard(data);
      setLoadError(null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "读取集成中心失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const connectorMap = useMemo(() => new Map(dashboard?.connectors.map((item) => [item.provider, item]) ?? []), [dashboard]);
  const wecomRecipients = useMemo(() => dashboard?.identities.filter((item) => item.connector_id === "wecom" && item.status === "verified" && item.local_user) ?? [], [dashboard]);

  useEffect(() => {
    if (testWecomUserId && !wecomRecipients.some((item) => item.user_id === testWecomUserId)) setTestWecomUserId("");
  }, [testWecomUserId, wecomRecipients]);

  async function saveConfig(provider: "wecom" | "winmail", form: HTMLFormElement) {
    setWorking(`${provider}:save`);
    try {
      const formData = new FormData(form);
      const settings: Record<string, string | boolean> = {};
      for (const [key, value] of formData.entries()) settings[key] = String(value);
      for (const checkbox of form.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')) settings[checkbox.name] = checkbox.checked;
      const response = await fetch(`/api/admin/integrations/config/${provider}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ settings }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "保存失败");
      pushToast({ tone: "success", title: "集成配置已保存", description: data.notice });
      await load();
    } catch (error) {
      pushToast({ tone: "error", title: "保存集成配置失败", description: error instanceof Error ? error.message : "保存失败" });
    } finally { setWorking(null); }
  }

  async function testConnector(provider: "wecom" | "winmail") {
    setWorking(`${provider}:test`);
    try {
      const response = await fetch(`/api/admin/integrations/${provider}/test`, { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "连通测试失败");
      pushToast({ tone: "success", title: provider === "wecom" ? "企业微信连通正常" : "Winmail 连通正常", description: `响应耗时 ${data.result.latency_ms}ms` });
      await load();
    } catch (error) {
      pushToast({ tone: "error", title: "连通测试失败", description: error instanceof Error ? error.message : "请检查配置" });
      await load();
    } finally { setWorking(null); }
  }

  async function syncDirectory() {
    setWorking("wecom:sync");
    try {
      const response = await fetch("/api/admin/integrations/wecom/sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ update_profiles: updateProfiles }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "同步失败");
      pushToast({
        tone: "success",
        title: "企业微信通讯录已同步",
        description: `${data.result.members} 位成员，更新资料 ${data.result.profiles_updated} 个，禁用账号 ${data.result.accounts_disabled} 个，恢复账号 ${data.result.accounts_restored} 个。`
      });
      setView("directory");
      await load();
    } catch (error) {
      pushToast({ tone: "error", title: "通讯录同步失败", description: error instanceof Error ? error.message : "请检查可见范围和可信 IP" });
      await load();
    } finally { setWorking(null); }
  }

  async function sendTestMail() {
    if (!testEmail.trim()) return;
    setWorking("winmail:mail");
    try {
      const response = await fetch("/api/admin/integrations/winmail/send-test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: testEmail.trim() }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "发送失败");
      pushToast({ tone: "success", title: "测试邮件已发送", description: "请到收件箱检查 Winmail 投递结果。" });
      setView("logs");
      await load();
    } catch (error) {
      pushToast({ tone: "error", title: "测试邮件发送失败", description: error instanceof Error ? error.message : "请检查 Winmail 配置" });
      await load();
    } finally { setWorking(null); }
  }

  async function sendTestWecomMessage() {
    if (!testWecomUserId) return;
    setWorking("wecom:message");
    try {
      const response = await fetch("/api/admin/integrations/wecom/send-test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ user_id: testWecomUserId }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "发送失败");
      pushToast({ tone: "success", title: "企业微信测试消息已发送", description: "请在企业微信自建应用中检查消息。" });
      setView("logs");
      await load();
    } catch (error) {
      pushToast({ tone: "error", title: "企业微信测试消息发送失败", description: error instanceof Error ? error.message : "请检查 AgentID 与应用可见范围" });
      await load();
    } finally { setWorking(null); }
  }

  function requestTestWecomMessage() {
    const recipient = wecomRecipients.find((item) => item.user_id === testWecomUserId)?.local_user;
    if (!recipient) return;
    setConfirmState({
      title: "确认发送企业微信测试消息",
      description: `测试消息将只发送给「${recipient.name}」。`,
      details: [`系统账号：${recipient.email}`, "发送后会产生一条企业微信投递记录。"],
      confirmLabel: "确认发送",
      tone: "warning",
      action: sendTestWecomMessage
    });
  }

  async function bindIdentity() {
    if (!bindingMember || !bindingUserId) return;
    setWorking(`wecom:bind:${bindingMember.external_user_id}`);
    try {
      const response = await fetch("/api/admin/integrations/wecom/bindings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ external_user_id: bindingMember.external_user_id, user_id: bindingUserId }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "绑定失败");
      pushToast({ tone: "success", title: "企业微信账号已绑定", description: `${bindingMember.name} 已绑定到 ${data.result.user.name}` });
      setBindingMember(null);
      setBindingUserId("");
      await load();
    } catch (error) {
      pushToast({ tone: "error", title: "绑定失败", description: error instanceof Error ? error.message : "请检查账号是否已被占用" });
    } finally { setWorking(null); }
  }

  function requestUnbind(member: DirectoryMember) {
    if (!member.local_user) return;
    setConfirmState({
      title: "确认解除企业微信绑定",
      description: `将解除「${member.name}」与系统账号「${member.local_user.name}」的绑定。`,
      details: [member.local_user.email, "解绑后该账号将不再接收企业微信业务通知，后续同步也不会自动绑回。"],
      confirmLabel: "确认解绑",
      tone: "danger",
      action: async () => {
        setWorking(`wecom:unbind:${member.external_user_id}`);
        try {
          const response = await fetch("/api/admin/integrations/wecom/bindings", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ external_user_id: member.external_user_id }) });
          const data = await response.json();
          if (!response.ok) throw new Error(data.error ?? "解绑失败");
          pushToast({ tone: "success", title: "企业微信绑定已解除", description: `${member.name} 已恢复为待匹配状态。` });
          setTestWecomUserId("");
          await load();
        } catch (error) {
          pushToast({ tone: "error", title: "解绑失败", description: error instanceof Error ? error.message : "请稍后重试" });
        } finally { setWorking(null); }
      }
    });
  }

  async function confirmAction() {
    const action = confirmState?.action;
    setConfirmState(null);
    if (action) await action();
  }

  if (loading && !dashboard) return <IntegrationSkeleton />;
  if (loadError && !dashboard) return <ErrorRetry title="集成中心加载失败" message={loadError} retrying={loading} onRetry={() => void load()} />;
  if (!dashboard) return null;

  const wecomConnector = connectorMap.get("wecom");
  const winmailConnector = connectorMap.get("winmail");

  return (
    <div className="space-y-3 pb-6">
      <header className="flex flex-col gap-3 border-b border-line pb-3 sm:flex-row sm:items-center sm:justify-between" data-testid="integrations-header">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-cyan/10 text-brand"><Settings2 size={18} /></span>
          <div className="min-w-0"><h1 className="text-xl font-semibold text-ink">业务集成</h1><p className="truncate text-sm text-slate-500">企业微信通讯录与应用通知、Winmail 邮件通知</p></div>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading} className="ui-button-secondary h-10 self-start sm:self-auto">{loading ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}刷新</button>
      </header>

      <section className="grid grid-cols-2 gap-3 xl:grid-cols-4" data-testid="integration-metrics">
        <Metric label="连接器" value="2" />
        <Metric label="健康" value={dashboard.connectors.filter((item) => item.health_status === "healthy").length} tone="good" />
        <Metric label="通讯录成员" value={dashboard.directory.total} />
        <Metric label="已匹配账号" value={dashboard.directory.matched} tone="good" />
      </section>

      <section className="ui-card grid grid-cols-3 gap-1 p-1.5" aria-label="业务集成视图">
        <ViewButton active={view === "connectors"} onClick={() => setView("connectors")}>连接器</ViewButton>
        <ViewButton active={view === "directory"} onClick={() => setView("directory")}>通讯录·{dashboard.directory.total}</ViewButton>
        <ViewButton active={view === "logs"} onClick={() => setView("logs")}>同步与投递</ViewButton>
      </section>

      {view === "connectors" && (
        <section className="grid gap-3 xl:grid-cols-2">
          <ConnectorPanel icon={<Building2 size={18} />} title="企业微信通讯录与通知" description="同步自建应用可见范围内的成员，并向已精确匹配的系统账号发送业务通知。" connector={wecomConnector}>
            <form key={JSON.stringify(dashboard.configs.wecom)} onSubmit={(event) => { event.preventDefault(); void saveConfig("wecom", event.currentTarget); }} className="grid gap-3 sm:grid-cols-2">
              <Toggle name="WECOM_ENABLED" label="启用连接器" defaultChecked={dashboard.configs.wecom.enabled} />
              <Toggle name="WECOM_NOTIFICATION_ENABLED" label="启用应用消息通知" defaultChecked={dashboard.configs.wecom.notification_enabled} />
              <Toggle name="WECOM_SSO_ENABLED" label="启用企业微信单点登录" defaultChecked={dashboard.configs.wecom.sso_enabled} />
              <Toggle name="WECOM_SYNC_PROFILE_FIELDS" label="默认同步部门/岗位" defaultChecked={dashboard.configs.wecom.sync_profile_fields} />
              <Toggle name="WECOM_AUTO_PROVISION_USERS" label="首次登录自动创建员工账号" defaultChecked={dashboard.configs.wecom.auto_provision_users} />
              <Toggle name="WECOM_DIRECTORY_SYNC_ENABLED" label="启用员工生命周期定时同步" defaultChecked={dashboard.configs.wecom.directory_sync_enabled} />
              <Field name="WECOM_DIRECTORY_SYNC_INTERVAL_MINUTES" label="同步间隔（分钟）" defaultValue={String(dashboard.configs.wecom.directory_sync_interval_minutes)} inputMode="numeric" />
              <Field name="WECOM_CORP_ID" label="CorpID" placeholder={dashboard.configs.wecom.corp_id_masked || "wwxxxxxxxx"} />
              <SecretField name="WECOM_CORP_SECRET" label="CorpSecret" configured={dashboard.configs.wecom.corp_secret_configured} />
              <Field name="WECOM_AGENT_ID" label="应用 AgentID" defaultValue={dashboard.configs.wecom.agent_id} />
              <Field name="WECOM_ROOT_DEPARTMENT_ID" label="根部门 ID" defaultValue={String(dashboard.configs.wecom.root_department_id)} inputMode="numeric" />
              <Field name="WECOM_API_BASE_URL" label="API 地址" defaultValue={dashboard.configs.wecom.api_base_url} className="sm:col-span-2" />
              <div className="flex flex-wrap gap-2 sm:col-span-2"><button disabled={working !== null} className="ui-button-primary h-10">{working === "wecom:save" ? <Loader2 size={16} className="animate-spin" /> : null}保存配置</button><button type="button" onClick={() => void testConnector("wecom")} disabled={working !== null || !dashboard.configs.wecom.configured} className="ui-button-secondary h-10">{working === "wecom:test" ? <Loader2 size={16} className="animate-spin" /> : null}测试连通</button></div>
            </form>
            <div className="mt-4 border-t border-line pt-4">
              <label className="flex min-h-11 items-center gap-2 text-sm text-slate-600"><input type="checkbox" checked={updateProfiles} onChange={(event) => setUpdateProfiles(event.target.checked)} />本次同步更新已匹配账号的姓名、部门和岗位</label>
              <button type="button" onClick={() => void syncDirectory()} disabled={working !== null || !dashboard.configs.wecom.enabled || !dashboard.configs.wecom.configured} className="ui-button-success mt-2 h-10 w-full">{working === "wecom:sync" ? <Loader2 size={16} className="animate-spin" /> : <UsersRound size={16} />}同步企业微信通讯录</button>
              <p className={`mt-2 text-xs ${dashboard.configs.wecom.directory_sync_enabled && dashboard.configs.wecom.sync_cron_secret_configured ? "text-emerald-700" : "text-slate-500"}`}>
                {dashboard.configs.wecom.directory_sync_enabled
                  ? `定时同步每 ${dashboard.configs.wecom.directory_sync_interval_minutes} 分钟检查一次员工状态${dashboard.configs.wecom.sync_cron_secret_configured ? "，调度已就绪。" : "，但服务器调度密钥尚未配置。"}`
                  : "定时同步未启用，当前只在管理员手动操作时更新通讯录。"}
              </p>
            </div>
            <div className="mt-4 border-t border-line pt-4"><label className="text-sm font-medium text-slate-700" htmlFor="wecom-test-user">测试接收账号</label><div className="mt-2 flex flex-col gap-2 sm:flex-row"><select id="wecom-test-user" value={testWecomUserId} onChange={(event) => setTestWecomUserId(event.target.value)} className="ui-input h-10 min-w-0 flex-1"><option value="">{wecomRecipients.length ? "请选择已匹配账号" : "暂无已匹配账号"}</option>{wecomRecipients.map((identity) => <option key={identity.id} value={identity.user_id}>{identity.local_user?.name}（{identity.local_user?.email}）</option>)}</select><button type="button" onClick={requestTestWecomMessage} disabled={working !== null || !testWecomUserId || !dashboard.configs.wecom.enabled || !dashboard.configs.wecom.notification_configured} className="ui-button-success h-10">{working === "wecom:message" ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}发送测试消息</button></div>{!dashboard.configs.wecom.notification_configured && <p className="mt-2 text-xs text-amber-700">配置应用 AgentID 后才可发送应用消息。</p>}</div>
          </ConnectorPanel>

          <ConnectorPanel icon={<Mail size={18} />} title="Winmail 邮件通知" description="使用系统专用发件账号投递课程、审批、工单和安全通知，不保存员工邮箱密码。" connector={winmailConnector}>
            <form key={JSON.stringify(dashboard.configs.winmail)} onSubmit={(event) => { event.preventDefault(); void saveConfig("winmail", event.currentTarget); }} className="grid gap-3 sm:grid-cols-2">
              <Toggle name="WINMAIL_ENABLED" label="启用连接器" defaultChecked={dashboard.configs.winmail.enabled} />
              <Toggle name="WINMAIL_NOTIFICATION_ENABLED" label="启用业务邮件投递" defaultChecked={dashboard.configs.winmail.notification_enabled} />
              <Field name="WINMAIL_API_URL" label="OpenAPI URL" defaultValue={dashboard.configs.winmail.api_url} placeholder="https://mail.example.com/openapi.php" className="sm:col-span-2" />
              <Field name="WINMAIL_API_KEY" label="ApiKey" placeholder={dashboard.configs.winmail.api_key_masked || "ApiKey"} />
              <SecretField name="WINMAIL_API_SECRET" label="ApiSecret" configured={dashboard.configs.winmail.api_secret_configured} />
              <Field name="WINMAIL_SENDER_USER" label="专用发件邮箱" placeholder={dashboard.configs.winmail.sender_user_masked || "notice@example.com"} />
              <SecretField name="WINMAIL_SENDER_PASSWORD" label="发件邮箱密码" configured={dashboard.configs.winmail.sender_password_configured} />
              <Field name="WINMAIL_SENDER_NAME" label="发件人名称" defaultValue={dashboard.configs.winmail.sender_name} />
              <Field name="WINMAIL_TIMEOUT_MS" label="超时（ms）" defaultValue={String(dashboard.configs.winmail.timeout_ms)} inputMode="numeric" />
              <Toggle name="WINMAIL_ALLOW_INSECURE_HTTP" label="允许受控内网 HTTP" defaultChecked={dashboard.configs.winmail.allow_insecure_http} className="sm:col-span-2" />
              <div className="flex flex-wrap gap-2 sm:col-span-2"><button disabled={working !== null} className="ui-button-primary h-10">{working === "winmail:save" ? <Loader2 size={16} className="animate-spin" /> : null}保存配置</button><button type="button" onClick={() => void testConnector("winmail")} disabled={working !== null || !dashboard.configs.winmail.configured} className="ui-button-secondary h-10">{working === "winmail:test" ? <Loader2 size={16} className="animate-spin" /> : null}测试登录</button></div>
            </form>
            <div className="mt-4 border-t border-line pt-4"><label className="text-sm font-medium text-slate-700" htmlFor="winmail-test-email">测试收件邮箱</label><div className="mt-2 flex flex-col gap-2 sm:flex-row"><input id="winmail-test-email" type="email" value={testEmail} onChange={(event) => setTestEmail(event.target.value)} placeholder="name@example.com" className="ui-input h-10 min-w-0 flex-1" /><button type="button" onClick={() => void sendTestMail()} disabled={working !== null || !testEmail.trim() || !dashboard.configs.winmail.enabled || !dashboard.configs.winmail.configured} className="ui-button-success h-10">{working === "winmail:mail" ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}发送测试邮件</button></div></div>
          </ConnectorPanel>
        </section>
      )}

      {view === "directory" && <DirectoryView dashboard={dashboard} working={working} onBind={(member) => { setBindingMember(member); setBindingUserId(""); }} onUnbind={requestUnbind} />}
      {view === "logs" && <LogsView runs={dashboard.sync_runs} deliveries={dashboard.delivery_logs} />}
      <BindingDialog member={bindingMember} users={dashboard.users} identities={dashboard.identities} userId={bindingUserId} working={working !== null} onUserChange={setBindingUserId} onCancel={() => { setBindingMember(null); setBindingUserId(""); }} onConfirm={() => void bindIdentity()} />
      <ActionConfirmDialog request={confirmState} onCancel={() => setConfirmState(null)} onConfirm={() => void confirmAction()} />
    </div>
  );
}

function ConnectorPanel({ icon, title, description, connector, children }: { icon: React.ReactNode; title: string; description: string; connector?: IntegrationConnector; children: React.ReactNode }) {
  return <article className="ui-card overflow-hidden"><div className="flex items-start justify-between gap-3 border-b border-line p-4"><div className="flex min-w-0 gap-3"><span className="grid size-9 shrink-0 place-items-center rounded-lg bg-cyan/10 text-brand">{icon}</span><div><h2 className="text-base font-semibold text-ink">{title}</h2><p className="mt-1 text-sm leading-6 text-slate-500">{description}</p></div></div><HealthBadge connector={connector} /></div><details className="group"><summary className="flex min-h-11 cursor-pointer list-none items-center justify-between px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 [&::-webkit-details-marker]:hidden"><span>展开配置与操作</span><ChevronDown size={16} className="text-slate-400 transition group-open:rotate-180" /></summary><div className="border-t border-line p-4">{children}</div></details></article>;
}

function DirectoryView({ dashboard, working, onBind, onUnbind }: { dashboard: Dashboard; working: string | null; onBind: (member: DirectoryMember) => void; onUnbind: (member: DirectoryMember) => void }) {
  const [filter, setFilter] = useState<"unmatched" | "matched" | "all">("unmatched");
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLowerCase();
  const filtered = dashboard.directory.members.filter((member) => {
    if (member.status !== "active") return filter === "all";
    if (filter === "unmatched" && member.matched_user_id) return false;
    if (filter === "matched" && !member.matched_user_id) return false;
    if (!normalizedQuery) return true;
    return [member.name, member.email, member.external_user_id, member.department_names.join(" "), member.position, member.local_user?.name, member.local_user?.email].some((value) => value?.toLowerCase().includes(normalizedQuery));
  });
  const visible = filtered.slice(0, 50);
  return <section className="space-y-3"><div className="grid grid-cols-2 gap-3 lg:grid-cols-4"><Metric label="同步成员" value={dashboard.directory.total} /><Metric label="在职" value={dashboard.directory.active} tone="good" /><Metric label="已匹配" value={dashboard.directory.matched} tone="good" /><Metric label="待匹配" value={dashboard.directory.unmatched} tone={dashboard.directory.unmatched ? "warn" : "good"} /></div><div className="ui-card flex flex-col gap-3 p-3 lg:flex-row lg:items-center lg:justify-between"><div className="grid grid-cols-3 gap-1 rounded-lg bg-slate-100 p-1"><FilterButton active={filter === "unmatched"} onClick={() => setFilter("unmatched")}>待匹配 {dashboard.directory.unmatched}</FilterButton><FilterButton active={filter === "matched"} onClick={() => setFilter("matched")}>已匹配 {dashboard.directory.matched}</FilterButton><FilterButton active={filter === "all"} onClick={() => setFilter("all")}>全部 {dashboard.directory.total}</FilterButton></div><label className="relative block min-w-0 lg:w-80"><Search size={16} className="pointer-events-none absolute left-3 top-3 text-slate-400" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索姓名、邮箱、部门或岗位" className="ui-input h-10 w-full pl-9" /></label></div><p className="text-xs text-slate-500">找到 {filtered.length} 条，当前最多展示 50 条，请使用搜索快速定位员工。</p><div className="hidden overflow-hidden ui-card lg:block"><div className="overflow-x-auto"><table className="min-w-[980px] w-full text-sm"><thead className="bg-slate-50 text-left text-xs text-slate-500"><tr><th className="px-4 py-3">企业微信成员</th><th className="px-4 py-3">部门/岗位</th><th className="px-4 py-3">系统账号</th><th className="px-4 py-3">状态</th><th className="px-4 py-3 text-right">操作</th></tr></thead><tbody className="divide-y divide-line">{visible.map((member) => <tr key={member.id}><td className="px-4 py-3"><p className="font-medium text-ink">{member.name}</p><p className="mt-1 text-xs text-slate-500">{member.email || member.external_user_id}</p></td><td className="px-4 py-3 text-slate-600">{member.department_names.join(" / ") || "未记录"}<p className="mt-1 text-xs text-slate-400">{member.position || "未记录岗位"}</p></td><td className="px-4 py-3">{member.local_user ? <><p className="font-medium text-emerald-700">{member.local_user.name}</p><p className="text-xs text-slate-500">{member.local_user.email}</p></> : <span className="text-amber-700">待匹配</span>}</td><td className="px-4 py-3"><StatusText status={member.status} /></td><td className="px-4 py-3 text-right"><BindingButton member={member} working={working} onBind={onBind} onUnbind={onUnbind} /></td></tr>)}</tbody></table></div></div><div className="grid gap-3 lg:hidden">{visible.map((member) => <article key={member.id} className="ui-card p-4"><div className="flex items-start justify-between gap-3"><div><h3 className="text-sm font-semibold text-ink">{member.name}</h3><p className="mt-1 break-all text-xs text-slate-500">{member.email || member.external_user_id}</p></div><StatusText status={member.status} /></div><p className="mt-3 text-sm text-slate-600">{member.department_names.join(" / ") || "未记录部门"} · {member.position || "未记录岗位"}</p><p className={`mt-2 text-sm ${member.local_user ? "text-emerald-700" : "text-amber-700"}`}>{member.local_user ? `已匹配：${member.local_user.name}（${member.local_user.email}）` : "待匹配系统账号"}</p><div className="mt-3"><BindingButton member={member} working={working} onBind={onBind} onUnbind={onUnbind} /></div></article>)}</div>{visible.length === 0 && <div className="ui-card px-4 py-10 text-center text-sm text-slate-500">没有符合条件的企业微信成员。</div>}</section>;
}

function BindingButton({ member, working, onBind, onUnbind }: { member: DirectoryMember; working: string | null; onBind: (member: DirectoryMember) => void; onUnbind: (member: DirectoryMember) => void }) { const busy = working?.endsWith(member.external_user_id); return member.local_user ? <button type="button" onClick={() => onUnbind(member)} disabled={Boolean(working)} className="ui-button-secondary h-9 px-3">{busy ? <Loader2 size={15} className="animate-spin" /> : <Unlink size={15} />}解绑</button> : <button type="button" onClick={() => onBind(member)} disabled={Boolean(working) || member.status !== "active"} className="ui-button-primary h-9 px-3"><Link2 size={15} />绑定账号</button>; }

function BindingDialog({ member, users, identities, userId, working, onUserChange, onCancel, onConfirm }: { member: DirectoryMember | null; users: Dashboard["users"]; identities: Dashboard["identities"]; userId: string; working: boolean; onUserChange: (value: string) => void; onCancel: () => void; onConfirm: () => void }) {
  if (!member) return null;
  const occupied = new Set(identities.filter((identity) => identity.connector_id === "wecom" && identity.status === "verified").map((identity) => identity.user_id));
  const available = users.filter((user) => !occupied.has(user.id));
  return <div className="fixed inset-0 z-[940] flex items-end justify-center bg-slate-950/45 px-3 py-4 backdrop-blur-sm sm:items-center"><section role="dialog" aria-modal="true" aria-labelledby="wecom-binding-title" className="w-full max-w-lg rounded-lg border border-line bg-white p-4 shadow-panel"><div className="flex items-start justify-between gap-3"><div><h2 id="wecom-binding-title" className="text-base font-semibold text-ink">绑定系统账号</h2><p className="mt-1 text-sm text-slate-500">企业微信成员：{member.name}</p><p className="mt-1 break-all text-xs text-slate-400">{member.email || member.external_user_id}</p></div><button type="button" onClick={onCancel} aria-label="关闭绑定框" className="grid size-9 place-items-center rounded-lg text-slate-500 hover:bg-slate-100"><X size={16} /></button></div><label className="mt-4 block"><span className="text-sm font-medium text-slate-700">系统账号</span><select value={userId} onChange={(event) => onUserChange(event.target.value)} className="ui-input mt-1 h-11 w-full"><option value="">请选择未绑定的系统账号</option>{available.map((user) => <option key={user.id} value={user.id}>{user.name}（{user.email}）</option>)}</select></label><p className="mt-3 text-xs leading-5 text-slate-500">绑定后，该系统账号的课程、审批、工单和安全通知会发送到此企业微信成员。</p><div className="mt-4 grid gap-2 sm:flex sm:justify-end"><button type="button" onClick={onCancel} disabled={working} className="ui-button-secondary h-11 justify-center">取消</button><button type="button" onClick={onConfirm} disabled={working || !userId} className="ui-button-primary h-11 justify-center">{working ? <Loader2 size={16} className="animate-spin" /> : <Link2 size={16} />}确认绑定</button></div></section></div>;
}

function LogsView({ runs, deliveries }: { runs: IntegrationSyncRun[]; deliveries: IntegrationDeliveryLog[] }) {
  return <section className="grid gap-3 xl:grid-cols-2"><div className="ui-card p-4"><h2 className="text-base font-semibold text-ink">通讯录同步记录</h2><div className="mt-3 space-y-2">{runs.slice(0, 20).map((run) => <div key={run.id} className="rounded-lg border border-line px-3 py-3"><div className="flex items-center justify-between gap-3"><p className="text-sm font-semibold text-ink">{run.connector_id === "wecom" ? `企业微信通讯录 · ${run.operation === "directory.sync.schedule" ? "定时" : "手动"}` : run.connector_id}</p><RunStatus status={run.status} /></div><p className="mt-2 text-xs text-slate-500">总数 {run.total_count} · 匹配 {run.matched_count} · 资料更新 {metadataNumber(run, "profiles_updated")} · 禁用 {metadataNumber(run, "accounts_disabled")} · 恢复 {metadataNumber(run, "accounts_restored")}</p>{run.error_message && <p className="mt-2 text-xs text-red-700">{run.error_message}</p>}<p className="mt-2 text-xs text-slate-400">{formatDate(run.started_at)}</p></div>)}{runs.length === 0 && <p className="py-8 text-center text-sm text-slate-500">暂无同步记录。</p>}</div></div><div className="ui-card p-4"><h2 className="text-base font-semibold text-ink">外部通知投递记录</h2><div className="mt-3 space-y-2">{deliveries.slice(0, 30).map((item) => <div key={item.id} className="rounded-lg border border-line px-3 py-3"><div className="flex items-center justify-between gap-3"><p className="min-w-0 truncate text-sm font-semibold text-ink">{item.subject}</p><DeliveryStatus status={item.status} /></div><p className="mt-2 text-xs font-medium text-slate-600">{item.connector_id === "wecom" ? "企业微信应用消息" : "Winmail 邮件"}</p><p className="mt-1 text-xs text-slate-500">{item.recipient_masked || "未记录收件人"}{item.latency_ms !== null ? ` · ${item.latency_ms}ms` : ""}</p>{item.error_message && <p className="mt-2 text-xs text-red-700">{item.error_message}</p>}<p className="mt-2 text-xs text-slate-400">{formatDate(item.created_at)}</p></div>)}{deliveries.length === 0 && <p className="py-8 text-center text-sm text-slate-500">暂无外部通知投递记录。</p>}</div></div></section>;
}

function metadataNumber(run: IntegrationSyncRun, key: string) { const value = Number(run.metadata[key] ?? 0); return Number.isFinite(value) ? value : 0; }

function Field({ name, label, defaultValue, placeholder, className = "", inputMode }: { name: string; label: string; defaultValue?: string; placeholder?: string; className?: string; inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"] }) { return <label className={`block ${className}`}><span className="text-sm font-medium text-slate-700">{label}</span><input name={name} defaultValue={defaultValue} placeholder={placeholder} inputMode={inputMode} className="ui-input mt-1 h-11 w-full" /></label>; }
function SecretField({ name, label, configured }: { name: string; label: string; configured: boolean }) { return <label className="block"><span className="text-sm font-medium text-slate-700">{label}</span><input type="password" name={name} autoComplete="new-password" placeholder={configured ? "已配置，留空保留原值" : "请填写"} className="ui-input mt-1 h-11 w-full" /></label>; }
function Toggle({ name, label, defaultChecked, className = "" }: { name: string; label: string; defaultChecked: boolean; className?: string }) { return <label className={`flex min-h-11 items-center gap-2 rounded-lg border border-line px-3 text-sm text-slate-700 ${className}`}><input type="checkbox" name={name} defaultChecked={defaultChecked} />{label}</label>; }
function ViewButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) { return <button type="button" onClick={onClick} aria-pressed={active} className={`min-h-11 rounded-md px-2 py-2 text-sm font-semibold transition ${active ? "bg-brand text-white" : "text-slate-600 hover:bg-slate-100"}`}>{children}</button>; }
function FilterButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) { return <button type="button" onClick={onClick} aria-pressed={active} className={`min-h-9 rounded-md px-2 text-xs font-semibold transition ${active ? "bg-white text-brand shadow-sm" : "text-slate-600 hover:text-ink"}`}>{children}</button>; }
function Metric({ label, value, tone }: { label: string; value: string | number; tone?: "good" | "warn" }) { return <div className="ui-card p-4"><p className="text-xs text-slate-500">{label}</p><p className={`mt-1 text-xl font-semibold tabular-nums ${tone === "good" ? "text-emerald-700" : tone === "warn" ? "text-amber-700" : "text-ink"}`}>{value}</p></div>; }
function HealthBadge({ connector }: { connector?: IntegrationConnector }) { const status = connector?.health_status ?? "unconfigured"; const labels: Record<string, string> = { healthy: "健康", degraded: "待检查", error: "异常", disabled: "已停用", unconfigured: "未配置" }; const classes: Record<string, string> = { healthy: "bg-emerald-50 text-emerald-700", degraded: "bg-amber-50 text-amber-700", error: "bg-red-50 text-red-700", disabled: "bg-slate-100 text-slate-600", unconfigured: "bg-slate-100 text-slate-600" }; return <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${classes[status]}`}>{labels[status]}</span>; }
function StatusText({ status }: { status: string }) { return <span className={`rounded-full px-2 py-1 text-xs font-medium ${status === "active" ? "bg-emerald-50 text-emerald-700" : status === "disabled" ? "bg-slate-100 text-slate-600" : "bg-amber-50 text-amber-700"}`}>{status === "active" ? "在职" : status === "disabled" ? "停用" : "已离开可见范围"}</span>; }
function RunStatus({ status }: { status: string }) { return <span className={`text-xs font-semibold ${status === "success" ? "text-emerald-700" : status === "failed" ? "text-red-700" : "text-amber-700"}`}>{status === "success" ? "成功" : status === "failed" ? "失败" : status === "running" ? "进行中" : "部分成功"}</span>; }
function DeliveryStatus({ status }: { status: string }) { return <span className={`text-xs font-semibold ${status === "sent" ? "text-emerald-700" : status === "failed" ? "text-red-700" : "text-slate-500"}`}>{status === "sent" ? "已发送" : status === "failed" ? "失败" : status === "sending" ? "发送中" : "已跳过"}</span>; }
function formatDate(value: string | null) { return value ? new Date(value).toLocaleString("zh-CN") : "-"; }
function IntegrationSkeleton() { return <div className="space-y-4"><PanelSkeleton rows={2} /><section className="grid grid-cols-2 gap-3 xl:grid-cols-4">{Array.from({ length: 4 }).map((_, index) => <PanelSkeleton key={index} rows={1} />)}</section><section className="grid gap-3 xl:grid-cols-2"><PanelSkeleton rows={8} /><PanelSkeleton rows={8} /></section></div>; }
