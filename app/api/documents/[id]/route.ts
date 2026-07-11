import { NextResponse } from "next/server";
import {
  createDocumentVersion,
  createDocumentApprovalEvent,
  deleteDocument,
  getCurrentUser,
  getDocument,
  getActiveDocumentApprovalRequest,
  getKnowledgeBase,
  listDocumentChunks,
  listDocumentVersionChunks,
  listDocumentVersions,
  requireAdmin,
  restoreDocumentVersionChunks,
  updateDocument
} from "@/lib/db";
import { runDocumentWorkflow, type DocumentWorkflowAction } from "@/lib/document-approval";
import { removeDocumentSourceFile } from "@/lib/document-storage";
import { deleteVectorStoreFile } from "@/lib/openai-rag";
import type { DocumentPublishStatus, DocumentSecurityLevel } from "@/lib/types";

type RouteContext = {
  params: Promise<{ id: string }>;
};

function normalizeList(value: unknown) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }

  if (typeof value === "string") {
    return value
      .split(/[,，\n]/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [];
}

function normalizeSecurityLevel(value: unknown): DocumentSecurityLevel {
  if (value === "public" || value === "confidential" || value === "restricted") {
    return value;
  }

  return "internal";
}

function normalizeWorkflowAction(value: unknown) {
  if (
    value === "submit_review" ||
    value === "withdraw_review" ||
    value === "approve_review" ||
    value === "reject_review" ||
    value === "publish" ||
    value === "archive" ||
    value === "restore_draft" ||
    value === "rollback_version"
  ) {
    return value;
  }

  if (value === "approve") return "approve_review";
  if (value === "return_draft") return "reject_review";

  return null;
}

export async function PATCH(request: Request, { params }: RouteContext) {
  try {
    const user = await getCurrentUser();
    const { id } = await params;
    const body = await request.json();
    const currentDocument = await getDocument(id);

    if (!currentDocument) {
      return NextResponse.json({ error: "文档不存在" }, { status: 404 });
    }

    const action = normalizeWorkflowAction(body.action);
    if (action && action !== "rollback_version") {
      const result = await runDocumentWorkflow({
        documentId: id,
        action: action as DocumentWorkflowAction,
        actor: user,
        comment: body.comment,
        versionId: String(body.version_id ?? "").trim() || null
      });
      return NextResponse.json(result);
    }

    if (action === "rollback_version") {
      if (user.role !== "admin") {
        return NextResponse.json({ error: "需要管理员权限" }, { status: 403 });
      }
      const versionId = String(body.version_id ?? "").trim();
      const reason = String(body.comment ?? "").trim();
      if (!reason) {
        return NextResponse.json({ error: "发布回退必须填写原因" }, { status: 400 });
      }
      if (currentDocument.publish_status !== "published" && currentDocument.publish_status !== "archived") {
        return NextResponse.json({ error: "只有已发布或已归档资料可以发起版本回退" }, { status: 400 });
      }
      const activeRequest = await getActiveDocumentApprovalRequest(currentDocument.id);
      if (activeRequest && (activeRequest.status === "pending" || activeRequest.status === "approved")) {
        return NextResponse.json({ error: "该资料已有进行中的审批，暂时不能发起版本回退" }, { status: 400 });
      }
      const version = (await listDocumentVersions()).find((item) => item.id === versionId);

      if (!version || version.document_id !== currentDocument.id) {
        return NextResponse.json({ error: "版本记录不存在或不属于当前资料" }, { status: 404 });
      }
      if (version.id === currentDocument.published_version_id) {
        return NextResponse.json({ error: "该版本已经是当前线上版本" }, { status: 400 });
      }
      if ((await listDocumentVersionChunks(version.id)).length === 0) {
        return NextResponse.json({ error: "该历史版本没有正文快照，无法发起发布回退" }, { status: 400 });
      }

      const document = await updateDocument(id, {
        title: version.title,
        file_name: version.file_name,
        file_type: version.file_type,
        status: version.status,
        publish_status: "draft",
        approved_by: null,
        approved_at: null
      });
      const restoredChunks = await restoreDocumentVersionChunks(version.id, document.id, document.knowledge_base_id);
      const currentChunks = (await listDocumentChunks(document.id))
        .sort((a, b) => a.chunk_index - b.chunk_index);
      const rollbackVersion = await createDocumentVersion({
        document_id: document.id,
        knowledge_base_id: document.knowledge_base_id,
        title: document.title,
        file_name: document.file_name,
        file_type: document.file_type,
        status: document.status,
        change_note: `发布回退候选：回退到 v${version.version}${version.change_note ? `：${version.change_note}` : ""}${restoredChunks ? `，恢复 ${restoredChunks} 个正文片段` : "，该历史版本无正文快照"}`,
        created_by: user.id,
        snapshot_chunks: currentChunks
      });
      await createDocumentApprovalEvent({
        request_id: null,
        document_id: document.id,
        action: "release_rollback_requested",
        actor_id: user.id,
        actor_name: user.name,
        actor_role: user.role,
        comment: reason,
        from_status: currentDocument.publish_status,
        to_status: document.publish_status,
        metadata: {
          restored_version_id: version.id,
          restored_version: version.version,
          rollback_candidate_version_id: rollbackVersion.id,
          previous_published_version_id: currentDocument.published_version_id,
          previous_published_version: currentDocument.published_version,
          restored_chunks: restoredChunks
        }
      });
      const workflow = await runDocumentWorkflow({
        documentId: document.id,
        action: "submit_review",
        actor: user,
        comment: `发布回退申请：${reason}`,
        versionId: rollbackVersion.id
      });

      return NextResponse.json({ ...workflow, version: rollbackVersion, restored_chunks: restoredChunks });
    }

    if (user.role !== "admin") {
      return NextResponse.json({ error: "需要管理员权限" }, { status: 403 });
    }

    const input = {
      security_level: body.security_level !== undefined
        ? normalizeSecurityLevel(body.security_level)
        : currentDocument.security_level,
      publish_status: currentDocument.publish_status,
      acl_departments: body.acl_departments !== undefined
        ? normalizeList(body.acl_departments)
        : currentDocument.acl_departments,
      acl_positions: body.acl_positions !== undefined
        ? normalizeList(body.acl_positions)
        : currentDocument.acl_positions,
      acl_roles: body.acl_roles !== undefined
        ? normalizeList(body.acl_roles).filter((role): role is "admin" | "employee" => role === "admin" || role === "employee")
        : currentDocument.acl_roles,
      acl_users: body.acl_users !== undefined ? normalizeList(body.acl_users) : currentDocument.acl_users,
      approved_by: currentDocument.approved_by,
      approved_at: currentDocument.approved_at
    } as Parameters<typeof updateDocument>[1];

    if (body.title !== undefined) {
      input.title = String(body.title).trim();
    }

    if (body.department !== undefined) {
      input.department = String(body.department ?? "").trim() || null;
    }

    if (body.tags !== undefined) {
      input.tags = normalizeList(body.tags);
    }

    const document = await updateDocument(id, input);

    const aclChanged =
      document.security_level !== currentDocument.security_level ||
      JSON.stringify(document.acl_departments) !== JSON.stringify(currentDocument.acl_departments) ||
      JSON.stringify(document.acl_positions) !== JSON.stringify(currentDocument.acl_positions) ||
      JSON.stringify(document.acl_roles) !== JSON.stringify(currentDocument.acl_roles) ||
      JSON.stringify(document.acl_users) !== JSON.stringify(currentDocument.acl_users);
    if (aclChanged) {
      await createDocumentApprovalEvent({
        request_id: null,
        document_id: document.id,
        action: "acl_updated",
        actor_id: user.id,
        actor_name: user.name,
        actor_role: user.role,
        comment: String(body.comment ?? "").trim() || null,
        from_status: currentDocument.publish_status,
        to_status: document.publish_status,
        metadata: {
          before: {
            security_level: currentDocument.security_level,
            acl_departments: currentDocument.acl_departments,
            acl_positions: currentDocument.acl_positions,
            acl_roles: currentDocument.acl_roles,
            acl_users: currentDocument.acl_users
          },
          after: {
            security_level: document.security_level,
            acl_departments: document.acl_departments,
            acl_positions: document.acl_positions,
            acl_roles: document.acl_roles,
            acl_users: document.acl_users
          }
        }
      });
    }

    return NextResponse.json({ document });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "保存资料权限失败" },
      { status: 400 }
    );
  }
}

export async function DELETE(_request: Request, { params }: RouteContext) {
  try {
    await requireAdmin();
    const { id } = await params;
    const document = await getDocument(id);

    if (!document) {
      return NextResponse.json({ error: "文档不存在" }, { status: 404 });
    }

    const knowledgeBase = await getKnowledgeBase(document.knowledge_base_id);

    if (knowledgeBase?.openai_vector_store_id && document.openai_file_id) {
      try {
        await deleteVectorStoreFile(knowledgeBase.openai_vector_store_id, document.openai_file_id);
      } catch {
        // Allow database cleanup even when the remote vector file was already removed.
      }
    }

    await removeDocumentSourceFile(document.storage_path);

    await deleteDocument(document.id);

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "删除失败" },
      { status: 400 }
    );
  }
}
