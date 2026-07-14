import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/db";

export default async function AdminPage() {
  try {
    await requireAdmin();
  } catch {
    redirect("/");
  }

  redirect("/admin/documents");
}
