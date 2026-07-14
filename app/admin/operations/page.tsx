import { redirect } from "next/navigation";
import { BackupOperationsAdmin } from "@/components/backup-operations-admin";
import { RuntimeMonitorAdmin } from "@/components/runtime-monitor-admin";
import { Shell } from "@/components/shell";
import { requireAdmin } from "@/lib/db";

export default async function OperationsPage() {
  try {
    await requireAdmin();
  } catch {
    redirect("/");
  }
  return (
    <Shell>
      <div className="space-y-5">
        <section className="ui-card p-5 shadow-soft">
          <h1 className="ui-page-title">运维与备份</h1>
          <p className="mt-1 text-sm text-slate-500">运行状态、异常告警、MySQL 备份与恢复验证</p>
        </section>
        <RuntimeMonitorAdmin />
        <BackupOperationsAdmin />
      </div>
    </Shell>
  );
}
