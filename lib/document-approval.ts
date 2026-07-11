import {
  createDocumentApprovalEvent,
  createDocumentApprovalRequest,
  createSecurityEvent,
  getActiveDocumentApprovalRequest,
  getDocument,
  listDocumentReviewerAssignments,
  listDocumentVersions,
  listUsers,
  restoreDocumentVersionChunks,
  updateDocument,
  updateDocumentApprovalRequest
} from "@/lib/db";
import { notifyUsers } from "@/lib/notification-events";
import { buildAbnormalAccessEvent } from "@/lib/security-audit";
import type {
  DocumentApprovalAction,
  DocumentApprovalEvent,
  DocumentApprovalRequest,
  DocumentPublishStatus,
  DocumentRecord,
  DocumentReviewerAssignment,
  UserProfile
} from "@/lib/types";

export type DocumentWorkflowAction =
  | "submit_review"
  | "withdraw_review"
  | "approve_review"
  | "reject_review"
  | "publish"
  | "archive"
  | "restore_draft";

type WorkflowResult = {
  document: DocumentRecord;
  request: DocumentApprovalRequest | null;
  event: DocumentApprovalEvent;
};

export async function canReviewDocument(user: UserProfile, document: DocumentRecord) {
  if (user.role === "admin") return true;
  const assignments = await listDocumentReviewerAssignments(user.id);
  return assignments.some((assignment) => assignment.can_review && reviewerScopeMatches(assignment, document));
}

export async function canPublishDocument(user: UserProfile, document: DocumentRecord) {
  if (user.role === "admin") return true;
  const assignments = await listDocumentReviewerAssignments(user.id);
  return assignments.some((assignment) => assignment.can_publish && reviewerScopeMatches(assignment, document));
}

export function reviewerScopeMatches(assignment: DocumentReviewerAssignment, document: DocumentRecord) {
  if (!assignment.active) return false;
  if (assignment.knowledge_base_ids.length > 0 && !assignment.knowledge_base_ids.includes(document.knowledge_base_id)) {
    return false;
  }
  if (assignment.security_levels.length > 0 && !assignment.security_levels.includes(document.security_level)) {
    return false;
  }
  if (assignment.departments.length > 0) {
    const documentDepartments = new Set([document.department, ...document.acl_departments].filter(Boolean));
    if (!assignment.departments.some((department) => documentDepartments.has(department))) {
      return false;
    }
  }
  return true;
}

export async function runDocumentWorkflow(input: {
  documentId: string;
  action: DocumentWorkflowAction;
  actor: UserProfile;
  comment?: string | null;
  versionId?: string | null;
}): Promise<WorkflowResult> {
  const document = await getDocument(input.documentId);
  if (!document) throw new Error("文档不存在");

  const comment = input.comment?.trim() || null;
  const activeRequest = await getActiveDocumentApprovalRequest(document.id);

  let result: WorkflowResult;
  switch (input.action) {
    case "submit_review":
      result = await submitReview(document, input.actor, activeRequest, comment, input.versionId ?? null);
      break;
    case "withdraw_review":
      result = await withdrawReview(document, input.actor, activeRequest, comment);
      break;
    case "approve_review":
      result = await approveReview(document, input.actor, activeRequest, comment);
      break;
    case "reject_review":
      result = await rejectReview(document, input.actor, activeRequest, comment);
      break;
    case "publish":
      result = await publishDocument(document, input.actor, activeRequest, comment);
      break;
    case "archive":
      result = await archiveDocument(document, input.actor, activeRequest, comment);
      break;
    case "restore_draft":
      result = await restoreDraft(document, input.actor, activeRequest, comment);
      break;
  }

  await emitWorkflowNotifications(input.action, result, input.actor);
  return result;
}

