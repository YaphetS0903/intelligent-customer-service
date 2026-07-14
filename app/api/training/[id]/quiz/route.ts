import { randomBytes } from "crypto";
import { NextResponse } from "next/server";
import {
  getActiveTrainingExamSession,
  getCurrentUser,
  getTrainingCertificate,
  getTrainingJob,
  getTrainingProgress,
  listTrainingQuizAttempts,
  listTrainingQuizQuestions,
  startTrainingExam,
  submitTrainingExam,
  updateTrainingExamSession
} from "@/lib/db";
import {
  normalizeSubmittedAnswers,
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
      const [progress, attempts, questions] = await Promise.all([
        getTrainingProgress(id, user.id), listTrainingQuizAttempts(id, user.id), listTrainingQuizQuestions(id)
      ]);
      const reason = blockedReason(job, questions.length, progress?.progress_percent ?? 0, attempts.length);
      if (reason) return NextResponse.json({ error: reason }, { status: 400 });
      const started = await startTrainingExam({
        trainingJobId: id,
        userId: user.id,
        questions,
        maxAttempts: job.quiz_max_attempts,
        timeLimitMinutes: job.quiz_time_limit_minutes
      });
      return NextResponse.json(
        { session: publicSession(started.session), settings: examSettings(job) },
        { status: started.created ? 201 : 200 }
      );
    }

    if (body.action !== "submit") return NextResponse.json({ error: "请先开始考试" }, { status: 400 });
    const answers = normalizeSubmittedAnswers(body.answers);
    const submitted = await submitTrainingExam({
      trainingJobId: id,
      userId: user.id,
      sessionId: String(body.session_id ?? ""),
      answers,
      passScore: job.quiz_pass_score,
      maxAttempts: job.quiz_max_attempts,
      certificateEnabled: job.certificate_enabled,
      certificateNo: buildCertificateNumber()
    });
    if (submitted.error || !submitted.attempt) {
      return NextResponse.json({ error: submitted.error ?? "提交考试失败" }, { status: 400 });
    }
    if (submitted.certificateCreated && submitted.certificate) {
      await notifyUsers([user.id], {
        category: "system", severity: "success", title: "培训证书已签发",
        body: `你已完成「${job.title}」并通过考试，证书编号 ${submitted.certificate.certificate_no}。`,
        href: `/training/${job.id}`, source_type: "training_certificate", source_id: submitted.certificate.id,
        dedupe_key: `training-certificate:${submitted.certificate.id}`, metadata: { training_job_id: id, certificate_id: submitted.certificate.id }
      });
    }
    return NextResponse.json({
      attempt: submitted.attempt,
      correct: submitted.attempt.result_detail.filter((item) => item.correct).length,
      total: submitted.attempt.result_detail.length,
      result_detail: submitted.attempt.result_detail,
      certificate: submitted.certificate
    });
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
