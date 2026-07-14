import { randomBytes } from "crypto";
import { NextResponse } from "next/server";
import {
  createTrainingCertificate,
  createTrainingExamSession,
  createTrainingQuizAttempt,
  getActiveTrainingExamSession,
  getCurrentUser,
  getTrainingCertificate,
  getTrainingJob,
  getTrainingProgress,
  listTrainingQuizAttempts,
  listTrainingQuizQuestions,
  updateTrainingExamSession
} from "@/lib/db";
import {
  gradeTrainingExam,
  normalizeSubmittedAnswers,
  prepareExamQuestions,
  publicTrainingQuizQuestions
} from "@/lib/training-quiz";
import { canAccessTrainingJob } from "@/lib/training-access";
import { notifyUsers } from "@/lib/notification-events";
import type { TrainingExamSession } from "@/lib/types";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: RouteContext) {
  try {
    const user = await getCurrentUser();
    const { id } = await params;
    const job = await getTrainingJob(id);
    if (!job) return NextResponse.json({ error: "课程不存在" }, { status: 404 });
    if (!canAccessTrainingJob(user, job)) return NextResponse.json({ error: "无权访问该课程" }, { status: 403 });
    const [attempts, progress, activeSession, certificate, questions] = await Promise.all([
      listTrainingQuizAttempts(id, user.id),
      getTrainingProgress(id, user.id),
      getActiveTrainingExamSession(id, user.id),
      getTrainingCertificate(id, user.id),
      listTrainingQuizQuestions(id)
    ]);
    const session = activeSession && new Date(activeSession.expires_at).getTime() > Date.now() ? activeSession : null;
    if (activeSession && !session) await updateTrainingExamSession(activeSession.id, { status: "expired", submitted_at: null });
    return NextResponse.json({
      settings: examSettings(job),
      progress_percent: progress?.progress_percent ?? 0,
      eligible: Boolean(job.quiz_enabled && questions.length > 0 && (progress?.progress_percent ?? 0) >= 100 && attempts.length < job.quiz_max_attempts),
      blocked_reason: blockedReason(job, questions.length, progress?.progress_percent ?? 0, attempts.length),
      attempts,
      latestAttempt: attempts[0] ?? null,
      session: session ? publicSession(session) : null,
      certificate
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "读取考试失败" }, { status: 400 });
  }
}

export async function POST(request: Request, { params }: RouteContext) {
  try {
    const user = await getCurrentUser();
    const { id } = await params;
    const job = await getTrainingJob(id);
    if (!job) return NextResponse.json({ error: "课程不存在" }, { status: 404 });
    if (!canAccessTrainingJob(user, job)) return NextResponse.json({ error: "无权访问该课程" }, { status: 403 });
    const body = await request.json().catch(() => ({}));
    if (body.action === "start") {
      const [progress, attempts, questions, existing] = await Promise.all([
        getTrainingProgress(id, user.id), listTrainingQuizAttempts(id, user.id), listTrainingQuizQuestions(id), getActiveTrainingExamSession(id, user.id)
      ]);
      const reason = blockedReason(job, questions.length, progress?.progress_percent ?? 0, attempts.length);
      if (reason) return NextResponse.json({ error: reason }, { status: 400 });
      if (existing && new Date(existing.expires_at).getTime() > Date.now()) return NextResponse.json({ session: publicSession(existing), settings: examSettings(job) });
      if (existing) await updateTrainingExamSession(existing.id, { status: "expired", submitted_at: null });
      const startedAt = new Date();
      const session = await createTrainingExamSession({
        training_job_id: id,
        user_id: user.id,
        question_snapshot: prepareExamQuestions(questions),
        status: "in_progress",
        started_at: startedAt.toISOString(),
        expires_at: new Date(startedAt.getTime() + job.quiz_time_limit_minutes * 60_000).toISOString(),
        submitted_at: null
      });
      return NextResponse.json({ session: publicSession(session), settings: examSettings(job) }, { status: 201 });
    }

    if (body.action !== "submit") return NextResponse.json({ error: "请先开始考试" }, { status: 400 });
    const session = await getActiveTrainingExamSession(id, user.id);
    if (!session || session.id !== String(body.session_id ?? "")) return NextResponse.json({ error: "考试会话不存在或已提交" }, { status: 400 });
    if (new Date(session.expires_at).getTime() < Date.now()) {
      await updateTrainingExamSession(session.id, { status: "expired", submitted_at: null });
      return NextResponse.json({ error: "考试已超时，请重新开始" }, { status: 400 });
    }
    const answers = normalizeSubmittedAnswers(body.answers);
    const result = gradeTrainingExam(session.question_snapshot, answers, job.quiz_pass_score);
    const attempts = await listTrainingQuizAttempts(id, user.id);
    const submittedAt = new Date();
    const attempt = await createTrainingQuizAttempt({
      training_job_id: id,
      user_id: user.id,
      session_id: session.id,
      answers,
      result_detail: result.result_detail,
      score: result.score,
      passed: result.passed,
      attempt_number: attempts.length + 1,
      duration_seconds: Math.max(0, Math.round((submittedAt.getTime() - new Date(session.started_at).getTime()) / 1000)),
      started_at: session.started_at,
      submitted_at: submittedAt.toISOString()
    });
    await updateTrainingExamSession(session.id, { status: "submitted", submitted_at: submittedAt.toISOString() });
    let certificate = await getTrainingCertificate(id, user.id);
    if (attempt.passed && job.certificate_enabled && !certificate) {
      certificate = await createTrainingCertificate({
        certificate_no: buildCertificateNumber(),
        training_job_id: id,
        user_id: user.id,
        quiz_attempt_id: attempt.id,
        issued_at: submittedAt.toISOString(),
        revoked_at: null,
        revoked_by: null,
        revoke_reason: null
      });
      await notifyUsers([user.id], {
        category: "system", severity: "success", title: "培训证书已签发",
        body: `你已完成「${job.title}」并通过考试，证书编号 ${certificate.certificate_no}。`,
        href: `/training/${job.id}`, source_type: "training_certificate", source_id: certificate.id,
        dedupe_key: `training-certificate:${certificate.id}`, metadata: { training_job_id: id, certificate_id: certificate.id }
      });
    }
    return NextResponse.json({ attempt, correct: result.correct, total: result.total, result_detail: result.result_detail, certificate });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "提交考试失败" }, { status: 400 });
  }
}

function blockedReason(job: Awaited<ReturnType<typeof getTrainingJob>> & {}, questionCount: number, progressPercent: number, attemptCount: number) {
  if (!job.quiz_enabled) return "该课程未启用考试";
  if (questionCount === 0) return "管理员尚未发布正式考试题";
  if (progressPercent < 100) return "完成全部课程学习后才能参加考试";
  if (attemptCount >= job.quiz_max_attempts) return `已达到最多 ${job.quiz_max_attempts} 次考试限制`;
  return null;
}

function examSettings(job: NonNullable<Awaited<ReturnType<typeof getTrainingJob>>>) {
  return { pass_score: job.quiz_pass_score, max_attempts: job.quiz_max_attempts, time_limit_minutes: job.quiz_time_limit_minutes, certificate_enabled: job.certificate_enabled };
}

function publicSession(session: TrainingExamSession) {
  return { ...session, question_snapshot: publicTrainingQuizQuestions(session.question_snapshot) };
}

function buildCertificateNumber() {
  return `TRN-${new Date().getFullYear()}-${randomBytes(5).toString("hex").toUpperCase()}`;
}
