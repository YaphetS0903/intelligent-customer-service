import { redirect } from "next/navigation";
import { Shell } from "@/components/shell";
import { QaTestAdmin } from "@/components/qa-test-admin";
import { requireAdmin } from "@/lib/db";

export default async function QaTestsPage() {
  try {
    await requireAdmin();
  } catch {
    redirect("/");
  }

  return (
    <Shell>
      <QaTestAdmin />
    </Shell>
  );
}
