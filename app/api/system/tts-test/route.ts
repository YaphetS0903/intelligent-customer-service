import { NextResponse } from "next/server";
import { requireSettingsAccess } from "@/lib/health";
import { textToSpeech } from "@/lib/tts";

export const dynamic = "force-dynamic";

export async function POST() {
  const startedAt = Date.now();

  try {
    await requireSettingsAccess();
    const audio = await textToSpeech("语音连通正常");

    if (!audio) {
      return NextResponse.json(
        {
          result: {
            ok: false,
            latency_ms: Date.now() - startedAt,
            content_type: null,
            bytes: 0,
            error: "未配置可用 TTS。请在配置页填写 OpenAI 或自定义 TTS 配置。"
          }
        },
        { status: 400 }
      );
    }

    return NextResponse.json({
      result: {
        ok: true,
        latency_ms: Date.now() - startedAt,
        content_type: audio.contentType,
        bytes: audio.audio.byteLength,
        error: null
      }
    });
  } catch (error) {
    return NextResponse.json(
      {
        result: {
          ok: false,
          latency_ms: Date.now() - startedAt,
          content_type: null,
          bytes: 0,
          error: error instanceof Error ? error.message : "语音连通性测试失败"
        }
      },
      { status: 400 }
    );
  }
}
