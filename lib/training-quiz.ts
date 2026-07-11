import type { TrainingJob } from "@/lib/types";

export type TrainingQuizQuestion = {
  id: string;
  question: string;
  options: string[];
  answer: string;
};

export function buildTrainingQuiz(job: TrainingJob): TrainingQuizQuestion[] {
  const slides = job.script_json.filter((slide) => slide.title.trim());
  const selectedSlides = slides.slice(0, Math.min(5, slides.length));

  return selectedSlides.map((slide, index) => {
    const otherOptions = slides
      .filter((item) => item.title !== slide.title)
      .slice(index, index + 3)
      .map((item) => item.title);
    const fallbackOptions = ["安全要求", "质量流程", "考勤制度", "保密要求"].filter((item) => item !== slide.title);
    const distractors = uniquePreserveOrder([...otherOptions, ...fallbackOptions])
      .filter((option) => option !== slide.title)
      .slice(0, 3);
    const options = uniquePreserveOrder([slide.title, ...distractors]);

    return {
      id: `q${index + 1}`,
      question: `第 ${slide.page} 页主要讲解的主题是什么？`,
      options,
      answer: slide.title
    };
  });
}

export function gradeTrainingQuiz(job: TrainingJob, answers: Record<string, string>) {
  const questions = buildTrainingQuiz(job);
  const correct = questions.filter((question) => answers[question.id] === question.answer).length;
  const score = questions.length === 0 ? 0 : Math.round((correct / questions.length) * 100);

  return {
    questions,
    correct,
    score,
    passed: score >= 80
  };
}

function uniquePreserveOrder(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}
