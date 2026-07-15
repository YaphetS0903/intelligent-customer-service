"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  BarChart3,
  Bell,
  Bot,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  ClipboardList,
  Database,
  FileAudio,
  FileCheck2,
  HardDrive,
  Menu,
  MessageSquare,
  Server,
  Settings,
  ShieldCheck,
  Users
} from "lucide-react";
import { UserMenu } from "@/components/user-menu";
import type { UserProfile } from "@/lib/types";

const employeeNavItems = [
  { href: "/chat", label: "智能问答", icon: MessageSquare },
  { href: "/training", label: "培训课程", icon: FileAudio },
  { href: "/approvals", label: "资料审批", icon: FileCheck2 }
];

const adminNavItems = [
  { href: "/notifications", label: "通知中心", icon: Bell },
  { href: "/", label: "运营工作台", icon: Bot },
  { href: "/admin/documents", label: "知识管理", icon: Database },
  { href: "/admin/training", label: "课程管理", icon: FileAudio },
  { href: "/admin/pilot", label: "试运行验收", icon: ClipboardList },
  { href: "/admin/qa-tests", label: "问答测试", icon: ClipboardCheck },
  { href: "/admin/users", label: "用户与权限", icon: Users },
  { href: "/admin/analytics", label: "运营总览", icon: BarChart3 },
  { href: "/admin/insights", label: "审计与工单", icon: ShieldCheck },
  { href: "/admin/operations", label: "运维与备份", icon: HardDrive },
  { href: "/admin/deploy", label: "部署检查", icon: Server },
  { href: "/admin/settings", label: "系统配置", icon: Settings }
];