async function submitReview(
  document: DocumentRecord,
  actor: UserProfile,
  activeRequest: DocumentApprovalRequest | null,
  comment: string | null,
  versionId: string | null
): Promise<WorkflowResult> {
  if (document.publish_status !== "draft" && document.publish_status !== "rejected") {
    throw new Error("只有草稿或已驳回资料可以提交审核");
  }
  if (document.status !== "ready") throw new Error("资料识别完成后才能提交审核");
  if (actor.role !== "admin" && document.created_by !== actor.id) {
    await denyWorkflow(actor, document, "submit_review", "只能提交自己创建的资料");
  }
  if (activeRequest && (activeRequest.status === "pending" || activeRequest.status === "approved")) {
    throw new Error("该资料已有进行中的审批申请");
  }

  const versions = await listDocumentVersions();
  const documentVersions = versions
    .filter((item) => item.document_id === document.id)
    .sort((a, b) => b.version - a.version);
  const selectedVersion = versionId
    ? documentVersions.find((item) => item.id === versionId) ?? null
    : documentVersions[0] ?? null;
  if (!selectedVersion) throw new Error("请选择有效的资料版本后再提交审核");
  if (selectedVersion.status !== "ready") throw new Error("只能提交处理完成的资料版本");
  const now = new Date().toISOString();
  const request = await createDocumentApprovalRequest({
    document_id: document.id,
    document_version_id: selectedVersion.id,
    status: "pending",
    submitted_by: actor.id,
    submitted_at: now,
    reviewed_by: null,
    reviewed_at: null,
    review_comment: null,
    published_by: null,
    published_at: null,
    withdrawn_by: null,
    withdrawn_at: null
  });
  const updated = await updateDocument(document.id, {
    publish_status: "pending_review",
    approved_by: null,
    approved_at: null
  });
  const event = await recordEvent({
    request,
    document,
    actor,
    action: "submitted",
    comment,
    toStatus: "pending_review",
    metadata: {
      document_version_id: selectedVersion.id,
      document_version: selectedVersion.version,
      acl_snapshot: permissionSnapshot(document)
    }
  });
  return { document: updated, request, event };
}

async function withdrawReview(
  document: DocumentRecord,
  actor: UserProfile,
  request: DocumentApprovalRequest | null,
  comment: string | null
): Promise<WorkflowResult> {
  if (document.publish_status !== "pending_review" || !request || request.status !== "pending") {
    throw new Error("当前资料没有可撤回的审批申请");
  }
  if (actor.role !== "admin" && request.submitted_by !== actor.id) {
    await denyWorkflow(actor, document, "withdraw_review", "只能撤回自己提交的审批");
  }
  const now = new Date().toISOString();
  const updatedRequest = await updateDocumentApprovalRequest(request.id, {
    status: "withdrawn",
    withdrawn_by: actor.id,
    withdrawn_at: now
  });
  const updated = await updateDocument(document.id, { publish_status: "draft", approved_by: null, approved_at: null });
  const event = await recordEvent({ request, document, actor, action: "withdrawn", comment, toStatus: "draft" });
  return { document: updated, request: updatedRequest, event };
}

async function approveReview(
  document: DocumentRecord,
  actor: UserProfile,
  request: DocumentApprovalRequest | null,
  comment: string | null
): Promise<WorkflowResult> {
  if (document.publish_status !== "pending_review" || !request || request.status !== "pending") {
    throw new Error("当前资料不在待审核状态");
  }
  if (!(await canReviewDocument(actor, document))) {
    await denyWorkflow(actor, document, "approve_review", "没有该资料的审核权限");
  }
  const now = new Date().toISOString();
  const updatedRequest = await updateDocumentApprovalRequest(request.id, {
    status: "approved",
    reviewed_by: actor.id,
    reviewed_at: now,
    review_comment: comment
  });
  const updated = await updateDocument(document.id, {
    publish_status: "approved",
    approved_by: actor.id,
    approved_at: now
  });
  const event = await recordEvent({
    request,
    document,
    actor,
    action: "approved",
    comment,
    toStatus: "approved",
    metadata: { document_version_id: request.document_version_id }
  });
  return { document: updated, request: updatedRequest, event };
}

async function rejectReview(
  document: DocumentRecord,
  actor: UserProfile,
  request: DocumentApprovalRequest | null,
  comment: string | null
): Promise<WorkflowResult> {
  if (document.publish_status !== "pending_review" || !request || request.status !== "pending") {
    throw new Error("当前资料不在待审核状态");
  }
  if (!comment) throw new Error("驳回时必须填写修改意见");
  if (!(await canReviewDocument(actor, document))) {
    await denyWorkflow(actor, document, "reject_review", "没有该资料的审核权限");
  }
  const now = new Date().toISOString();
  const updatedRequest = await updateDocumentApprovalRequest(request.id, {
    status: "rejected",
    reviewed_by: actor.id,
    reviewed_at: now,
    review_comment: comment
  });
  const updated = await updateDocument(document.id, {
    publish_status: "rejected",
    approved_by: null,
    approved_at: null
  });
  const event = await recordEvent({ request, document, actor, action: "rejected", comment, toStatus: "rejected" });
  return { document: updated, request: updatedRequest, event };
}

