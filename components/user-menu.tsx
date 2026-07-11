"use client";

import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import type { UserProfile } from "@/lib/types";

export function UserMenu({ user, collapsed = false }: { user: UserProfile; collapsed?: boolean }) {
  const router = useRouter();

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });

    router.replace("/login");
    router.refresh();
  }

  return (
    <div className={`ui-command-panel relative mt-3 shrink-0 ${collapsed ? "p-2" : "p-2.5"}`}>
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
        <>
      <div className="mb-2 flex items-center gap-2">
        <span className="size-2 rounded-full bg-mint shadow-[0_0_16px_rgba(0,143,122,0.9)]" />
        <span className="text-xs font-semibold text-emerald-700">SECURE SESSION</span>
      </div>
      <p className="truncate text-sm font-semibold text-ink">{user.name}</p>
      <p className="truncate text-xs text-muted">{user.email}</p>
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="rounded-full bg-cyan/10 px-2 py-1 text-xs font-medium text-cyan ring-1 ring-cyan/20">
          {user.role === "admin" ? "管理员" : "员工"}
        </span>
        <button
          onClick={() => void signOut()}
          title="退出登录"
          aria-label="退出登录"
          className="inline-flex size-9 items-center justify-center rounded-lg border border-line bg-white text-steel transition hover:bg-cyan/10 hover:text-brand"
        >
          <LogOut size={16} />
        </button>
      </div>
        </>
      )}
    </div>
  );
}
