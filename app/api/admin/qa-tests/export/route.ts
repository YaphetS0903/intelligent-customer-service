import { NextResponse } from "next/server";
import { listKnowledgeBases, listQaTestCases, requireAdmin } from "@/lib/db";
import type { QaTestStatus } from "@/lib/types";

export async function GET(request: Request) {
  try {
    await requireAdmin();
    const url = new URL(request.url);
    const status = url.searchParams.get("status") as QaTestStatus | "no_citation" | "all" | null;
    const [tests, knowledgeBases] = await Promise.all([
      listQaTestCases(),
      listKnowledgeBases()
    ]);
    const filtered = tests.filter((test) => {
      if (!status || status === "all") {
        return true;
      }

      if (status === "no_citation") {
        return Boolean(test.answer && test.citations.length === 0);
      }

      return test.status === status;
    });
    const kbById = new Map(knowledgeBases.map((kb) => [kb.id, kb.name]));
    const csv = [
      [
        "问题",
        "期望答案",
        "AI回答",
        "状态",
        "评审备注",
        "引用文件",
        "引用位置",
        "引用摘录",
        "响应耗时ms",
        "模型",
        "知识库",
        "更新时间"
      ],
      ...filtered.map((test) => [
        test.question,
        test.expected_answer ?? "",
        test.answer ?? "",
        statusLabel(test.status),
        test.reviewer_note ?? "",
        test.citations.map((citation) => citation.file_name ?? "").filter(Boolean).join("；"),
        test.citations.map(citationMeta).filter(Boolean).join("；"),
        test.citations.map((citation) => citation.quote ?? "").filter(Boolean).join(" | "),
        test.latency_ms ?? "",
        test.model ?? "",
        test.knowledge_base_ids.map((id) => kbById.get(id) ?? id).join("；"),
        new Date(test.updated_at).toLocaleString("zh-CN")
      ])
    ].map((row) => row.map(csvCell).join(",")).join("\n");

    return new NextResponse(`\uFEFF${csv}`, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="qa-tests-${status ?? "all"}.csv"`
      }
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "导出失败" },
      { status: 400 }
    );
  }
}

function citationMeta(citation: {
  page?: number;
  section?: string;
  sheet?: string;
  cell_range?: string;
  score?: number;
  score_reason?: string;
}) {
  const parts: string[] = [];

  if (citation.page) {
    parts.push(`第 ${citation.page} 页`);
  }

  if (citation.section) {
    parts.push(citation.section);
  }

  if (citation.sheet) {
    parts.push(`工作表：${citation.sheet}`);
  }

  if (citation.cell_range) {
    parts.push(`范围：${citation.cell_range}`);
  }

  if (citation.score !== undefined) {
    parts.push(`相关度：${citation.score}`);
  }

  if (citation.score_reason) {
    parts.push(citation.score_reason);
  }

  return parts.join(" · ");
}

function csvCell(value: unknown) {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, "\"\"")}"`;
}

function statusLabel(status: QaTestStatus) {
  if (status === "passed") {
    return "通过";
  }

  if (status === "failed") {
    return "不通过";
  }

  return "待评审";
}
