import { redirect } from "next/navigation";
import { Shell } from "@/components/shell";
import { AdminDashboard } from "@/components/admin-dashboard";
import { requireAdmin } from "@/lib/db";

export default async function AdminPage() {
  try {
    await requireAdmin();
  } catch {
    redirect("/");
  }

  return (
    <Shell>
      <AdminDashboard />
    </Shell>
  );
}
