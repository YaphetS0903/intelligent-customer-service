import { env, hasOpenAIConfig, hasTtsConfig } from "@/lib/config";
import { getOpenAIClient } from "@/lib/openai";
import { buildProviderHeaders, renderJsonTemplate } from "@/lib/provider-http";
import { createHmac } from "crypto";

process.env.WS_NO_BUFFER_UTIL ??= "1";
process.env.WS_NO_UTF_8_VALIDATE ??= "1";

export type SpeechAudio = {
  audio: ArrayBuffer;
  contentType: string;
};

const audioUrlKeys = [
  "url",
  "audio_url",
  "audioUrl",
  "file_url",
  "fileUrl",
  "download_url",
  "downloadUrl",
  "oss_url",
  "ossUrl"
];
const audioBase64Keys = [
  "audio_base64",
  "audioBase64",
  "audio_data",
  "audioData",
  "audio",
  "base64",
  "data",
  "result",
  "mp3",
  "wav",
  "speech"
];
const taskIdKeys = ["task_id", "taskId", "job_id", "jobId", "request_id", "requestId", "id"];
const mimeTypeKeys = ["content_type", "contentType", "mime_type", "mimeType", "format"];

export async function textToSpeech(input: string): Promise<SpeechAudio | null> {
  if (!hasTtsConfig()) {
    return null;
  }

  if (env.ttsProvider === "custom") {
    return customTextToSpeech(input);
  }

  return openAITextToSpeech(input);
}

async function openAITextToSpeech(input: string): Promise<SpeechAudio | null> {
  if (!hasOpenAIConfig()) {
    return null;
  }

  const openai = getOpenAIClient();
  if (!openai) {
    return null;
  }

  const audio = await openai.audio.speech.create({
    model: env.openaiTtsModel,
    voice: env.openaiTtsVoice,
    input
  });

  return {
    audio: await audio.arrayBuffer(),
    contentType: "audio/mpeg"
  };
}

