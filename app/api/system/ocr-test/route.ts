import { NextResponse } from "next/server";
import { env } from "@/lib/config";
import { recognizeTextWithOcr } from "@/lib/document-text";
import { requireSettingsAccess } from "@/lib/health";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const startedAt = Date.now();

  try {
    await requireSettingsAccess();
    const contentType = request.headers.get("content-type") ?? "";

    if (!contentType.includes("multipart/form-data") && !contentType.includes("application/x-www-form-urlencoded")) {
      return NextResponse.json(
        {
          result: {
            ok: false,
            latency_ms: Date.now() - startedAt,
            sections: 0,
            characters: 0,
            preview: "",
            model: env.ocrModel,
            error: "请上传要测试的图片或扫描件 PDF。"
          }
        },
        { status: 400 }
      );
    }

    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json(
        {
          result: {
            ok: false,
            latency_ms: Date.now() - startedAt,
            sections: 0,
            characters: 0,
            preview: "",
            model: env.ocrModel,
            error: "请上传要测试的图片或扫描件 PDF。"
          }
        },
        { status: 400 }
      );
    }

    if (file.size > env.maxUploadMb * 1024 * 1024) {
      return NextResponse.json(
        {
          result: {
            ok: false,
            latency_ms: Date.now() - startedAt,
            sections: 0,
            characters: 0,
            preview: "",
            model: env.ocrModel,
            error: `文件不能超过 ${env.maxUploadMb}MB`
          }
        },
        { status: 400 }
      );
    }

    const extracted = await recognizeTextWithOcr(file);
    const content = extracted.content.trim();

    return NextResponse.json({
      result: {
        ok: true,
        latency_ms: Date.now() - startedAt,
        sections: extracted.sections.length,
        characters: content.length,
        preview: content.slice(0, 500),
        model: env.ocrModel,
        error: null
      }
    });
  } catch (error) {
    return NextResponse.json(
      {
        result: {
          ok: false,
          latency_ms: Date.now() - startedAt,
          sections: 0,
          characters: 0,
          preview: "",
          model: env.ocrModel,
          error: error instanceof Error ? error.message : "OCR 连通性测试失败"
        }
      },
      { status: 400 }
    );
  }
}
