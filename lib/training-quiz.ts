import type { TrainingJob, TrainingQuizQuestion } from "@/lib/types";

export type PublicTrainingQuizQuestion = Omit<TrainingQuizQuestion, "correct_answers" | "explanation" | "created_by">;

export function buildGeneratedTrainingQuiz(job: TrainingJob, createdBy: string | null = null): TrainingQuizQuestion[] {
  const slides = job.script_json.filter((slide) => slide.title.trim());
  const selectedSlides = slides.slice(0, Math.min(8, slides.length));
  const now = new Date().toISOString();

  return selectedSlides.map((slide, index) => {
    const distractors = uniquePreserveOrder([
      ...slides.filter((item) => item.title !== slide.title).slice(index + 1).map((item) => item.title),
      ...slides.filter((item) => item.title !== slide.title).slice(0, index).map((item) => item.title),
      "安全要求",
      "质量流程",
      "保密要求"
    ]).filter((option) => option !== slide.title).slice(0, 3);

    return {
      id: `generated-${index + 1}`,
      training_job_id: job.id,
      type: "single",
      prompt: `第 ${slide.page} 页主要讲解的主题是什么？`,
      options: shuffle([slide.title, ...distractors]),
      correct_answers: [slide.title],
      explanation: slide.script.slice(0, 240),
      score_weight: 1,
      order_index: index,
      status: "draft",
      created_by: createdBy,
      created_at: now,
      updated_at: now
    };
  });
}

export function validateTrainingQuizQuestions(questions: TrainingQuizQuestion[]) {
  if (questions.length === 0) return "请至少配置一道考试题";
  for (const [index, question] of questions.entries()) {
    if (!question.prompt.trim()) return `第 ${index + 1} 题缺少题干`;
    if (!question.options || question.options.length < 2) return `第 ${index + 1} 题至少需要两个选项`;
    if (question.correct_answers.length === 0) return `第 ${index + 1} 题缺少正确答案`;
    if (question.correct_answers.some((answer) => !question.options.includes(answer))) return `第 ${index + 1} 题的正确答案不在选项中`;
    if (question.type !== "multiple" && question.correct_answers.length !== 1) return `第 ${index + 1} 题只能设置一个正确答案`;
    if (question.type === "true_false" && (question.options.length !== 2 || !question.options.includes("正确") || !question.options.includes("错误"))) {
      return `第 ${index + 1} 道判断题必须使用“正确/错误”选项`;
    }
  }
  return null;
}

export function publicTrainingQuizQuestions(questions: TrainingQuizQuestion[]): PublicTrainingQuizQuestion[] {
  return questions.map(({ correct_answers: _correctAnswers, explanation: _explanation, created_by: _createdBy, ...question }) => question);
}

export function prepareExamQuestions(questions: TrainingQuizQuestion[]) {
  return shuffle(questions).map((question, index) => ({
    ...question,
    order_index: index,
    options: shuffle(question.options)
  }));
}

export function gradeTrainingExam(
  questions: TrainingQuizQuestion[],
  answers: Record<string, string | string[]>,
  passScore: number
) {
  const totalWeight = questions.reduce((sum, question) => sum + Math.max(1, question.score_weight), 0);
  let earnedWeight = 0;
  const resultDetail = questions.map((question) => {
    const selectedAnswers = normalizeAnswer(answers[question.id]);
    const correctAnswers = normalizeAnswer(question.correct_answers);
    const correct = sameSet(selectedAnswers, correctAnswers);
    if (correct) earnedWeight += Math.max(1, question.score_weight);
    return {
      question_id: question.id,
      correct,
      selected_answers: selectedAnswers,
      correct_answers: correctAnswers,
      explanation: question.explanation
    };
  });
  const score = totalWeight === 0 ? 0 : Math.round((earnedWeight / totalWeight) * 100);
  return {
    score,
    passed: score >= Math.min(Math.max(passScore, 0), 100),
    correct: resultDetail.filter((item) => item.correct).length,
    total: questions.length,
    result_detail: resultDetail
  };
}

export function normalizeSubmittedAnswers(value: unknown): Record<string, string | string[]> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const answers: Record<string, string | string[]> = {};
  for (const [key, answer] of Object.entries(value as Record<string, unknown>)) {
    if (typeof answer === "string") answers[key] = answer.trim();
    if (Array.isArray(answer)) answers[key] = answer.map(String).map((item) => item.trim()).filter(Boolean);
  }
  return answers;
}

function normalizeAnswer(value: string | string[] | undefined) {
  return uniquePreserveOrder(Array.isArray(value) ? value : value ? [value] : []).sort();
}

function sameSet(left: string[], right: string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function uniquePreserveOrder(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function shuffle<T>(values: T[]) {
  const next = [...values];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const target = Math.floor(Math.random() * (index + 1));
    [next[index], next[target]] = [next[target], next[index]];
  }
  return next;
}
