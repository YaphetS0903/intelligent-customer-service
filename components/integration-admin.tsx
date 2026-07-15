"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Building2, CheckCircle2, ChevronDown, CircleAlert, Loader2, Mail, RefreshCw, Send, Settings2, UsersRound } from "lucide-react";
import { ErrorRetry, PanelSkeleton, useToast } from "@/components/ui-feedback";
import type { IntegrationConnector, IntegrationDeliveryLog, IntegrationDirectoryMember, IntegrationSyncRun } from "@/lib/integrations/types";

type Dashboard = {
  connectors: IntegrationConnector[];
  configs: {
    wecom: { enabled: boolean; configured: boolean; corp_id_masked: string; corp_secret_configured: boolean; agent_id: string; api_base_url: string; root_department_id: number; sync_profile_fields: boolean };
    winmail: { enabled: boolean; notification_enabled: boolean; configured: boolean; api_url: string; api_key_masked: string; api_secret_configured: boolean; sender_user_masked: string; sender_password_configured: boolean; sender_name: string; allow_insecure_http: boolean; timeout_ms: number };
  };
  directory: { members: Array<IntegrationDirectoryMember & { local_user?: { id: string; name: string; email: string; department: string; position: string } | null }>; total: number; active: number; matched: number; unmatched: number };
  sync_runs: IntegrationSyncRun[];
  delivery_logs: IntegrationDeliveryLog[];
};

type View = "connectors" | "directory" | "logs";

export function IntegrationAdmin() {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [view, setView] = useState<View>("connectors");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [working, setWorking] = useState<string | null>(null);
  const [updateProfiles, setUpdateProfiles] = useState(false);
  const [testEmail, setTestEmail] = useState("");
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
      pushToast({ tone: "success", title: "企业微信通讯录已同步", description: `${data.result.members} 位成员，匹配 ${data.result.matched} 个系统账号` });
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
          <div className="min-w-0"><h1 className="text-xl font-semibold text-ink">业务集成</h1><p className="truncate text-sm text-slate-500">企业微信通讯录、身份映射与 Winmail 邮件通知</p></div>
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
          <ConnectorPanel icon={<Building2 size={18} />} title="企业微信通讯录" description="读取自建应用可见范围内的部门和成员，按邮箱精确匹配系统账号。" connector={wecomConnector}>
            <form key={JSON.stringify(dashboard.configs.wecom)} onSubmit={(event) => { event.preventDefault(); void saveConfig("wecom", event.currentTarget); }} className="grid gap-3 sm:grid-cols-2">
              <Toggle name="WECOM_ENABLED" label="启用连接器" defaultChecked={dashboard.configs.wecom.enabled} />
              <Toggle name="WECOM_SYNC_PROFILE_FIELDS" label="默认同步部门/岗位" defaultChecked={dashboard.configs.wecom.sync_profile_fields} />
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
            </div>
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

      {view === "directory" && <DirectoryView dashboard={dashboard} />}
      {view === "logs" && <LogsView runs={dashboard.sync_runs} deliveries={dashboard.delivery_logs} />}
    </div>
  );
}

function ConnectorPanel({ icon, title, description, connector, children }: { icon: React.ReactNode; title: string; description: string; connector?: IntegrationConnector; children: React.ReactNode }) {
  return <article className="ui-card overflow-hidden"><div className="flex items-start justify-between gap-3 border-b border-line p-4"><div className="flex min-w-0 gap-3"><span className="grid size-9 shrink-0 place-items-center rounded-lg bg-cyan/10 text-brand">{icon}</span><div><h2 className="text-base font-semibold text-ink">{title}</h2><p className="mt-1 text-sm leading-6 text-slate-500">{description}</p></div></div><HealthBadge connector={connector} /></div><details className="group"><summary className="flex min-h-11 cursor-pointer list-none items-center justify-between px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 [&::-webkit-details-marker]:hidden"><span>展开配置与操作</span><ChevronDown size={16} className="text-slate-400 transition group-open:rotate-180" /></summary><div className="border-t border-line p-4">{children}</div></details></article>;
}

