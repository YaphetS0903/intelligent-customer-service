"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Bell,
  BellRing,
  Check,
  CheckCheck,
  CircleAlert,
  FileCheck2,
  Loader2,
  MessageSquareText,
  RefreshCw,
  ShieldAlert,
  Sparkles
} from "lucide-react";
import { ErrorRetry, PanelSkeleton, useToast } from "@/components/ui-feedback";
import { fetchWithRetry } from "@/lib/client-fetch";
import type { AppNotification, NotificationCategory } from "@/lib/types";

type NotificationFilter = "all" | "unread" | NotificationCategory;
type NotificationResponse = { notifications: AppNotification[]; unread_count: number };

const filters: Array<{ value: NotificationFilter; label: string }> = [
  { value: "all", label: "全部" },
  { value: "unread", label: "未读" },
  { value: "approval", label: "审批" },
  { value: "ticket", label: "工单" },
  { value: "security", label: "安全" },
  { value: "qa", label: "QA" },
  { value: "system", label: "系统" }
];

export function NotificationCenter() {
  const router = useRouter();
  const { pushToast } = useToast();
  const [data, setData] = useState<NotificationResponse | null>(null);
  const [filter, setFilter] = useState<NotificationFilter>("all");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [workingId, setWorkingId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setLoadError("");
    try {
      const response = await fetchWithRetry("/api/notifications?limit=150", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "通知加载失败");
      setData(payload);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "通知加载失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const visibleNotifications = useMemo(() => {
    const notifications = data?.notifications ?? [];
    if (filter === "all") return notifications;
    if (filter === "unread") return notifications.filter((item) => !item.read_at);
    return notifications.filter((item) => item.category === filter);
  }, [data, filter]);

  async function setRead(notification: AppNotification, read: boolean) {
    setWorkingId(notification.id);
    try {
      const response = await fetch(`/api/notifications/${notification.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ read })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "通知状态更新失败");
      setData((current) => current ? {
        notifications: current.notifications.map((item) => item.id === notification.id ? payload.notification : item),
        unread_count: Math.max(0, current.unread_count + (read ? -1 : 1))
      } : current);
    } catch (error) {
      pushToast({ tone: "error", title: "通知状态更新失败", description: error instanceof Error ? error.message : undefined });
    } finally {
      setWorkingId(null);
    }
  }

  async function markAllRead() {
    setWorkingId("all");
    try {
      const response = await fetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "mark_all_read" })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "全部已读失败");
      const readAt = new Date().toISOString();
      setData((current) => current ? {
        notifications: current.notifications.map((item) => item.read_at ? item : { ...item, read_at: readAt }),
        unread_count: 0
      } : current);
      pushToast({ tone: "success", title: "通知已全部标记为已读" });
    } catch (error) {
      pushToast({ tone: "error", title: "全部已读失败", description: error instanceof Error ? error.message : undefined });
    } finally {
      setWorkingId(null);
    }
  }

  async function openNotification(notification: AppNotification) {
    if (!notification.read_at) await setRead(notification, true);
    if (notification.href) router.push(notification.href);
  }

  if (loading && !data) return <NotificationSkeleton />;
  if (loadError && !data) {
    return <ErrorRetry title="通知中心加载失败" message={loadError} retrying={loading} onRetry={() => void load()} />;
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-4 border-b border-line pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="ui-page-kicker">NOTIFICATION CENTER</p>
          <h1 className="ui-page-title mt-1">通知中心</h1>
          <p className="ui-muted mt-2">集中查看审批、工单、安全告警和 QA 异常处理进展。</p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => void load()} disabled={loading} className="ui-button-secondary min-h-11">
            {loading ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}刷新
          </button>
          <button type="button" onClick={() => void markAllRead()} disabled={!data?.unread_count || workingId === "all"} className="ui-button-primary min-h-11">
            {workingId === "all" ? <Loader2 size={16} className="animate-spin" /> : <CheckCheck size={16} />}全部已读
          </button>
        </div>
      </header>

      {loadError && <ErrorRetry title="通知刷新失败" message={loadError} retrying={loading} onRetry={() => void load()} />}

      <section className="grid overflow-hidden rounded-lg border border-line bg-white sm:grid-cols-3" aria-label="通知概览">
        <NotificationMetric icon={BellRing} label="未读通知" value={data?.unread_count ?? 0} tone="blue" />
        <NotificationMetric icon={Bell} label="通知总数" value={data?.notifications.length ?? 0} tone="neutral" />
        <NotificationMetric icon={ShieldAlert} label="安全告警" value={(data?.notifications ?? []).filter((item) => item.category === "security" && !item.read_at).length} tone="red" />
      </section>

      <section className="border-b border-line" aria-label="通知筛选">
        <div className="flex gap-1 overflow-x-auto pb-px">
          {filters.map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => setFilter(item.value)}
              className={`min-h-11 shrink-0 border-b-2 px-4 text-sm font-semibold transition ${
                filter === item.value ? "border-brand text-brand" : "border-transparent text-slate-500 hover:text-ink"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </section>

      {visibleNotifications.length === 0 ? (
        <section className="flex min-h-[300px] flex-col items-center justify-center border-y border-line bg-white px-6 text-center">
          <CheckCheck size={34} className="text-emerald-600" />
          <h2 className="mt-4 text-lg font-semibold text-ink">当前没有通知</h2>
          <p className="mt-2 text-sm text-slate-500">新的审批、工单或告警事件会自动出现在这里。</p>
        </section>
      ) : (
        <section className="divide-y divide-line border-y border-line bg-white" aria-label="通知列表">
          {visibleNotifications.map((notification) => {
            const Icon = categoryIcon(notification.category);
            return (
              <article key={notification.id} className={`flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-start ${notification.read_at ? "bg-white" : "bg-blue-50/60"}`}>
                <span className={`grid size-10 shrink-0 place-items-center rounded-lg ${severityClass(notification.severity)}`}>
                  <Icon size={18} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-sm font-semibold text-ink">{notification.title}</h2>
                    {!notification.read_at && <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-700">未读</span>}
                    <span className="text-xs text-slate-400">{categoryLabel(notification.category)}</span>
                  </div>
                  <p className="mt-1 break-words text-sm leading-6 text-slate-600">{notification.body}</p>
                  <p className="mt-2 text-xs text-slate-400">{new Date(notification.created_at).toLocaleString("zh-CN")}</p>
                </div>
                <div className="flex shrink-0 gap-2 sm:justify-end">
                  <button
                    type="button"
                    onClick={() => void setRead(notification, !notification.read_at)}
                    disabled={workingId === notification.id}
                    className="ui-button-secondary min-h-10 flex-1 px-3 sm:flex-none"
                  >
                    {workingId === notification.id ? <Loader2 size={15} className="animate-spin" /> : notification.read_at ? <CircleAlert size={15} /> : <Check size={15} />}
                    {notification.read_at ? "设为未读" : "设为已读"}
                  </button>
                  {notification.href && (
                    <button type="button" onClick={() => void openNotification(notification)} className="ui-button-primary min-h-10 flex-1 px-3 sm:flex-none">
                      查看详情
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </section>
      )}
    </div>
  );
}

function NotificationSkeleton() {
  return (
    <div className="space-y-5">
      <PanelSkeleton rows={2} />
      <PanelSkeleton rows={4} />
    </div>
  );
}

function NotificationMetric({ icon: Icon, label, value, tone }: { icon: typeof Bell; label: string; value: number; tone: "blue" | "red" | "neutral" }) {
  const toneClass = tone === "blue" ? "text-blue-700 bg-blue-50" : tone === "red" ? "text-red-700 bg-red-50" : "text-slate-700 bg-slate-100";
  return (
    <div className="flex min-h-24 items-center gap-4 border-b border-line px-5 py-4 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0">
      <span className={`grid size-10 place-items-center rounded-lg ${toneClass}`}><Icon size={18} /></span>
      <div><p className="text-xs font-semibold text-slate-500">{label}</p><p className="mt-1 text-2xl font-semibold tabular-nums text-ink">{value}</p></div>
    </div>
  );
}

function categoryIcon(category: NotificationCategory) {
  if (category === "approval") return FileCheck2;
  if (category === "ticket") return MessageSquareText;
  if (category === "security") return ShieldAlert;
  if (category === "qa") return Sparkles;
  return AlertTriangle;
}

function categoryLabel(category: NotificationCategory) {
  return ({ approval: "资料审批", ticket: "人工工单", security: "安全告警", qa: "QA 异常", system: "系统运维" })[category];
}

function severityClass(severity: AppNotification["severity"]) {
  if (severity === "critical") return "bg-red-100 text-red-700";
  if (severity === "warning") return "bg-amber-100 text-amber-700";
  if (severity === "success") return "bg-emerald-100 text-emerald-700";
  return "bg-blue-100 text-blue-700";
}
