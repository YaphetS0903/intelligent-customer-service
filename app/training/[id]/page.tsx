import { notFound } from "next/navigation";
import { Shell } from "@/components/shell";
import { TrainingPlayer } from "@/components/training-player";
import { getCurrentUser, getTrainingJob } from "@/lib/db";

export default async function TrainingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  const { id } = await params;
  const job = await getTrainingJob(id);

  if (!job || (user.role !== "admin" && (job.publish_status !== "published" || job.status !== "ready"))) {
    notFound();
  }

  return (
    <Shell>
      <TrainingPlayer job={job} />
    </Shell>
  );
}