function DirectoryView({ dashboard }: { dashboard: Dashboard }) {
  return <section className="space-y-3"><div className="grid grid-cols-2 gap-3 lg:grid-cols-4"><Metric label="同步成员" value={dashboard.directory.total} /><Metric label="在职" value={dashboard.directory.active} tone="good" /><Metric label="已匹配" value={dashboard.directory.matched} tone="good" /><Metric label="待匹配" value={dashboard.directory.unmatched} tone={dashboard.directory.unmatched ? "warn" : "good"} /></div><div className="hidden overflow-hidden ui-card lg:block"><div className="overflow-x-auto"><table className="min-w-[900px] w-full text-sm"><thead className="bg-slate-50 text-left text-xs text-slate-500"><tr><th className="px-4 py-3">企业微信成员</th><th className="px-4 py-3">部门/岗位</th><th className="px-4 py-3">系统账号</th><th className="px-4 py-3">状态</th><th className="px-4 py-3">同步时间</th></tr></thead><tbody className="divide-y divide-line">{dashboard.directory.members.map((member) => <tr key={member.id}><td className="px-4 py-3"><p className="font-medium text-ink">{member.name}</p><p className="mt-1 text-xs text-slate-500">{member.email || member.external_user_id}</p></td><td className="px-4 py-3 text-slate-600">{member.department_names.join(" / ") || "未记录"}<p className="mt-1 text-xs text-slate-400">{member.position || "未记录岗位"}</p></td><td className="px-4 py-3">{member.local_user ? <><p className="font-medium text-emerald-700">{member.local_user.name}</p><p className="text-xs text-slate-500">{member.local_user.email}</p></> : <span className="text-amber-700">待匹配</span>}</td><td className="px-4 py-3"><StatusText status={member.status} /></td><td className="px-4 py-3 text-xs text-slate-500">{formatDate(member.synced_at)}</td></tr>)}</tbody></table></div></div><div className="grid gap-3 lg:hidden">{dashboard.directory.members.map((member) => <article key={member.id} className="ui-card p-4"><div className="flex items-start justify-between gap-3"><div><h3 className="text-sm font-semibold text-ink">{member.name}</h3><p className="mt-1 break-all text-xs text-slate-500">{member.email || member.external_user_id}</p></div><StatusText status={member.status} /></div><p className="mt-3 text-sm text-slate-600">{member.department_names.join(" / ") || "未记录部门"} · {member.position || "未记录岗位"}</p><p className={`mt-2 text-sm ${member.local_user ? "text-emerald-700" : "text-amber-700"}`}>{member.local_user ? `已匹配：${member.local_user.name}` : "待匹配系统账号"}</p></article>)}</div>{dashboard.directory.members.length === 0 && <div className="ui-card px-4 py-10 text-center text-sm text-slate-500">尚未同步企业微信通讯录。</div>}</section>;
}

function LogsView({ runs, deliveries }: { runs: IntegrationSyncRun[]; deliveries: IntegrationDeliveryLog[] }) {
  return <section className="grid gap-3 xl:grid-cols-2"><div className="ui-card p-4"><h2 className="text-base font-semibold text-ink">通讯录同步记录</h2><div className="mt-3 space-y-2">{runs.slice(0, 20).map((run) => <div key={run.id} className="rounded-lg border border-line px-3 py-3"><div className="flex items-center justify-between gap-3"><p className="text-sm font-semibold text-ink">{run.connector_id === "wecom" ? "企业微信通讯录" : run.connector_id}</p><RunStatus status={run.status} /></div><p className="mt-2 text-xs text-slate-500">总数 {run.total_count} · 匹配 {run.matched_count} · 更新 {run.updated_count} · 失败 {run.failed_count}</p>{run.error_message && <p className="mt-2 text-xs text-red-700">{run.error_message}</p>}<p className="mt-2 text-xs text-slate-400">{formatDate(run.started_at)}</p></div>)}{runs.length === 0 && <p className="py-8 text-center text-sm text-slate-500">暂无同步记录。</p>}</div></div><div className="ui-card p-4"><h2 className="text-base font-semibold text-ink">Winmail 投递记录</h2><div className="mt-3 space-y-2">{deliveries.slice(0, 30).map((item) => <div key={item.id} className="rounded-lg border border-line px-3 py-3"><div className="flex items-center justify-between gap-3"><p className="min-w-0 truncate text-sm font-semibold text-ink">{item.subject}</p><DeliveryStatus status={item.status} /></div><p className="mt-2 text-xs text-slate-500">{item.recipient_masked || "未记录收件人"}{item.latency_ms !== null ? ` · ${item.latency_ms}ms` : ""}</p>{item.error_message && <p className="mt-2 text-xs text-red-700">{item.error_message}</p>}<p className="mt-2 text-xs text-slate-400">{formatDate(item.created_at)}</p></div>)}{deliveries.length === 0 && <p className="py-8 text-center text-sm text-slate-500">暂无邮件投递记录。</p>}</div></div></section>;
}