async function publishDocument(
  document: DocumentRecord,
  actor: UserProfile,
  request: DocumentApprovalRequest | null,
  comment: string | null
): Promise<WorkflowResult> {
  if (document.publish_status !== "approved" || !request || request.status !== "approved") {
    throw new Error("资料审核通过后才能发布");
  }
  if (!(await canPublishDocument(actor, document))) {
    await denyWorkflow(actor, document, "publish", "没有该资料的发布权限");
  }
  const version = (await listDocumentVersions()).find((item) => item.id === request.document_version_id);
  if (!version || version.document_id !== document.id) {
    throw new Error("审批关联版本不存在，无法发布");
  }
  if (version.status !== "ready") throw new Error("审批关联版本尚未处理完成");
  const restoredChunks = await restoreDocumentVersionChunks(version.id, document.id, document.knowledge_base_id);
  if (restoredChunks === 0) throw new Error("审批关联版本没有正文快照，无法正式发布");
  const now = new Date().toISOString();
  const updatedRequest = await updateDocumentApprovalRequest(request.id, {
    status: "published",
    published_by: actor.id,
    published_at: now
  });
  const updated = await updateDocument(document.id, {
    title: version.title,
    file_name: version.file_name,
    file_type: version.file_type,
    status: version.status,
    publish_status: "published",
    published_by: actor.id,
    published_at: now,
    published_version_id: version.id,
    published_version: version.version
  });
  const event = await recordEvent({
    request,
    document,
    actor,
    action: "published",
    comment,
    toStatus: "published",
    metadata: {
      published_version_id: version.id,
      published_version: version.version,
      previous_published_version_id: document.published_version_id,
      previous_published_version: document.published_version,
      restored_chunks: restoredChunks,
      release_kind: String(version.change_note ?? "").startsWith("发布回退候选") ? "rollback" : "release"
    }
  });
  return { document: updated, request: updatedRequest, event };
}

async function archiveDocument(
  document: DocumentRecord,
  actor: UserProfile,
  request: DocumentApprovalRequest | null,
  comment: string | null
): Promise<WorkflowResult> {
  if (document.publish_status !== "published") throw new Error("只有已发布资料可以归档");
  if (!(await canPublishDocument(actor, document))) {
    await denyWorkflow(actor, document, "archive", "没有该资料的归档权限");
  }
  const updatedRequest = request
    ? await updateDocumentApprovalRequest(request.id, { status: "archived" })
    : null;
  const updated = await updateDocument(document.id, { publish_status: "archived" });
  const event = await recordEvent({ request, document, actor, action: "archived", comment, toStatus: "archived" });
  return { document: updated, request: updatedRequest, event };
}

async function restoreDraft(
  document: DocumentRecord,
  actor: UserProfile,
  request: DocumentApprovalRequest | null,
  comment: string | null
): Promise<WorkflowResult> {
  if (document.publish_status !== "rejected" && document.publish_status !== "archived") {
    throw new Error("只有已驳回或已归档资料可以恢复为草稿");
  }
  if (actor.role !== "admin" && document.created_by !== actor.id) {
    await denyWorkflow(actor, document, "restore_draft", "没有恢复该资料的权限");
  }
  const updated = await updateDocument(document.id, { publish_status: "draft", approved_by: null, approved_at: null });
  const event = await recordEvent({ request, document, actor, action: "restored_to_draft", comment, toStatus: "draft" });
  return { document: updated, request, event };
}

async function recordEvent(input: {
  request: DocumentApprovalRequest | null;
  document: DocumentRecord;
  actor: UserProfile;
  action: DocumentApprovalAction;
  comment: string | null;
  toStatus: DocumentPublishStatus;
  metadata?: Record<string, unknown>;
}) {
  return createDocumentApprovalEvent({
    request_id: input.request?.id ?? null,
    document_id: input.document.id,
    action: input.action,
    actor_id: input.actor.id,
    actor_name: input.actor.name,
    actor_role: input.actor.role,
    comment: input.comment,
    from_status: input.document.publish_status,
    to_status: input.toStatus,
    metadata: input.metadata ?? {}
  });
}

