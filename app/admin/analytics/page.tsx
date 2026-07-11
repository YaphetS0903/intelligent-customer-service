import { redirect } from "next/navigation";
import { OperationsDashboardAdmin } from "@/components/operations-dashboard-admin";
import { Shell } from "@/components/shell";
import { requireAdmin } from "@/lib/db";

export default async function AnalyticsPage() {
  try {
    await requireAdmin();
  } catch {
    redirect("/");
  }

  return (
    <Shell>
      <OperationsDashboardAdmin />
    </Shell>
  );
}
