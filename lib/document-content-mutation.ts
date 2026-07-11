import {
  createDocumentApprovalEvent,
  createDocumentVersion,
  updateDocument
} from "@/lib/db";
import type { DocumentChunk, DocumentRecord, UserProfile } from "@/lib/types";

export async function prepareDocumentContentMutation(input: {
  document: DocumentRecord;
  actor: UserProfile;
  reason: string;
}) {
  const { document, actor, reason } = input;

  assertDocumentContentMutationAllowed(document);

  if (document.publish_status !== "published" && document.publish_status !== "archived") {
    return document;
  }

  const updated = await updateDocument(document.id, {
    publish_status: "draft",
    approved_by: null,
    approved_at: null
  });
  await createDocumentApprovalEvent({
    request_id: null,
    document_id: document.id,
    action: "content_edit_started",
    actor_id: actor.id,
    actor_name: actor.name,
    actor_role: actor.role,
    comment: reason,
    from_status: document.publish_status,
    to_status: "draft",
    metadata: {
      published_version_id: document.published_version_id,
      published_version: document.published_version
    }
  });

  return updated;
}

export function assertDocumentContentMutationAllowed(document: DocumentRecord) {
  if (document.publish_status === "pending_review" || document.publish_status === "approved") {
    throw new Error("资料正在审核或已通过待发布，不能修改正文。请先撤回或驳回审批后再修改。");
  }
}

export async function createDocumentContentVersion(input: {
  document: DocumentRecord;
  chunks: Array<Pick<DocumentChunk, "chunk_index" | "content" | "token_estimate" | "metadata">>;
  actor: UserProfile;
  changeNote: string;
}) {
  return createDocumentVersion({
    document_id: input.document.id,
    knowledge_base_id: input.document.knowledge_base_id,
    title: input.document.title,
    file_name: input.document.file_name,
    file_type: input.document.file_type,
    status: input.document.status,
    change_note: input.changeNote,
    created_by: input.actor.id,
    snapshot_chunks: input.chunks
      .slice()
      .sort((a, b) => a.chunk_index - b.chunk_index)
  });
}
