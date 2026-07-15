import { redirect } from "next/navigation";
import { Shell } from "@/components/shell";
import { IntegrationAdmin } from "@/components/integration-admin";
import { requireAdmin } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function IntegrationsPage() {
  try {
    await requireAdmin();
  } catch {
    redirect("/");
  }
  return <Shell><IntegrationAdmin /></Shell>;
}