export function ShellClient({
  children,
  user
}: {
  children: React.ReactNode;
  user: UserProfile | null;
}) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const isAdmin = user?.role === "admin";
  const isAdminRoute = pathname.startsWith("/admin");
  const visibleNavGroups = useMemo(() => {
    if (!isAdmin) {
      return [{ label: "员工服务", items: [...employeeNavItems, { href: "/notifications", label: "通知中心", icon: Bell }] }];
    }

    return [
      { label: "员工端预览", items: employeeNavItems },
      { label: "管理后台", items: adminNavItems }
    ];
  }, [isAdmin]);
  useEffect(() => {
    setCollapsed(window.localStorage.getItem("tianrui-sidebar-collapsed") === "true");
  }, []);

  function toggleCollapsed() {
    setCollapsed((current) => {
      const next = !current;
      window.localStorage.setItem("tianrui-sidebar-collapsed", String(next));
      return next;
    });
  }

  return (
    <div className={`min-h-dvh ${isAdminRoute ? "bg-slate-50/70" : "bg-white/30"}`}>
      <header className={`sticky top-0 z-40 border-b px-4 py-3 text-ink shadow-soft backdrop-blur lg:hidden ${
        isAdminRoute ? "border-slate-300 bg-slate-950 text-white" : "border-line bg-white/95"
      }`}>
        <div className="flex min-h-11 items-center justify-between gap-3">
          <Link href={isAdmin ? "/" : "/chat"} className="flex min-w-0 items-center gap-3">
            <span className={`grid size-10 shrink-0 place-items-center rounded-lg text-white ${
              isAdminRoute ? "bg-brand" : "bg-mint"
            }`}>
              {isAdminRoute ? <ShieldCheck size={20} /> : <Bot size={20} />}
            </span>
            <span className="min-w-0">
              <span className={`block truncate text-sm font-semibold ${isAdminRoute ? "text-white" : "text-ink"}`}>
                {isAdminRoute ? "天瑞智能客服管理后台" : "天瑞内饰智能客服"}
              </span>
              <span className={`block text-xs ${isAdminRoute ? "text-slate-300" : "text-emerald-700"}`}>
                {isAdminRoute ? "ADMIN OPERATIONS" : "EMPLOYEE SERVICE"}
              </span>
            </span>
          </Link>
          <details className="group relative shrink-0">
            <summary
              role="button"
              aria-label="导航菜单"
              className={`grid size-11 cursor-pointer list-none place-items-center rounded-lg border transition [&::-webkit-details-marker]:hidden ${
                isAdminRoute
                  ? "border-slate-700 bg-slate-900 text-white hover:bg-slate-800"
                  : "border-line bg-surface text-brand hover:bg-cyan/10"
              }`}
            >
              <Menu size={18} />
            </summary>
            <nav className={`absolute right-0 top-14 z-50 max-h-[calc(100dvh-88px)] w-[calc(100vw-2rem)] space-y-4 overflow-y-auto rounded-lg border p-3 shadow-soft ${
              isAdminRoute ? "border-slate-700 bg-slate-900" : "border-line bg-white"
            }`} aria-label="移动端主导航">
              {visibleNavGroups.map((group) => (
                <div key={group.label}>
                  <p className={`mb-2 px-1 text-xs font-semibold ${isAdminRoute ? "text-slate-400" : "text-slate-500"}`}>
                    {group.label}
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    {group.items.map((item) => {
                      const Icon = item.icon;
                      const active = isActivePath(pathname, item.href);
                      return (
                        <Link
                          key={item.href}
                          href={item.href}
                          aria-current={active ? "page" : undefined}
                          className={`inline-flex min-h-11 min-w-0 items-center gap-2 rounded-lg border px-3 text-sm font-medium transition ${
                            active
                              ? isAdminRoute
                                ? "border-blue-400 bg-blue-500/15 text-blue-100"
                                : "border-cyan/40 bg-cyan/10 text-brand"
                              : isAdminRoute
                                ? "border-slate-700 bg-slate-950 text-slate-200 hover:bg-slate-800"
                                : "border-line bg-white text-steel hover:bg-slate-50"
                          }`}
                        >
                          <Icon size={16} className="shrink-0" />
                          <span className="truncate">{item.label}</span>
                        </Link>
                      );
                    })}
                  </div>
                </div>
              ))}
            </nav>
          </details>
        </div>
      </header>

      <aside
        className={`fixed inset-y-0 left-0 hidden min-h-0 flex-col border-r border-line bg-white/96 py-4 text-ink shadow-soft backdrop-blur transition-[width] duration-200 lg:flex ${
          collapsed ? "w-[76px] px-2" : "w-56 px-3"
        }`}
      >
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(16,32,51,0.035)_1px,transparent_1px),linear-gradient(90deg,rgba(16,32,51,0.035)_1px,transparent_1px)] bg-[length:28px_28px]" />
        <div className="pointer-events-none absolute right-0 top-0 h-full w-px bg-gradient-to-b from-cyan/70 via-line to-mint/50" />
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-label={collapsed ? "展开侧边栏" : "收起侧边栏"}
          title={collapsed ? "展开侧边栏" : "收起侧边栏"}
          className="absolute -right-3 top-5 z-20 grid size-7 place-items-center rounded-full border border-line bg-white text-steel shadow-soft transition hover:border-cyan/50 hover:text-brand"
        >
          {collapsed ? <ChevronRight size={15} /> : <ChevronLeft size={15} />}
        </button>

        <Link
          href={isAdmin ? "/" : "/chat"}
          className={`relative flex shrink-0 items-center rounded-lg py-1.5 transition ${collapsed ? "justify-center px-0" : "gap-3 px-2"}`}
        >
          <span className="grid size-11 shrink-0 place-items-center rounded-lg bg-brand text-white shadow-glow">
            <Bot size={22} />
          </span>
          {!collapsed && (
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold text-ink">天瑞内饰智能客服</span>
              <span className="block truncate text-xs font-medium text-brand">
                {isAdmin ? "ADMIN OPERATIONS" : "EMPLOYEE SERVICE"}
              </span>
            </span>
          )}
        </Link>

        <nav className="scrollbar-thin relative mt-5 min-h-0 flex-1 space-y-4 overflow-y-auto pb-2 pr-1" aria-label="主导航">
          {visibleNavGroups.map((group) => (
            <div key={group.label} className="space-y-1">
              {!collapsed && (
                <p className="px-3 pb-1 text-xs font-semibold text-slate-400">{group.label}</p>
              )}
              {group.items.map((item) => {
                const Icon = item.icon;
                const active = isActivePath(pathname, item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    title={collapsed ? item.label : undefined}
                    aria-label={collapsed ? item.label : undefined}
                    aria-current={active ? "page" : undefined}
                    className={`flex min-h-11 items-center rounded-lg text-sm font-medium transition ${
                      collapsed ? "justify-center px-0" : "gap-3 px-3 py-1.5"
                    } ${
                      active
                        ? item.href.startsWith("/admin") || item.href === "/"
                          ? "bg-slate-900 text-white shadow-sm"
                          : "bg-cyan/10 text-brand ring-1 ring-cyan/25"
                        : "text-steel hover:bg-cyan/10 hover:text-brand"
                    }`}
                  >
                    <Icon size={18} className="shrink-0" />
                    {!collapsed && <span className="truncate">{item.label}</span>}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>
        {user && <UserMenu user={user} collapsed={collapsed} />}
      </aside>

      <main className={`min-h-dvh transition-[padding] duration-200 ${collapsed ? "lg:pl-[76px]" : "lg:pl-56"}`}>
        <div className="mx-auto w-full max-w-[1480px] px-4 py-5 sm:px-6 lg:px-6">
          {isAdminRoute && (
            <div className="mb-4 flex min-h-12 flex-wrap items-center justify-between gap-3 border-b border-slate-300 pb-3" aria-label="管理后台当前位置">
              <div className="flex min-w-0 items-center gap-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-slate-900 text-white">
                  <ShieldCheck size={17} />
                </span>
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-slate-500">管理后台</p>
                  <p className="truncate text-sm font-semibold text-ink">{currentNavigationLabel(pathname)}</p>
                </div>
              </div>
              <Link href="/chat" className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-line bg-white px-3 text-sm font-semibold text-steel transition hover:border-cyan/40 hover:text-brand">
                <MessageSquare size={16} />
                查看员工端
              </Link>
            </div>
          )}
          {children}
        </div>
      </main>
    </div>
  );
}

function isActivePath(pathname: string, href: string) {
  if (href === "/") {
    return pathname === "/";
  }

  if (href === "/admin") {
    return pathname === "/admin";
  }

  return pathname === href || pathname.startsWith(`${href}/`);
}

function currentNavigationLabel(pathname: string) {
  const match = adminNavItems
    .filter((item) => item.href !== "/")
    .sort((left, right) => right.href.length - left.href.length)
    .find((item) => isActivePath(pathname, item.href));

  return match?.label ?? "管理后台";
}
