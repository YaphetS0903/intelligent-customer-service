import { redirect } from "next/navigation";
import { Shell } from "@/components/shell";
import { PilotReadinessAdmin } from "@/components/pilot-readiness-admin";
import { requireAdmin } from "@/lib/db";

export default async function PilotReadinessPage() {
  try {
    await requireAdmin();
  } catch {
    redirect("/");
  }

  return (
    <Shell>
      <PilotReadinessAdmin />
    </Shell>
  );
}
