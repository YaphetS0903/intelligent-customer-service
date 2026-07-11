import { redirect } from "next/navigation";
import { Shell } from "@/components/shell";
import { SettingsWizard } from "@/components/settings-wizard";
import { requireSettingsAccess } from "@/lib/health";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  try {
    await requireSettingsAccess();
  } catch {
    redirect("/");
  }

  return (
    <Shell>
      <SettingsWizard />
    </Shell>
  );
}
