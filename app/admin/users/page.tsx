import { redirect } from "next/navigation";
import { Shell } from "@/components/shell";
import { UserAdmin } from "@/components/user-admin";
import { requireAdmin } from "@/lib/db";

export default async function UsersPage() {
  try {
    await requireAdmin();
  } catch {
    redirect("/");
  }

  return (
    <Shell>
      <UserAdmin />
    </Shell>
  );
}
