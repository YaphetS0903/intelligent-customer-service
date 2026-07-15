"use client";

import { useRouter } from "next/navigation";
import { LogOut, UserRound } from "lucide-react";
import type { UserProfile } from "@/lib/types";

export function UserMenu({ user, collapsed = false }: { user: UserProfile; collapsed?: boolean }) {
  const router = useRouter();

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });

    router.replace("/login");
    router.refresh();
  }

  return (
    <div className={`relative mt-2 shrink-0 ${collapsed ? "flex justify-center" : "ui-command-panel p-2"}`}>
      {collapsed ? (
        <button
          onClick={() => void signOut()}
          title={`退出登录：${user.name}`}
          aria-label="退出登录"
          className="grid size-10 place-items-center rounded-lg border border-line bg-white text-steel transition hover:bg-cyan/10 hover:text-brand"
        >
          <LogOut size={16} />
        </button>
      ) : (
        <div className="flex min-w-0 items-center gap-2">
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-cyan/10 text-brand">
            <UserRound size={16} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs font-semibold text-ink">{user.name}</span>
            <span className="block truncate text-[11px] text-muted" title={user.email}>
              {user.role === "admin" ? "管理员" : "员工"} · {user.email}
            </span>
          </span>
          <button
            onClick={() => void signOut()}
            title="退出登录"
            aria-label="退出登录"
            className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg border border-line bg-white text-steel transition hover:bg-cyan/10 hover:text-brand"
          >
            <LogOut size={15} />
          </button>
        </div>
      )}
    </div>
  );
}