async function customTextToSpeech(input: string): Promise<SpeechAudio | null> {
  if (env.ttsApiUrl.startsWith("wss://tts-api.xfyun.cn/")) {
    return xfyunTextToSpeech(input);
  }

  const body = renderJsonTemplate(
    env.ttsPayloadTemplate,
    {
      text: input,
      input,
      model: env.ttsModel,
      voice: env.ttsVoice,
      format: "mp3"
    },
    {
      text: input,
      input,
      model: env.ttsModel || undefined,
      voice: env.ttsVoice || undefined,
      format: "mp3"
    }
  );
  const response = await fetch(env.ttsApiUrl, {
    method: "POST",
    headers: buildProviderHeaders({
      apiKey: env.ttsApiKey,
      authHeader: env.ttsAuthHeader,
      extraHeaders: env.ttsHeaders,
      contentType: "application/json"
    }),
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    throw new Error(`TTS 生成失败：${response.status} ${response.statusText}`);
  }

  const contentType = response.headers.get("content-type") ?? "audio/mpeg";

  if (contentType.startsWith("audio/") || contentType === "application/octet-stream") {
    return {
      audio: await response.arrayBuffer(),
      contentType: contentType.startsWith("audio/") ? contentType : "audio/mpeg"
    };
  }

  const data = await response.json() as unknown;
  const parsed = await parseCustomTtsJson(data);

  if (parsed) {
    return parsed;
  }

  const taskId = findStringByKeys(data, taskIdKeys);
  if (taskId && env.ttsStatusUrl) {
    const taskAudio = await pollCustomTtsTask(taskId);
    if (taskAudio) {
      return taskAudio;
    }
  }

  throw new Error("TTS 接口未返回音频。请确认返回音频流，或 JSON 中包含 audio/audio_base64/audioUrl/url 字段；异步接口需配置 TTS_STATUS_URL。");
}

async function xfyunTextToSpeech(input: string): Promise<SpeechAudio | null> {
  const config = readXfyunTtsConfig();
  const url = buildXfyunTtsUrl(env.ttsApiUrl, env.ttsApiKey, config.apiSecret);
  const audioChunks: Buffer[] = [];
  const NativeWebSocket = globalThis.WebSocket;

  if (!NativeWebSocket) {
    throw new Error("当前 Node.js 环境不支持原生 WebSocket，无法调用讯飞 TTS。");
  }

  await new Promise<void>((resolve, reject) => {
    const ws = new NativeWebSocket(url);
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      if (error) {
        safeCloseWebSocket(ws);
        reject(error);
        return;
      }

      resolve();
    };
    const timeout = setTimeout(() => {
      finish(new Error("讯飞 TTS 连接超时"));
    }, 30000);

    ws.addEventListener("open", () => {
      ws.send(JSON.stringify({
        common: {
          app_id: config.appId
        },
        business: {
          aue: "lame",
          auf: "audio/L16;rate=16000",
          sfl: 1,
          vcn: env.ttsVoice || "aisjinger",
          speed: 50,
          volume: 50,
          pitch: 50,
          bgs: 0,
          tte: "UTF8"
        },
        data: {
          status: 2,
          text: Buffer.from(input, "utf8").toString("base64")
        }
      }));
    });

    ws.addEventListener("message", async (event) => {
      try {
        const message = JSON.parse(await stringifyWebSocketData(event.data)) as {
          code?: number;
          message?: string;
          data?: {
            audio?: string;
            status?: number;
          };
        };

        if (message.code && message.code !== 0) {
          throw new Error(message.message || `讯飞 TTS 返回错误：${message.code}`);
        }

        if (message.data?.audio) {
          audioChunks.push(Buffer.from(message.data.audio, "base64"));
        }

        if (message.data?.status === 2) {
          safeCloseWebSocket(ws);
          finish();
        }
      } catch (error) {
        finish(error instanceof Error ? error : new Error("讯飞 TTS 返回数据解析失败"));
      }
    });

    ws.addEventListener("error", () => {
      finish(new Error("讯飞 TTS WebSocket 连接失败，请确认 APIKey/APISecret/AppID 与服务开通状态。"));
    });

    ws.addEventListener("close", (event) => {
      if (audioChunks.length > 0) {
        finish();
        return;
      }

      if (!settled && event.code !== 1000) {
        finish(new Error(`讯飞 TTS WebSocket 已关闭：${event.code}${event.reason ? ` ${event.reason}` : ""}`));
      }
    });
  });

  const audio = Buffer.concat(audioChunks);
  if (audio.length === 0) {
    throw new Error("讯飞 TTS 未返回音频数据");
  }

  return {
    audio: audio.buffer.slice(audio.byteOffset, audio.byteOffset + audio.byteLength),
    contentType: "audio/mpeg"
  };
}

async function stringifyWebSocketData(data: unknown) {
  if (typeof data === "string") {
    return data;
  }

  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString("utf8");
  }

  if (ArrayBuffer.isView(data)) {
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString("utf8");
  }

  if (data instanceof Blob) {
    return Buffer.from(await data.arrayBuffer()).toString("utf8");
  }

  return String(data);
}

function safeCloseWebSocket(ws: WebSocket) {
  try {
    if (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN) {
      ws.close();
    }
  } catch {
    // Best effort cleanup only.
  }
}

function buildXfyunTtsUrl(apiUrl: string, apiKey: string, apiSecret: string) {
  const target = new URL(apiUrl || "wss://tts-api.xfyun.cn/v2/tts");
  const date = new Date().toUTCString();
  const signatureOrigin = `host: ${target.host}\ndate: ${date}\nGET ${target.pathname} HTTP/1.1`;
  const signature = createHmac("sha256", apiSecret).update(signatureOrigin).digest("base64");
  const authorization = Buffer.from(
    `api_key="${apiKey}", algorithm="hmac-sha256", headers="host date request-line", signature="${signature}"`,
    "utf8"
  ).toString("base64");

  return `${apiUrl}?authorization=${encodeURIComponent(authorization)}&date=${encodeURIComponent(date)}&host=${encodeURIComponent(target.host)}`;
}

function readXfyunTtsConfig() {
  const headers = parseTtsExtraSettings(env.ttsHeaders);
  const appId = headers.XFYUN_APP_ID || headers.app_id || headers.AppID || headers.APPID || "";
  const apiSecret = headers.XFYUN_API_SECRET || headers.api_secret || headers.APISecret || "";

  if (!appId || !apiSecret) {
    throw new Error("讯飞 TTS 需要在 TTS_HEADERS 中配置 XFYUN_APP_ID 和 XFYUN_API_SECRET。");
  }

  return { appId, apiSecret };
}

