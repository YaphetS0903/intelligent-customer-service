import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/db";
import {
  getChunkMetadataSuggestionStats,
  listChunkMetadataSuggestionJobSnapshots,
  startChunkMetadataSuggestionJob
} from "@/lib/chunk-metadata-suggestion-job";

export async function GET() {
  try {
    await requireAdmin();
    const jobs = listChunkMetadataSuggestionJobSnapshots();
    const statsResult = await getChunkMetadataSuggestionStats()
      .then((stats) => ({ stats, warning: null as string | null }))
      .catch((error) => {
        console.warn("[chunk-suggestion-jobs:stats]", error);
        return {
          stats: [],
          warning: error instanceof Error ? error.message : "治理队列统计加载失败"
        };
      });

    return NextResponse.json({
      jobs,
      stats: statsResult.stats,
      warning: statsResult.warning
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "读取全库治理队列失败" },
      { status: 400 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireAdmin();
    const body = await request.json().catch(() => ({})) as {
      knowledge_base_id?: unknown;
      limit?: unknown;
      overwrite?: unknown;
    };
    const knowledgeBaseId = String(body.knowledge_base_id ?? "").trim();

    if (!knowledgeBaseId) {
      return NextResponse.json({ error: "请选择知识库" }, { status: 400 });
    }

    const job = await startChunkMetadataSuggestionJob({
      knowledgeBaseId,
      createdBy: user.id,
      limit: Number(body.limit),
      overwrite: Boolean(body.overwrite)
    });

    return NextResponse.json({ job });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "启动全库治理队列失败" },
      { status: 400 }
    );
  }
}
