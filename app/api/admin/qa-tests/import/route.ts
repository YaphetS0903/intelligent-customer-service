import { NextResponse } from "next/server";
import { createQaTestCase, listKnowledgeBases, requireAdmin } from "@/lib/db";

export async function POST(request: Request) {
  try {
    const user = await requireAdmin();
    const body = await request.json();
    const content = String(body.content ?? "").trim();
    const fallbackKnowledgeBaseIds = Array.isArray(body.knowledge_base_ids)
      ? body.knowledge_base_ids.map((id: unknown) => String(id)).filter(Boolean)
      : [];

    if (!content) {
      return NextResponse.json({ error: "请粘贴要导入的测试问题" }, { status: 400 });
    }

    const knowledgeBases = await listKnowledgeBases();
    const rows = parseRows(content);
    const created = [];
    const skipped = [];

    for (const [index, row] of rows.entries()) {
      const question = row.question.trim();
      if (!question || question === "问题") {
        continue;
      }

      const knowledgeBaseIds = resolveKnowledgeBaseIds({
        value: row.knowledgeBase,
        knowledgeBases,
        fallbackKnowledgeBaseIds
      });

      if (knowledgeBaseIds.length === 0) {
        skipped.push({
          line: index + 1,
          question,
          reason: "未匹配到知识库"
        });
        continue;
      }

      created.push(await createQaTestCase({
        question,
        expected_answer: row.expectedAnswer.trim() || null,
        knowledge_base_ids: knowledgeBaseIds,
        created_by: user.id
      }));
    }

    return NextResponse.json({
      created,
      skipped,
      count: created.length
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "批量导入失败" },
      { status: 400 }
    );
  }
}

function parseRows(content: string) {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const cells = splitLine(line);
      return {
        question: cells[0] ?? "",
        expectedAnswer: cells[1] ?? "",
        knowledgeBase: cells[2] ?? ""
      };
    });
}

function splitLine(line: string) {
  const delimiter = line.includes("\t") ? "\t" : line.includes("|") ? "|" : line.includes("，") ? "，" : ",";
  return line
    .split(delimiter)
    .map((cell) => cell.trim().replace(/^"|"$/g, ""));
}

function resolveKnowledgeBaseIds(input: {
  value: string;
  knowledgeBases: Awaited<ReturnType<typeof listKnowledgeBases>>;
  fallbackKnowledgeBaseIds: string[];
}) {
  if (!input.value.trim()) {
    return input.fallbackKnowledgeBaseIds;
  }

  const names = input.value
    .split(/[;；、]/)
    .map((item) => item.trim())
    .filter(Boolean);
  const ids = new Set<string>();

  for (const name of names) {
    const matched = input.knowledgeBases.find((kb) => kb.id === name || kb.name === name);
    if (matched) {
      ids.add(matched.id);
    }
  }

  return [...ids];
}
