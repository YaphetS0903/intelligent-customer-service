import { NextResponse } from "next/server";
import { createTrainingAuditEvent, listTrainingCertificates, requireAdmin, revokeTrainingCertificate } from "@/lib/db";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireAdmin();
    const { id } = await params;
    const certificate = (await listTrainingCertificates()).find((item) => item.id === id);
    if (!certificate) return NextResponse.json({ error: "培训证书不存在" }, { status: 404 });
    if (certificate.revoked_at) return NextResponse.json({ certificate });
    const body = await request.json().catch(() => ({}));
    const reason = String(body.reason ?? "管理员在培训后台作废").trim();
    if (!reason) return NextResponse.json({ error: "请填写作废原因" }, { status: 400 });
    const updated = await revokeTrainingCertificate(id, user.id, reason);
    await createTrainingAuditEvent({ training_job_id: certificate.training_job_id, actor_id: user.id, action: "certificate_revoked", detail: "作废员工培训证书", metadata: { certificate_id: id, certificate_no: certificate.certificate_no, user_id: certificate.user_id, reason } });
    return NextResponse.json({ certificate: updated });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "作废证书失败" }, { status: 400 });
  }
}
