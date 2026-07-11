import { NextResponse } from "next/server";
import { readEditableEnvSettings, writeEditableEnvSettings } from "@/lib/env-settings";
import { queueQaRetestsForStrategyChange } from "@/lib/knowledge-governance-retest-queue";
import { requireSettingsAccess } from "@/lib/health";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireSettingsAccess();
    const envFile = await readEditableEnvSettings();
    return NextResponse.json({ envFile });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "读取配置失败" },
      { status: 403 }
    );
  }
}

export async function PUT(request: Request) {
  try {
    const user = await requireSettingsAccess();
    const previousEnvFile = await readEditableEnvSettings();
    const body = await request.json();
    const envFile = await writeEditableEnvSettings(body.settings ?? {});
    const retestQueue = await queueQaRetestsForStrategyChange({
      createdBy: user.id,
      previousProvider: previousEnvFile.settings.RAG_PROVIDER,
      nextProvider: envFile.settings.RAG_PROVIDER,
      previousStrategy: previousEnvFile.settings.RAG_RETRIEVAL_STRATEGY,
      nextStrategy: envFile.settings.RAG_RETRIEVAL_STRATEGY,
      limit: 20
    });
    const retestNotice = formatRetestQueueNotice(retestQueue);

    return NextResponse.json({
      envFile,
      retestQueue,
      notice: `配置已保存到 .env.local。建议重启开发服务后再进行完整检查。${retestNotice}`
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "保存配置失败" },
      { status: 400 }
    );
  }
}

function formatRetestQueueNotice(queue: Awaited<ReturnType<typeof queueQaRetestsForStrategyChange>>) {
  if (queue.queued_task_count > 0) {
    return ` 已自动排队 ${queue.queued_task_count} 条 QA 整改复测，用于观察 RAG 策略变更效果。`;
  }

  if (queue.skipped_reason === "RAG 检索策略未变化" || queue.skipped_reason?.startsWith("当前不是本地文本 RAG")) {
    return "";
  }

  return queue.skipped_reason ? ` ${queue.skipped_reason}。` : "";
}
