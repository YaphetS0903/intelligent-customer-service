import { redirect } from "next/navigation";
import { Shell } from "@/components/shell";
import { DeployReadinessAdmin } from "@/components/deploy-readiness-admin";
import { requireAdmin } from "@/lib/db";

export default async function DeployPage() {
  try {
    await requireAdmin();
  } catch {
    redirect("/");
  }
  return (
    <Shell>
      <DeployReadinessAdmin />
    </Shell>
  );
}