function parseTtsExtraSettings(value: string) {
  const trimmed = normalizeEscapedTtsSettings(value.trim());
  if (!trimmed) {
    return {} as Record<string, string>;
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return Object.fromEntries(
        Object.entries(parsed as Record<string, unknown>).map(([key, entryValue]) => [key, String(entryValue)])
      );
    }
  } catch {
    // Fall through to header-like line parser.
  }

  return Object.fromEntries(
    trimmed
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const separatorIndex = line.indexOf(":");
        if (separatorIndex === -1) {
          return null;
        }

        return [line.slice(0, separatorIndex).trim(), line.slice(separatorIndex + 1).trim()];
      })
      .filter((entry): entry is [string, string] => Boolean(entry))
  );
}

function normalizeEscapedTtsSettings(value: string) {
  if (!value.includes('\\"')) {
    return value;
  }

  return value
    .replace(/\\"/g, '"')
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t");
}

async function parseCustomTtsJson(data: unknown): Promise<SpeechAudio | null> {
  const url = findStringByKeys(data, audioUrlKeys);

  if (url) {
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`TTS 音频下载失败：${response.status} ${response.statusText}`);
    }

    const contentType = response.headers.get("content-type") ?? "audio/mpeg";
    return {
      audio: await response.arrayBuffer(),
      contentType: contentType.startsWith("audio/") ? contentType : "audio/mpeg"
    };
  }

  const base64 = findStringByKeys(data, audioBase64Keys);

  if (!base64 || looksLikeUrl(base64)) {
    return null;
  }

  const normalized = base64.includes(",") ? base64.split(",").pop() ?? "" : base64;
  const buffer = Buffer.from(normalized, "base64");

  if (buffer.length === 0) {
    return null;
  }

  return {
    audio: buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
    contentType: normalizeContentType(findStringByKeys(data, mimeTypeKeys))
  };
}

async function pollCustomTtsTask(taskId: string): Promise<SpeechAudio | null> {
  const statusUrl = env.ttsStatusUrl.replace("{task_id}", encodeURIComponent(taskId)).replace("{job_id}", encodeURIComponent(taskId));

  for (let attempt = 0; attempt < 8; attempt += 1) {
    if (attempt > 0) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }

    const response = await fetch(statusUrl, {
      headers: buildProviderHeaders({
        apiKey: env.ttsApiKey,
        authHeader: env.ttsAuthHeader,
        extraHeaders: env.ttsHeaders
      })
    });

    if (!response.ok) {
      if (attempt === 7) {
        throw new Error(`TTS 任务状态查询失败：${response.status} ${response.statusText}`);
      }
      continue;
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.startsWith("audio/") || contentType === "application/octet-stream") {
      return {
        audio: await response.arrayBuffer(),
        contentType: contentType.startsWith("audio/") ? contentType : "audio/mpeg"
      };
    }

    const data = await response.json().catch(() => null) as unknown;
    const parsed = await parseCustomTtsJson(data);
    if (parsed) {
      return parsed;
    }

    const status = findStringByKeys(data, ["status", "state"]).toLowerCase();
    if (["failed", "fail", "error", "canceled", "cancelled"].includes(status)) {
      const message = findStringByKeys(data, ["error", "message", "msg", "error_message", "errorMessage"]);
      throw new Error(message || "TTS 异步任务失败");
    }
  }

  return null;
}

function findStringByKeys(data: unknown, keys: string[], depth = 0): string {
  if (!data || typeof data !== "object") {
    return "";
  }

  const record = data as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  if (depth >= 5) {
    return "";
  }

  for (const value of Object.values(record)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = findStringByKeys(item, keys, depth + 1);
        if (found) {
          return found;
        }
      }
      continue;
    }

    if (value && typeof value === "object") {
      const found = findStringByKeys(value, keys, depth + 1);
      if (found) {
        return found;
      }
    }
  }

  return "";
}

function normalizeContentType(value: string) {
  if (!value) {
    return "audio/mpeg";
  }

  if (value.startsWith("audio/")) {
    return value;
  }

  if (value.toLowerCase().includes("wav")) {
    return "audio/wav";
  }

  if (value.toLowerCase().includes("ogg")) {
    return "audio/ogg";
  }

  return "audio/mpeg";
}

function looksLikeUrl(value: string) {
  return /^https?:\/\//i.test(value);
}
