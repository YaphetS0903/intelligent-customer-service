import { NextResponse } from "next/server";
import JSZip from "jszip";
import { env, isLocalTextRag } from "@/lib/config";
import { createDocument, createDocumentVersion, getKnowledgeBase, requireAdmin } from "@/lib/db";
import { startDocumentProcessingJob } from "@/lib/document-processing-job";
import { storeDocumentSourceFile } from "@/lib/document-storage";
import { mapVectorStoreFileStatus, uploadFileToVectorStore } from "@/lib/openai-rag";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

const maxFilesPerUpload = 10;

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
    if (files.length > maxFilesPerUpload) {
      return NextResponse.json({ error: `单次最多上传 ${maxFilesPerUpload} 个文件` }, { status: 400 });
    }

    if (!knowledgeBaseId) {
      return NextResponse.json({ error: "请选择知识库" }, { status: 400 });
    }

    for (const file of files) {
      if (file.size > env.maxUploadMb * 1024 * 1024) {
        return NextResponse.json({ error: `文件「${file.name}」不能超过 ${env.maxUploadMb}MB` }, { status: 400 });
      }

      const validationError = await validateUploadFile(file);
      if (validationError) return NextResponse.json({ error: `文件「${file.name}」${validationError}` }, { status: 400 });
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

async function validateUploadFile(file: File) {
  const lowerName = file.name.toLowerCase();
  const extension = lowerName.slice(lowerName.lastIndexOf("."));
  if (extension === ".xls") return "是旧版 XLS，请另存为 XLSX 后重新上传";
  const supportedExtensions = new Set([".txt", ".md", ".docx", ".pptx", ".pdf", ".xlsx"]);
  if (isLocalTextRag()) [".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tif", ".tiff"].forEach((item) => supportedExtensions.add(item));
  if (!supportedExtensions.has(extension)) return "暂不支持该文件类型";

  const allowedMimeTypes: Record<string, string[]> = {
    ".txt": ["", "text/plain", "application/octet-stream"],
    ".md": ["", "text/markdown", "text/plain", "application/octet-stream"],
    ".docx": ["", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/octet-stream"],
    ".pptx": ["", "application/vnd.openxmlformats-officedocument.presentationml.presentation", "application/octet-stream"],
    ".xlsx": ["", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/octet-stream"],
    ".pdf": ["", "application/pdf", "application/octet-stream"]
  };
  if (extension in allowedMimeTypes && !allowedMimeTypes[extension].includes(file.type)) {
    return "的扩展名与 MIME 类型不一致";
  }

  const header = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  if ([".docx", ".pptx", ".xlsx"].includes(extension) && !hasBytes(header, [0x50, 0x4b])) {
    return "不是有效的 Office Open XML 文件";
  }
  if ([".docx", ".pptx", ".xlsx"].includes(extension)) {
    try {
      const zip = await JSZip.loadAsync(await file.arrayBuffer(), { checkCRC32: false });
      const requiredPath = ({ ".docx": "word/document.xml", ".pptx": "ppt/presentation.xml", ".xlsx": "xl/workbook.xml" })[extension];
      if (!requiredPath || !zip.file(requiredPath)) return "缺少必要的 Office 文档结构";
      if (Object.keys(zip.files).length > 5000) return "包含过多压缩条目";
    } catch {
      return "不是可解析的 Office Open XML 文件";
    }
  }
  if (extension === ".pdf" && !hasBytes(header, [0x25, 0x50, 0x44, 0x46])) return "不是有效的 PDF 文件";
  if (extension === ".png" && !hasBytes(header, [0x89, 0x50, 0x4e, 0x47])) return "不是有效的 PNG 图片";
  if ([".jpg", ".jpeg"].includes(extension) && !hasBytes(header, [0xff, 0xd8, 0xff])) return "不是有效的 JPEG 图片";
  if (extension === ".webp" && !(hasAscii(header, 0, "RIFF") && hasAscii(header, 8, "WEBP"))) return "不是有效的 WebP 图片";
  if (extension === ".bmp" && !hasAscii(header, 0, "BM")) return "不是有效的 BMP 图片";
  if ([".tif", ".tiff"].includes(extension) && !(hasAscii(header, 0, "II") || hasAscii(header, 0, "MM"))) return "不是有效的 TIFF 图片";
  return null;
}

function hasBytes(buffer: Uint8Array, expected: number[]) {
  return expected.every((value, index) => buffer[index] === value);
}

function hasAscii(buffer: Uint8Array, offset: number, expected: string) {
  return [...expected].every((value, index) => buffer[offset + index] === value.charCodeAt(0));
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