function permissionSnapshot(document: DocumentRecord) {
  return {
    security_level: document.security_level,
    department: document.department,
    acl_departments: document.acl_departments,
    acl_positions: document.acl_positions,
    acl_roles: document.acl_roles,
    acl_users: document.acl_users
  };
}

async function denyWorkflow(
  actor: UserProfile,
  document: DocumentRecord,
  action: DocumentWorkflowAction,
  message: string
): Promise<never> {
  try {
    await createSecurityEvent(buildAbnormalAccessEvent({
      user: actor,
      title: "资料审批越权请求被拦截",
      detail: `${actor.name} 尝试对资料「${document.title}」执行 ${action}，系统已拦截。`,
      severity: "high",
      metadata: {
        detector: "document_approval_acl",
        document_id: document.id,
        knowledge_base_id: document.knowledge_base_id,
        document_department: document.department,
        document_security_level: document.security_level,
        attempted_action: action
      }
    }));
  } catch (error) {
    console.error("[document-approval:audit-deny]", error);
  }
  throw new Error(message);
}

async function emitWorkflowNotifications(
  action: DocumentWorkflowAction,
  result: WorkflowResult,
  actor: UserProfile
) {
  try {
    const [users, assignments] = await Promise.all([
      listUsers(),
      listDocumentReviewerAssignments()
    ]);
    const activeAdminIds = users
      .filter((user) => user.role === "admin" && user.status === "active")
      .map((user) => user.id);
    const reviewIds = assignments
      .filter((assignment) => assignment.can_review && reviewerScopeMatches(assignment, result.document))
      .map((assignment) => assignment.user_id);
    const publishIds = assignments
      .filter((assignment) => assignment.can_publish && reviewerScopeMatches(assignment, result.document))
      .map((assignment) => assignment.user_id);
    const submitterId = result.request?.submitted_by ?? result.document.created_by;
    const href = `/approvals?document=${encodeURIComponent(result.document.id)}`;
    const common = {
      category: "approval" as const,
      source_type: "document_approval",
      source_id: result.document.id,
      dedupe_key: `approval:${result.event.id}`,
      href,
      metadata: {
        document_id: result.document.id,
        request_id: result.request?.id ?? null,
        event_id: result.event.id,
        action,
        actor_id: actor.id
      }
    };

    if (action === "submit_review") {
      await notifyUsers([...activeAdminIds, ...reviewIds].filter((id) => id !== actor.id), {
        ...common,
        severity: "warning",
        title: "有新的资料等待审核",
        body: `${actor.name} 提交了「${result.document.title}」，请进入审批工作台处理。`
      });
      return;
    }
    if (action === "approve_review") {
      await notifyUsers([submitterId], {
        ...common,
        severity: "success",
        title: "资料审核已通过",
        body: `「${result.document.title}」已通过审核，正在等待正式发布。`
      });
      await notifyUsers([...activeAdminIds, ...publishIds].filter((id) => id !== actor.id), {
        ...common,
        dedupe_key: `approval-publish-ready:${result.event.id}`,
        severity: "warning",
        title: "有资料等待发布",
        body: `「${result.document.title}」已审核通过，请确认后正式发布。`
      });
      return;
    }
    if (action === "reject_review") {
      await notifyUsers([submitterId], {
        ...common,
        severity: "warning",
        title: "资料审核被驳回",
        body: `「${result.document.title}」需要修改：${result.event.comment ?? "请查看审批意见。"}`
      });
      return;
    }
    if (action === "publish") {
      await notifyUsers([submitterId], {
        ...common,
        severity: "success",
        title: "资料已正式发布",
        body: `「${result.document.title}」已发布，符合权限范围的员工现在可以检索。`
      });
      return;
    }
    if (action === "archive") {
      await notifyUsers([submitterId], {
        ...common,
        severity: "info",
        title: "资料已归档",
        body: `「${result.document.title}」已归档，不再进入员工问答检索。`
      });
      return;
    }
    if (action === "withdraw_review") {
      await notifyUsers([...activeAdminIds, ...reviewIds].filter((id) => id !== actor.id), {
        ...common,
        severity: "info",
        title: "资料审批已撤回",
        body: `${actor.name} 撤回了「${result.document.title}」的审批申请。`
      });
    }
  } catch (error) {
    console.warn("[document-approval:notification]", error);
  }
}
