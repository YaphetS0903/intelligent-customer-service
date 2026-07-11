import { createModelUsageEvent } from "@/lib/db";
import { env } from "@/lib/config";
import { normalizeModelUsage } from "@/lib/model-usage";

export async function recordTrainingTtsUsage(input: {
  sourceId: string;
  trainingJobId: string;
  userId: string | null;
  text: string;
  audioBytes?: number | null;
  contentType?: string | null;
  metadata?: Record<string, unknown>;
}) {
  const usage = normalizeModelUsage({
    inputText: input.text,
    outputText: ""
  });

  await createModelUsageEvent({
    source: "training_tts",
    source_id: input.sourceId,
    conversation_id: null,
    user_id: input.userId,
    provider: ttsUsageProvider(),
    model: ttsUsageModel(),
    ...usage,
    metadata: {
      training_job_id: input.trainingJobId,
      audio_bytes: input.audioBytes ?? null,
      content_type: input.contentType ?? null,
      ...input.metadata
    }
  });
}

export async function recordTrainingVideoUsage(input: {
  sourceId: string;
  trainingJobId: string;
  userId: string | null;
  slideCount: number;
  videoBytes?: number | null;
  metadata?: Record<string, unknown>;
}) {
  await createModelUsageEvent({
    source: "training_video",
    source_id: input.sourceId,
    conversation_id: null,
    user_id: input.userId,
    provider: "local",
    model: "ffmpeg-slide-video",
    input_tokens: 0,
    output_tokens: 0,
    total_tokens: 0,
    estimated: true,
    cost_usd: null,
    metadata: {
      training_job_id: input.trainingJobId,
      slide_count: input.slideCount,
      video_bytes: input.videoBytes ?? null,
      ...input.metadata
    }
  });
}

function ttsUsageProvider() {
  return env.ttsProvider === "custom" ? "custom_tts" : "openai";
}

function ttsUsageModel() {
  if (env.ttsProvider === "custom") {
    return [env.ttsModel, env.ttsVoice].filter(Boolean).join(" / ") || "custom";
  }

  return env.openaiTtsModel;
}
