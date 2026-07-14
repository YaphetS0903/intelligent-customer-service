import { NextResponse } from "next/server";
import {
  createTrainingAuditEvent,
  getTrainingJob,
  listTrainingQuizQuestions,
  replaceTrainingQuizQuestions,
  requireAdmin,
  updateTrainingJob
} from "@/lib/db";
import { buildGeneratedTrainingQuiz, validateTrainingQuizQuestions } from "@/lib/training-quiz";
import type { TrainingQuestionType, TrainingQuizQuestion } from "@/lib/types";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Context) {
  try {
    await requireAdmin();
    const { id } = await params;
    const job = await getTrainingJob(id);
    if (!job) return NextResponse.json({ error: "课程不存在" }, { status: 404 });
    const questions = await listTrainingQuizQuestions(id, true);
    return NextResponse.json({ job, questions });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "读取题库失败" }, { status: 400 });
  }
}

export async function POST(request: Request, { params }: Context) {
  try {
    const user = await requireAdmin();
    const { id } = await params;
    const job = await getTrainingJob(id);
    if (!job) return NextResponse.json({ error: "课程不存在" }, { status: 404 });
    const body = await request.json().catch(() => ({}));
    if (body.action !== "generate") return NextResponse.json({ error: "不支持的题库操作" }, { status: 400 });
    const generated = buildGeneratedTrainingQuiz(job, user.id);
    const questions = await replaceTrainingQuizQuestions(id, generated.map(stripQuestionIdentity));
    await createTrainingAuditEvent({ training_job_id: id, actor_id: user.id, action: "quiz_updated", detail: "根据课程讲稿生成考试题初稿", metadata: { count: questions.length } });
    return NextResponse.json({ questions, message: `已生成 ${questions.length} 道题，请审核后发布。` });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "生成题库失败" }, { status: 400 });
  }
}

export async function PUT(request: Request, { params }: Context) {
  try {
    const user = await requireAdmin();
    const { id } = await params;
    const job = await getTrainingJob(id);
    if (!job) return NextResponse.json({ error: "课程不存在" }, { status: 404 });
    const body = await request.json();
    const questions = normalizeQuestions(body.questions, id, user.id);
    const quizEnabled = body.settings?.quiz_enabled !== false;
    const validationError = quizEnabled ? validateTrainingQuizQuestions(questions) : null;
    if (validationError) return NextResponse.json({ error: validationError }, { status: 400 });
    const publish = body.publish !== false;
    const stored = await replaceTrainingQuizQuestions(id, questions.map((question) => stripQuestionIdentity({ ...question, status: publish ? "published" : "draft" })));
    const settings = {
      mandatory: Boolean(body.settings?.mandatory),
      due_at: normalizeDate(body.settings?.due_at),
      quiz_enabled: quizEnabled,
      quiz_pass_score: boundedInteger(body.settings?.quiz_pass_score, 60, 100, job.quiz_pass_score),
      quiz_max_attempts: boundedInteger(body.settings?.quiz_max_attempts, 1, 10, job.quiz_max_attempts),
      quiz_time_limit_minutes: boundedInteger(body.settings?.quiz_time_limit_minutes, 5, 180, job.quiz_time_limit_minutes),
      certificate_enabled: body.settings?.certificate_enabled !== false
    };
    const updatedJob = await updateTrainingJob(id, settings);
    await createTrainingAuditEvent({ training_job_id: id, actor_id: user.id, action: "quiz_updated", detail: publish ? "更新并发布正式考试" : "保存考试题草稿", metadata: { count: stored.length, ...settings } });
    return NextResponse.json({ job: updatedJob, questions: stored, message: publish ? "正式考试已发布。" : "考试草稿已保存。" });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "保存题库失败" }, { status: 400 });
  }
}

function normalizeQuestions(value: unknown, trainingJobId: string, createdBy: string): TrainingQuizQuestion[] {
  if (!Array.isArray(value)) return [];
  const now = new Date().toISOString();
  return value.map((item, index) => {
    const row = item && typeof item === "object" ? item as Record<string, unknown> : {};
    const type: TrainingQuestionType = ["single", "multiple", "true_false"].includes(String(row.type)) ? String(row.type) as TrainingQuestionType : "single";
    const options = type === "true_false" ? ["正确", "错误"] : uniqueStrings(row.options);
    return {
      id: String(row.id ?? `question-${index + 1}`),
      training_job_id: trainingJobId,
      type,
      prompt: String(row.prompt ?? "").trim(),
      options,
      correct_answers: uniqueStrings(row.correct_answers),
      explanation: String(row.explanation ?? "").trim(),
      score_weight: boundedInteger(row.score_weight, 1, 10, 1),
      order_index: index,
      status: row.status === "published" ? "published" : "draft",
      created_by: createdBy,
      created_at: now,
      updated_at: now
    };
  });
}

function stripQuestionIdentity(question: TrainingQuizQuestion): Omit<TrainingQuizQuestion, "id" | "training_job_id" | "created_at" | "updated_at"> {
  const { id: _id, training_job_id: _jobId, created_at: _createdAt, updated_at: _updatedAt, ...record } = question;
  return record;
}

function uniqueStrings(value: unknown) {
  return Array.isArray(value) ? [...new Set(value.map(String).map((item) => item.trim()).filter(Boolean))] : [];
}

function boundedInteger(value: unknown, min: number, max: number, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(Math.max(Math.round(parsed), min), max) : fallback;
}

function normalizeDate(value: unknown) {
  if (!value) return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
