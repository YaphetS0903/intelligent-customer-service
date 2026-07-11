import { NextResponse } from "next/server";
import { env, hasDigitalHumanConfig } from "@/lib/config";
import { submitDigitalHumanVideo } from "@/lib/digital-human";
import { requireSettingsAccess } from "@/lib/health";
import type { TrainingJob } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function POST() {
  const startedAt = Date.now();

  try {
    await requireSettingsAccess();

    if (!hasDigitalHumanConfig()) {
      return NextResponse.json(
        {
          result: {
            ok: false,
            latency_ms: Date.now() - startedAt,
            provider_job_id: null,
            status: null,
            video_url: null,
            cover_url: null,
            model: env.digitalHumanModel,
            avatar_id: env.digitalHumanAvatarId,
            voice_id: env.digitalHumanVoiceId,
            error: "未配置数字人服务。请填写 DIGITAL_HUMAN_PROVIDER=custom、生成 API URL 和 API Key。"
          }
        },
        { status: 400 }
      );
    }

    const testJob: TrainingJob = {
      id: "digital-human-connectivity-test",
      title: "数字人接口连通性测试",
      description: "用于验证数字人接口连通性。",
      instructor: "系统管理员",
      cover_url: null,
      visible_departments: [],
      ppt_file_name: "connectivity-test.pptx",
      ppt_storage_path: null,
      script_json: [
        {
          page: 1,
          title: "接口测试",
          bullets: ["验证数字人生成接口是否可访问", "确认返回任务编号或视频地址"],
          notes: "这是一段系统自动生成的接口测试讲稿。",
          script: "大家好，这是一段来自西安天瑞汽车内饰件有限公司智能客服系统的数字人接口连通性测试。"
        }
      ],
      audio_paths: [],
      status: "ready",
      publish_status: "draft",
      published_by: null,
      published_at: null,
      created_by: null,
      created_at: new Date().toISOString()
    };

    const providerResult = await submitDigitalHumanVideo(testJob);
    const ok = providerResult.status !== "failed" && Boolean(providerResult.provider_job_id || providerResult.video_url);

    return NextResponse.json({
      result: {
        ok,
        latency_ms: Date.now() - startedAt,
        provider_job_id: providerResult.provider_job_id,
        status: providerResult.status,
        video_url: providerResult.video_url,
        cover_url: providerResult.cover_url,
        model: env.digitalHumanModel,
        avatar_id: env.digitalHumanAvatarId,
        voice_id: env.digitalHumanVoiceId,
        error: ok ? null : providerResult.error_message ?? "数字人接口已返回，但未包含任务编号或视频地址。"
      }
    }, { status: ok ? 200 : 400 });
  } catch (error) {
    return NextResponse.json(
      {
        result: {
          ok: false,
          latency_ms: Date.now() - startedAt,
          provider_job_id: null,
          status: null,
          video_url: null,
          cover_url: null,
          model: env.digitalHumanModel,
          avatar_id: env.digitalHumanAvatarId,
          voice_id: env.digitalHumanVoiceId,
          error: error instanceof Error ? error.message : "数字人连通性测试失败"
        }
      },
      { status: 400 }
    );
  }
}
