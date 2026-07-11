import { redirect } from "next/navigation";
import { Shell } from "@/components/shell";
import { InsightsAdmin } from "@/components/insights-admin";
import { requireAdmin } from "@/lib/db";

export default async function InsightsPage() {
  try {
    await requireAdmin();
  } catch {
    redirect("/");
  }

  return (
    <Shell>
      <InsightsAdmin />
    </Shell>
  );
}