function Field({ name, label, defaultValue, placeholder, className = "", inputMode }: { name: string; label: string; defaultValue?: string; placeholder?: string; className?: string; inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"] }) { return <label className={`block ${className}`}><span className="text-sm font-medium text-slate-700">{label}</span><input name={name} defaultValue={defaultValue} placeholder={placeholder} inputMode={inputMode} className="ui-input mt-1 h-11 w-full" /></label>; }
function SecretField({ name, label, configured }: { name: string; label: string; configured: boolean }) { return <label className="block"><span className="text-sm font-medium text-slate-700">{label}</span><input type="password" name={name} autoComplete="new-password" placeholder={configured ? "已配置，留空保留原值" : "请填写"} className="ui-input mt-1 h-11 w-full" /></label>; }
function Toggle({ name, label, defaultChecked, className = "" }: { name: string; label: string; defaultChecked: boolean; className?: string }) { return <label className={`flex min-h-11 items-center gap-2 rounded-lg border border-line px-3 text-sm text-slate-700 ${className}`}><input type="checkbox" name={name} defaultChecked={defaultChecked} />{label}</label>; }
function ViewButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) { return <button type="button" onClick={onClick} aria-pressed={active} className={`min-h-11 rounded-md px-2 py-2 text-sm font-semibold transition ${active ? "bg-brand text-white" : "text-slate-600 hover:bg-slate-100"}`}>{children}</button>; }
function Metric({ label, value, tone }: { label: string; value: string | number; tone?: "good" | "warn" }) { return <div className="ui-card p-4"><p className="text-xs text-slate-500">{label}</p><p className={`mt-1 text-xl font-semibold tabular-nums ${tone === "good" ? "text-emerald-700" : tone === "warn" ? "text-amber-700" : "text-ink"}`}>{value}</p></div>; }
function HealthBadge({ connector }: { connector?: IntegrationConnector }) { const status = connector?.health_status ?? "unconfigured"; const labels: Record<string, string> = { healthy: "健康", degraded: "待检查", error: "异常", disabled: "已停用", unconfigured: "未配置" }; const classes: Record<string, string> = { healthy: "bg-emerald-50 text-emerald-700", degraded: "bg-amber-50 text-amber-700", error: "bg-red-50 text-red-700", disabled: "bg-slate-100 text-slate-600", unconfigured: "bg-slate-100 text-slate-600" }; return <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${classes[status]}`}>{labels[status]}</span>; }
function StatusText({ status }: { status: string }) { return <span className={`rounded-full px-2 py-1 text-xs font-medium ${status === "active" ? "bg-emerald-50 text-emerald-700" : status === "disabled" ? "bg-slate-100 text-slate-600" : "bg-amber-50 text-amber-700"}`}>{status === "active" ? "在职" : status === "disabled" ? "停用" : "已离开可见范围"}</span>; }
function RunStatus({ status }: { status: string }) { return <span className={`text-xs font-semibold ${status === "success" ? "text-emerald-700" : status === "failed" ? "text-red-700" : "text-amber-700"}`}>{status === "success" ? "成功" : status === "failed" ? "失败" : status === "running" ? "进行中" : "部分成功"}</span>; }
function DeliveryStatus({ status }: { status: string }) { return <span className={`text-xs font-semibold ${status === "sent" ? "text-emerald-700" : status === "failed" ? "text-red-700" : "text-slate-500"}`}>{status === "sent" ? "已发送" : status === "failed" ? "失败" : status === "sending" ? "发送中" : "已跳过"}</span>; }
function formatDate(value: string | null) { return value ? new Date(value).toLocaleString("zh-CN") : "-"; }
function IntegrationSkeleton() { return <div className="space-y-4"><PanelSkeleton rows={2} /><section className="grid grid-cols-2 gap-3 xl:grid-cols-4">{Array.from({ length: 4 }).map((_, index) => <PanelSkeleton key={index} rows={1} />)}</section><section className="grid gap-3 xl:grid-cols-2"><PanelSkeleton rows={8} /><PanelSkeleton rows={8} /></section></div>; }

