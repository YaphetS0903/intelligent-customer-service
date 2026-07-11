import { isLocalTextRag } from "@/lib/config";
import {
  createDocument,
  createDocumentChunks,
  createDocumentVersion,
  getKnowledgeBase,
  listKnowledgeTasks,
  updateKnowledgeTask
} from "@/lib/db";
import { chunkExtractedText, type ExtractedText } from "@/lib/document-text";

export async function supplementKnowledgeTask(input: {
  taskId: string;
  knowledgeBaseId: string;
  title?: string | null;
  content: string;
  createdBy: string;
}) {
  if (!isLocalTextRag()) {
    throw new Error("快捷补充当前仅支持本地 RAG 知识库。向量库模式请通过资料上传同步到第三方知识库。");
  }

  const content = input.content.trim();
  if (content.length < 10) {
    throw new Error("补充知识内容过短，请填写可作为依据的完整说明。");
  }

  const [task, knowledgeBase] = await Promise.all([
    findKnowledgeTask(input.taskId),
    getKnowledgeBase(input.knowledgeBaseId)
  ]);

  if (!task) {
    throw new Error("整改任务不存在");
  }

  if (!knowledgeBase) {
    throw new Error("知识库不存在");
  }

  const title = normalizeTitle(input.title || task.question || "知识整改补充");
  const fileName = `${title}.md`;
  const markdown = buildSupplementMarkdown({
    title,
    taskId: task.id,
    question: task.question,
    previousAnswer: task.answer,
    content,
    note: task.note
  });

  const document = await createDocument({
    knowledge_base_id: knowledgeBase.id,
    title,
    file_name: fileName,
    file_type: "text/markdown",
    storage_path: null,
    openai_file_id: null,
    status: "ready",
    department: null,
    tags: ["整改补充"],
    created_by: input.createdBy
  });
  const extracted: ExtractedText = {
    title,
    content: markdown,
    sections: [
      {
        title,
        content: markdown,
        section: "知识整改补充",
        parser: "manual_supplement"
      }
    ]
  };
  const chunks = chunkExtractedText({
    documentId: document.id,
    knowledgeBaseId: knowledgeBase.id,
    fileName,
    title,
    extracted
  });

  const createdChunks = await createDocumentChunks(chunks);
  const version = await createDocumentVersion({
    document_id: document.id,
    knowledge_base_id: document.knowledge_base_id,
    title: document.title,
    file_name: document.file_name,
    file_type: document.file_type,
    status: document.status,
    change_note: `由整改任务 ${task.id} 快捷补充入库`,
    created_by: input.createdBy,
    snapshot_chunks: createdChunks
  });
  const updatedTask = await updateKnowledgeTask(task.id, {
    status: "processing",
    note: appendTaskNote(task.note, `已补充知识文档：${title}，请自动复测确认是否通过。`)
  });

  return {
    task: updatedTask,
    document,
    version,
    chunks: chunks.length
  };
}

async function findKnowledgeTask(taskId: string) {
  const tasks = await listKnowledgeTasks();
  return tasks.find((task) => task.id === taskId) ?? null;
}

function buildSupplementMarkdown(input: {
  title: string;
  taskId: string;
  question: string;
  previousAnswer: string;
  content: string;
  note: string | null;
}) {
  return [
    `# ${input.title}`,
    "",
    `来源整改任务：${input.taskId}`,
    "",
    "## 员工问题",
    input.question,
    "",
    "## 标准依据",
    input.content,
    "",
    "## 原回答",
    input.previousAnswer || "无",
    "",
    input.note ? `## 整改备注\n${input.note}` : ""
  ].filter(Boolean).join("\n");
}

function normalizeTitle(value: string) {
  const compact = value
    .replace(/[\\/:*?"<>|#]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 48);

  return compact ? `整改补充-${compact}` : `整改补充-${Date.now()}`;
}

function appendTaskNote(note: string | null, nextLine: string) {
  const current = note?.trim();
  const timestamp = new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
  const line = `[${timestamp}] ${nextLine}`;

  return current ? `${current}\n${line}` : line;
}
