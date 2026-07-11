import { createDocumentVersion, listDocumentChunks, listDocumentVersions } from "@/lib/db";
import type { DocumentRecord, DocumentVersion } from "@/lib/types";

export async function ensureDocumentVersionBackfill(documents: DocumentRecord[]) {
  const versions = await listDocumentVersions();
  const documentIdsWithVersions = new Set(
    versions
      .map((version) => version.document_id)
      .filter((id): id is string => Boolean(id))
  );
  const documentsMissingVersions = documents.filter((document) => !documentIdsWithVersions.has(document.id));

  if (documentsMissingVersions.length === 0) {
    return versions;
  }

  const chunks = await listDocumentChunks();
  const created: DocumentVersion[] = [];

  for (const document of documentsMissingVersions) {
    const version = await createDocumentVersion({
      document_id: document.id,
      knowledge_base_id: document.knowledge_base_id,
      title: document.title,
      file_name: document.file_name,
      file_type: document.file_type,
      status: document.status,
      change_note: "历史资料补录为 v1",
      created_by: document.created_by,
      version: 1,
      snapshot_chunks: chunks
        .filter((chunk) => chunk.document_id === document.id)
        .sort((a, b) => a.chunk_index - b.chunk_index)
    });
    created.push(version);
    documentIdsWithVersions.add(document.id);
  }

  return [...created, ...versions].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
}
