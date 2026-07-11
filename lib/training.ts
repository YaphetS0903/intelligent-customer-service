import { env } from "@/lib/config";
import { getOpenAIClient } from "@/lib/openai";
import type { ParsedSlide } from "@/lib/pptx";

export type TrainingSlideScript = {
  page: number;
  title: string;
  bullets: string[];
  notes: string;
  script: string;
  image_path?: string | null;
};

export async function generateTrainingScripts(title: string, slides: ParsedSlide[]) {
  const openai = getOpenAIClient();

  if (!openai || slides.length === 0) {
    return fallbackScripts(slides);
  }

  const response = await openai.responses.create({
    model: env.openaiChatModel,
    input: [
      {
        role: "system",
        content:
          "你是企业内部培训讲师。请把 PPT 每页内容改写成适合口播的中文讲稿。输出必须是 JSON 数组，每项包含 page、title、bullets、notes、script。script 要自然、清楚、适合员工培训；如果有 notes，请优先吸收备注里的讲解意图；不要编造 PPT 没有的信息。"
      },
      {
        role: "user",
        content: JSON.stringify({
          course_title: title,
          slides: slides.map((slide) => ({
            page: slide.page,
            title: slide.title,
            bullets: slide.bullets,
            notes: slide.notes,
            rawText: slide.rawText
          }))
        })
      }
    ],
    text: {
      format: {
        type: "json_schema",
        name: "training_scripts",
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            slides: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  page: { type: "number" },
                  title: { type: "string" },
                  bullets: {
                    type: "array",
                    items: { type: "string" }
                  },
                  notes: { type: "string" },
                  script: { type: "string" }
                },
                required: ["page", "title", "bullets", "notes", "script"]
              }
            }
          },
          required: ["slides"]
        }
      }
    }
  });

  try {
    const parsed = JSON.parse(response.output_text ?? "{}") as { slides?: TrainingSlideScript[] };
    if (Array.isArray(parsed.slides) && parsed.slides.length > 0) {
      return parsed.slides;
    }
  } catch {
    // Fall through to deterministic scripts when model output is malformed.
  }

  return fallbackScripts(slides);
}

function fallbackScripts(slides: ParsedSlide[]): TrainingSlideScript[] {
  return slides.map((slide) => ({
    page: slide.page,
    title: slide.title,
    bullets: slide.bullets,
    notes: slide.notes,
    script: buildFallbackScript(slide)
  }));
}

function buildFallbackScript(slide: ParsedSlide) {
  const points = slide.bullets.length > 0 ? slide.bullets.join("；") : slide.rawText;
  const noteText = slide.notes ? `备注中还强调：${slide.notes}` : "";

  if (!points) {
    return `这一页的主题是“${slide.title}”。${noteText || "请结合页面内容进行讲解，并在培训时补充实际案例。"}`;
  }

  return `这一页我们来看“${slide.title}”。本页的重点包括：${points}。${noteText}培训时可以先说明这些要点的背景，再结合公司的实际流程或案例，帮助员工理解如何在工作中应用。`;
}
