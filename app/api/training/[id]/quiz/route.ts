import { NextResponse } from "next/server";
import { createTrainingQuizAttempt, getCurrentUser, getTrainingJob, listTrainingQuizAttempts } from "@/lib/db";
import { buildTrainingQuiz, gradeTrainingQuiz } from "@/lib/training-quiz";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, { params }: RouteContext) {
  try {
    const user = await getCurrentUser();
    const { id } = await params;
    const job = await getTrainingJob(id);

    if (!job) {
      return NextResponse.json({ error: "课程不存在" }, { status: 404 });
    }

    if (user.role !== "admin" && (job.publish_status !== "published" || job.status !== "ready")) {
      return NextResponse.json({ error: "课程未发布" }, { status: 403 });
    }

    const attempts = await listTrainingQuizAttempts(id, user.id);
    const questions = buildTrainingQuiz(job).map(({ answer: _answer, ...question }) => question);

    return NextResponse.json({
      questions,
      latestAttempt: attempts[0] ?? null
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "读取测验失败" },
      { status: 400 }
    );
  }
}

export async function POST(request: Request, { params }: RouteContext) {
  try {
    const user = await getCurrentUser();
    const { id } = await params;
    const job = await getTrainingJob(id);

    if (!job) {
      return NextResponse.json({ error: "课程不存在" }, { status: 404 });
    }

    if (user.role !== "admin" && (job.publish_status !== "published" || job.status !== "ready")) {
      return NextResponse.json({ error: "课程未发布" }, { status: 403 });
    }

    const body = await request.json();
    const answers = body.answers && typeof body.answers === "object" ? body.answers as Record<string, string> : {};
    const result = gradeTrainingQuiz(job, answers);
    const attempt = await createTrainingQuizAttempt({
      training_job_id: id,
      user_id: user.id,
      answers,
      score: result.score,
      passed: result.passed
    });

    return NextResponse.json({
      attempt,
      correct: result.correct,
      total: result.questions.length
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "提交测验失败" },
      { status: 400 }
    );
  }
}
