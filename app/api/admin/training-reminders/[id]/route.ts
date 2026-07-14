import { NextResponse } from "next/server";
import { createTrainingAuditEvent, getTrainingJob, requireAdmin } from "@/lib/db";
import { sendTrainingDueReminders } from "@/lib/training-notifications";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireAdmin();
    const { id } = await params;
    const job = await getTrainingJob(id);
    if (!job) return NextResponse.json({ error: "课程不存在" }, { status: 404 });
    const result = await sendTrainingDueReminders(job);
    await createTrainingAuditEvent({
      training_job_id: id,
      actor_id: user.id,
      action: "reminders_sent",
      detail: "发送未完课学习提醒",
      metadata: result
    });
    return NextResponse.json({ result, message: `已提醒 ${result.reminded} 名未完课员工。` });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "发送学习提醒失败" }, { status: 400 });
  }
}
