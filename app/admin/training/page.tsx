import { redirect } from "next/navigation";
import { Shell } from "@/components/shell";
import { TrainingAdmin } from "@/components/training-admin";
import { requireAdmin } from "@/lib/db";

export default async function AdminTrainingPage() {
  try {
    await requireAdmin();
  } catch {
    redirect("/");
  }

  return (
    <Shell>
      <TrainingAdmin />
    </Shell>
  );
}
