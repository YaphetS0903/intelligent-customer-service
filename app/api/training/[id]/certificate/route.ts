import { NextResponse } from "next/server";
import { getCurrentUser, getTrainingCertificate, getTrainingJob, getUserProfile, listTrainingQuizAttempts } from "@/lib/db";
import { canAccessTrainingJob } from "@/lib/training-access";
import { renderTrainingCertificatePdf } from "@/lib/training-certificate-pdf";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const currentUser = await getCurrentUser();
    const { id } = await params;
    const [job, certificate, attempts] = await Promise.all([
      getTrainingJob(id), getTrainingCertificate(id, currentUser.id), listTrainingQuizAttempts(id, currentUser.id)
    ]);
    if (!job) return NextResponse.json({ error: "课程不存在" }, { status: 404 });
    if (!canAccessTrainingJob(currentUser, job)) return NextResponse.json({ error: "无权访问该课程" }, { status: 403 });
    if (!certificate) return NextResponse.json({ error: "尚未获得该课程证书" }, { status: 404 });
    if (certificate.revoked_at) return NextResponse.json({ error: "该证书已作废" }, { status: 410 });
    const attempt = attempts.find((item) => item.id === certificate.quiz_attempt_id && item.passed);
    if (!attempt) return NextResponse.json({ error: "证书关联成绩不存在" }, { status: 409 });
    const user = await getUserProfile(currentUser.id);
    if (!user) return NextResponse.json({ error: "员工信息不存在" }, { status: 404 });
    const pdf = await renderTrainingCertificatePdf({ certificate, job, user, attempt });
    return new Response(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${certificate.certificate_no}.pdf"`,
        "Cache-Control": "private, no-store"
      }
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "生成培训证书失败" }, { status: 400 });
  }
}
