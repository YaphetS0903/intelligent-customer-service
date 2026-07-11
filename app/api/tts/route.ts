import { NextResponse } from "next/server";
import { textToSpeech } from "@/lib/tts";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const text = String(body.text ?? "").trim();

    if (!text) {
      return NextResponse.json({ error: "请输入需要转语音的文本" }, { status: 400 });
    }

    if (text.length > 2000) {
      return NextResponse.json({ error: "文本过长，请缩短到 2000 字以内" }, { status: 400 });
    }

    const audio = await textToSpeech(text);
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
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "生成语音失败" },
      { status: 400 }
    );
  }
}
