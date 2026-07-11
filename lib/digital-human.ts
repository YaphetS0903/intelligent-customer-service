import { env, hasDigitalHumanConfig } from "@/lib/config";
import { buildProviderHeaders, renderJsonTemplate } from "@/lib/provider-http";
import type { DigitalHumanJobStatus, TrainingJob, TrainingVideoJob } from "@/lib/types";

type ProviderSubmitResult = {
  provider_job_id: string | null;
  status: DigitalHumanJobStatus;
  video_url: string | null;
  cover_url: string | null;
  error_message: string | null;
  metadata: Record<string, unknown>;
};

type ProviderStatusResult = Partial<ProviderSubmitResult>;

export function summarizeTrainingScript(job: TrainingJob) {
  return job.script_json
    .map((slide) => {
      const bullets = slide.bullets.length > 0 ? `\n要点：${slide.bullets.join("；")}` : "";
      return `第 ${slide.page} 页：${slide.title}${bullets}\n讲稿：${slide.script}`;
    })
    .join("\n\n")
    .slice(0, 20000);
}

export async function submitDigitalHumanVideo(job: TrainingJob): Promise<ProviderSubmitResult> {
  if (!hasDigitalHumanConfig()) {
    throw new Error("未配置数字人服务。请在系统配置中填写 DIGITAL_HUMAN_PROVIDER=custom、API URL 和 API Key。");
  }

  const script = summarizeTrainingScript(job);
  const slides = job.script_json.map((slide) => ({
    page: slide.page,
    title: slide.title,
    bullets: slide.bullets,
    notes: slide.notes,
    script: slide.script
  }));
  const body = renderJsonTemplate(
    env.digitalHumanPayloadTemplate,
    {
      title: job.title,
      input: script,
      script,
      model: env.digitalHumanModel,
      avatar_id: env.digitalHumanAvatarId,
      voice_id: env.digitalHumanVoiceId,
      slides_json: JSON.stringify(slides),
      slides
    },
    {
      title: job.title,
      input: script,
      script,
      model: env.digitalHumanModel || undefined,
      avatar_id: env.digitalHumanAvatarId || undefined,
      voice_id: env.digitalHumanVoiceId || undefined,
      callback_url: undefined,
      slides
    }
  );
  const response = await fetch(env.digitalHumanApiUrl, {
    method: "POST",
    headers: buildProviderHeaders({
      apiKey: env.digitalHumanApiKey,
      authHeader: env.digitalHumanAuthHeader,
      extraHeaders: env.digitalHumanHeaders,
      contentType: "application/json"
    }),
    body: JSON.stringify(body)
  });

  const payload = await readProviderPayload(response);

  if (!response.ok) {
    throw new Error(extractString(payload, ["error", "message", "msg"]) ?? `数字人服务调用失败：${response.status}`);
  }

  return normalizeProviderResult(payload);
}

export async function queryDigitalHumanVideoStatus(videoJob: TrainingVideoJob): Promise<ProviderStatusResult> {
  if (!hasDigitalHumanConfig()) {
    throw new Error("未配置数字人服务，无法刷新视频状态。");
  }

  const statusUrl = buildStatusUrl(videoJob);
  if (!statusUrl) {
    return {};
  }

  const response = await fetch(statusUrl, {
    method: "GET",
    headers: buildProviderHeaders({
      apiKey: env.digitalHumanApiKey,
      authHeader: env.digitalHumanAuthHeader,
      extraHeaders: env.digitalHumanHeaders
    })
  });
  const payload = await readProviderPayload(response);

  if (!response.ok) {
    throw new Error(extractString(payload, ["error", "message", "msg"]) ?? `数字人状态查询失败：${response.status}`);
  }

  return normalizeProviderResult(payload);
}

function buildStatusUrl(videoJob: TrainingVideoJob) {
  const metadataStatusUrl = extractString(videoJob.metadata, ["status_url", "statusUrl", "query_url", "queryUrl"]);
  if (metadataStatusUrl) {
    return metadataStatusUrl;
  }

  if (env.digitalHumanStatusUrl && videoJob.provider_job_id) {
    return env.digitalHumanStatusUrl.replace("{job_id}", encodeURIComponent(videoJob.provider_job_id));
  }

  return null;
}

async function readProviderPayload(response: Response): Promise<Record<string, unknown>> {
  const contentType = response.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    const json = await response.json();
    return typeof json === "object" && json ? json as Record<string, unknown> : {};
  }

  const text = await response.text();
  try {
    const json = JSON.parse(text);
    return typeof json === "object" && json ? json as Record<string, unknown> : {};
  } catch {
    return { text };
  }
}

function normalizeProviderResult(payload: Record<string, unknown>): ProviderSubmitResult {
  const nested = getNestedObject(payload, "data") ?? getNestedObject(payload, "result") ?? getNestedObject(payload, "output");
  const source = nested ? { ...payload, ...nested } : payload;
  const videoUrl = extractString(source, ["video_url", "videoUrl", "url", "output_url", "outputUrl"]);
  const providerJobId = extractString(source, ["job_id", "jobId", "task_id", "taskId", "id"]) ?? null;
  const statusText = extractString(source, ["status", "state"]) ?? "";
  const errorMessage = extractString(source, ["error", "message", "msg", "error_message", "errorMessage"]);

  return {
    provider_job_id: providerJobId,
    status: normalizeProviderStatus(statusText, Boolean(videoUrl), Boolean(errorMessage)),
    video_url: videoUrl,
    cover_url: extractString(source, ["cover_url", "coverUrl", "thumbnail", "poster"]) ?? null,
    error_message: normalizeProviderStatus(statusText, Boolean(videoUrl), Boolean(errorMessage)) === "failed" ? errorMessage : null,
    metadata: source
  };
}

function normalizeProviderStatus(status: string, hasVideo: boolean, hasError: boolean): DigitalHumanJobStatus {
  if (hasVideo) {
    return "ready";
  }

  if (hasError) {
    return "failed";
  }

  const normalized = status.toLowerCase();
  if (["success", "succeeded", "completed", "complete", "ready", "done", "finished"].includes(normalized)) {
    return "ready";
  }

  if (["failed", "fail", "error", "canceled", "cancelled"].includes(normalized)) {
    return "failed";
  }

  if (["queued", "pending", "created", "waiting"].includes(normalized)) {
    return "queued";
  }

  return "generating";
}

function getNestedObject(payload: Record<string, unknown>, key: string) {
  const value = payload[key];
  return typeof value === "object" && value ? value as Record<string, unknown> : null;
}

function extractString(payload: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  for (const value of Object.values(payload)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item && typeof item === "object") {
          const found = extractString(item as Record<string, unknown>, keys);
          if (found) {
            return found;
          }
        }
      }
      continue;
    }

    if (value && typeof value === "object") {
      const found = extractString(value as Record<string, unknown>, keys);
      if (found) {
        return found;
      }
    }
  }

  return null;
}
