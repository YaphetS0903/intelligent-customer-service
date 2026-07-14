import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/db";
import { consumeRateLimit, getRequestIp } from "@/lib/request-security";
import { textToSpeech } from "@/lib/tts";

let activeRequests = 0;
const maxConcurrentRequests = 3;

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    const rateLimit = consumeRateLimit(`tts:${user.id}:${getRequestIp(request)}`, { limit: 20, windowMs: 60_000 });
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: "语音请求过于频繁，请稍后再试" },
        { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } }
      );
    }
    if (activeRequests >= maxConcurrentRequests) {
      return NextResponse.json({ error: "语音服务正忙，请稍后重试" }, { status: 503 });
    }
    const body = await request.json();
    const text = String(body.text ?? "").trim();

    if (!text) {
      return NextResponse.json({ error: "请输入需要转语音的文本" }, { status: 400 });
    }

    if (text.length > 2000) {
      return NextResponse.json({ error: "文本过长，请缩短到 2000 字以内" }, { status: 400 });
    }

    activeRequests += 1;
    const audio = await textToSpeech(text, { signal: AbortSignal.timeout(45_000) }).finally(() => {
      activeRequests = Math.max(0, activeRequests - 1);
    });
    if (!audio) {
      return NextResponse.json({ error: "未配置可用 TTS。请在配置页填写 OpenAI 或自定义 TTS 配置。" }, { status: 400 });
    }

    return new Response(audio.audio, {
      headers: {
        "Content-Type": audio.contentType,
        "Cache-Control": "no-store"
      }
    });
  } catch (error) {
    const unauthenticated = error instanceof Error && error.message === "请先登录";
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "生成语音失败" },
      { status: unauthenticated ? 401 : 400 }
    );
  }
}
