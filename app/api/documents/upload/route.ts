import { NextResponse } from "next/server";
import { env, isLocalTextRag } from "@/lib/config";
import { createDocument, createDocumentVersion, getKnowledgeBase, requireAdmin } from "@/lib/db";
import { isImageFile } from "@/lib/document-text";
import { startDocumentProcessingJob } from "@/lib/document-processing-job";
import { storeDocumentSourceFile } from "@/lib/document-storage";
import { mapVectorStoreFileStatus, uploadFileToVectorStore } from "@/lib/openai-rag";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

const allowedTypes = new Set([
  "application/pdf",
  "text/plain",
  "text/markdown",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel"
]);

export async function POST(request: Request) {
  try {
    const user = await requireAdmin();
    const formData = await request.formData();
    const files = formData.getAll("file").filter((item): item is File => item instanceof File);
    const knowledgeBaseId = String(formData.get("knowledge_base_id") ?? "");
    const department = String(formData.get("department") ?? "") || null;
    const changeNote = String(formData.get("change_note") ?? "").trim() || null;

    if (files.length === 0) {
      return NextResponse.json({ error: "请上传文件" }, { status: 400 });
    }

    if (!knowledgeBaseId) {
      return NextResponse.json({ error: "请选择知识库" }, { status: 400 });
    }

    for (const file of files) {
      if (file.size > env.maxUploadMb * 1024 * 1024) {
        return NextResponse.json({ error: `文件「${file.name}」不能超过 ${env.maxUploadMb}MB` }, { status: 400 });
      }

      if (!isSupportedUploadFile(file)) {
        return NextResponse.json({ error: `文件「${file.name}」暂不支持该文件类型` }, { status: 400 });
      }
    }

    const knowledgeBase = await getKnowledgeBase(knowledgeBaseId);
    if (!knowledgeBase) {
      return NextResponse.json({ error: "知识库不存在" }, { status: 404 });
    }

    if (!isLocalTextRag() && !knowledgeBase.openai_vector_store_id) {
      return NextResponse.json(
        { error: "请先为该知识库创建 OpenAI Vector Store" },
        { status: 400 }
      );
    }

    const results = [];

    for (const file of files) {
      results.push(await uploadOneFile({
        file,
        formData,
        knowledgeBaseId,
        vectorStoreId: knowledgeBase.openai_vector_store_id,
        department,
        changeNote,
        userId: user.id
      }));
    }

    const failed = results.filter((result) => result.status === "failed");
    return NextResponse.json(
      {
        results,
        documents: results.map((result) => result.document).filter(Boolean),
        document: results[0]?.document ?? null,
        chunks: results.reduce((total, result) => total + (result.chunks ?? 0), 0)
      },
      { status: failed.length > 0 && failed.length === results.length ? 400 : 200 }
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "上传失败" },
      { status: 400 }
    );
  }
}

function isSupportedUploadFile(file: File) {
  if (file.type && allowedTypes.has(file.type)) {
    return true;
  }

  const lowerName = file.name.toLowerCase();
  return (
    lowerName.endsWith(".txt") ||
    lowerName.endsWith(".md") ||
    lowerName.endsWith(".docx") ||
    lowerName.endsWith(".pptx") ||
    lowerName.endsWith(".pdf") ||
    lowerName.endsWith(".xlsx") ||
    lowerName.endsWith(".xls") ||
    (isLocalTextRag() && isImageFile(file, lowerName))
  );
}

async function uploadOneFile(input: {
  file: File;
  formData: FormData;
  knowledgeBaseId: string;
  vectorStoreId: string | null;
  department: string | null;
  changeNote: string | null;
  userId: string;
}) {
  const { file, formData, knowledgeBaseId, vectorStoreId, department, changeNote, userId } = input;
  const supabase = createSupabaseAdminClient();
  let stored: Awaited<ReturnType<typeof storeDocumentSourceFile>>;

  try {
    stored = await storeDocumentSourceFile({
      file,
      knowledgeBaseId,
      supabase
    });
  } catch (error) {
    return {
      file_name: file.name,
      status: "failed" as const,
      error: error instanceof Error ? error.message : "保存原文件失败"
    };
  }

  if (isLocalTextRag()) {
    const document = await createDocument({
      knowledge_base_id: knowledgeBaseId,
      title: String(formData.get("title") ?? "") || file.name,
      file_name: file.name,
      file_type: file.type || "application/octet-stream",
      storage_path: stored.storagePath,
      openai_file_id: null,
      status: "processing",
      department,
      tags: [],
      publish_status: "draft",
      created_by: userId
    });

    startDocumentProcessingJob({
      documentId: document.id,
      createdBy: userId,
      changeNote: changeNote ?? "上传并后台解析为可检索版本",
      reason: "upload"
    });

    return {
      file_name: file.name,
      status: "processing" as const,
      document,
      queued: true,
      chunks: 0
    };
  }

  if (!vectorStoreId) {
    return {
      file_name: file.name,
      status: "failed" as const,
      error: "请先为该知识库创建 OpenAI Vector Store"
    };
  }

  const uploaded = await uploadFileToVectorStore(file, vectorStoreId);

  if (!uploaded) {
    return {
      file_name: file.name,
      status: "failed" as const,
      error: "未配置 OPENAI_API_KEY，无法上传到知识库"
    };
  }

  const document = await createDocument({
    knowledge_base_id: knowledgeBaseId,
    title: String(formData.get("title") ?? "") || file.name,
    file_name: file.name,
    file_type: file.type || "application/octet-stream",
    storage_path: stored.storagePath,
    openai_file_id: uploaded.id,
    status: mapVectorStoreFileStatus(uploaded.status),
    department,
    tags: [],
    publish_status: "draft",
    created_by: userId
  });
  const version = await createDocumentVersion({
    document_id: document.id,
    knowledge_base_id: document.knowledge_base_id,
    title: document.title,
    file_name: document.file_name,
    file_type: document.file_type,
    status: document.status,
    change_note: changeNote ?? "上传到向量知识库",
    created_by: userId
  });

  return {
    file_name: file.name,
    status: document.status,
    document,
    version,
    chunks: 0
  };
}
