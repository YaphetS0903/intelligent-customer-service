import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import type { DocumentRecord } from "@/lib/types";

type SupabaseAdminClient = ReturnType<typeof createSupabaseAdminClient>;

const localStoragePrefix = "local:";
const localDocumentRoot = ".data/documents";

export async function storeDocumentSourceFile(input: {
  file: File;
  knowledgeBaseId: string;
  supabase?: SupabaseAdminClient;
}) {
  const buffer = Buffer.from(await input.file.arrayBuffer());
  const supabase = input.supabase ?? createSupabaseAdminClient();
  const storageName = `${Date.now()}-${crypto.randomUUID()}-${sanitizeFileName(input.file.name)}`;

  if (supabase) {
    const storagePath = `documents/${input.knowledgeBaseId}/${storageName}`;
    const { error } = await supabase.storage
      .from("documents")
      .upload(storagePath, buffer, {
        contentType: input.file.type || "application/octet-stream",
        upsert: false
      });

    if (error) {
      throw new Error(error.message);
    }

    return { storagePath, buffer };
  }

  const relativePath = path.join(localDocumentRoot, input.knowledgeBaseId, storageName);
  const absolutePath = resolveLocalDocumentPath(relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, buffer);
  return { storagePath: `${localStoragePrefix}${relativePath}`, buffer };
}

export async function readDocumentSourceFile(document: DocumentRecord) {
  if (!document.storage_path) {
    throw new Error("当前资料没有保留原文件，无法重新识别。请重新上传原文件。");
  }

  if (document.storage_path.startsWith(localStoragePrefix)) {
    const relativePath = document.storage_path.slice(localStoragePrefix.length);
    const buffer = await readFile(resolveLocalDocumentPath(relativePath));
    return new File([buffer], document.file_name, {
      type: document.file_type || "application/octet-stream"
    });
  }

  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    throw new Error("当前资料存储在远端对象存储，但未配置 Supabase 管理密钥。");
  }

  const { data, error } = await supabase.storage.from("documents").download(document.storage_path);
  if (error || !data) {
    throw new Error(error?.message ?? "无法下载原文件");
  }

  return new File([await data.arrayBuffer()], document.file_name, {
    type: document.file_type || "application/octet-stream"
  });
}

export async function removeDocumentSourceFile(storagePath: string | null) {
  if (!storagePath) {
    return;
  }

  if (storagePath.startsWith(localStoragePrefix)) {
    const relativePath = storagePath.slice(localStoragePrefix.length);
    try {
      await unlink(resolveLocalDocumentPath(relativePath));
    } catch {
      // Database cleanup should not fail if the local source file was already removed.
    }
    return;
  }

  const supabase = createSupabaseAdminClient();
  if (supabase) {
    await supabase.storage.from("documents").remove([storagePath]);
  }
}

function resolveLocalDocumentPath(relativePath: string) {
  const root = path.resolve(process.cwd(), localDocumentRoot);
  const resolved = path.resolve(process.cwd(), relativePath);

  if (!resolved.startsWith(root + path.sep)) {
    throw new Error("非法的本地资料存储路径。");
  }

  return resolved;
}

function sanitizeFileName(fileName: string) {
  return fileName.replace(/[\\/:*?"<>|]+/g, "_").replace(/\s+/g, " ").trim() || "document";
}
