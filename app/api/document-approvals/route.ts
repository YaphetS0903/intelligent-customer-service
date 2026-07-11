import { NextResponse } from "next/server";
import {
  getCurrentUser,
  listDocumentApprovalEvents,
  listDocumentApprovalRequests,
  listDocumentVersions,
  listDocuments,
  listKnowledgeBases,
  listUsers
} from "@/lib/db";
import { canPublishDocument, canReviewDocument, runDocumentWorkflow, type DocumentWorkflowAction } from "@/lib/document-approval";

const allowedActions = new Set<DocumentWorkflowAction>([
  "submit_review",
  "withdraw_review",
  "approve_review",
  "reject_review",
  "publish",
  "archive",
  "restore_draft"
]);

export async function GET() {
  try {
    const user = await getCurrentUser();
    const [documents, requests, events, knowledgeBases, users, versions] = await Promise.all([
      listDocuments(),
      listDocumentApprovalRequests(),
      listDocumentApprovalEvents(),
      listKnowledgeBases(),
      listUsers(),
      listDocumentVersions()
    ]);
    const documentById = new Map(documents.map((document) => [document.id, document]));
    const capabilities = new Map<string, { can_review: boolean; can_publish: boolean }>();

    await Promise.all(documents.map(async (document) => {
      capabilities.set(document.id, {
        can_review: await canReviewDocument(user, document),
        can_publish: await canPublishDocument(user, document)
      });
    }));

    const visibleRequests = requests.filter((request) => {
      const capability = capabilities.get(request.document_id);
      return user.role === "admin" || request.submitted_by === user.id || capability?.can_review || capability?.can_publish;
    });
    const visibleDocumentIds = new Set(visibleRequests.map((request) => request.document_id));
    documents.forEach((document) => {
      if (capabilities.get(document.id)?.can_review || capabilities.get(document.id)?.can_publish || document.created_by === user.id) {
        visibleDocumentIds.add(document.id);
      }
    });

    return NextResponse.json({
      current_user: user,
      documents: documents.filter((document) => visibleDocumentIds.has(document.id)),
      requests: visibleRequests,
      events: events.filter((event) => visibleDocumentIds.has(event.document_id)),
      capabilities: Object.fromEntries(capabilities),
      knowledge_bases: knowledgeBases,
      users: users.map(({ id, name, email, department, position, role, security_clearance }) => ({
        id,
        name,
        email,
        department,
        position,
        role,
        security_clearance
      })),
      versions: versions.filter((version) => !version.document_id || visibleDocumentIds.has(version.document_id)),
      orphaned_request_count: visibleRequests.filter((request) => !documentById.has(request.document_id)).length
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "加载审批工作台失败" },
      { status: 400 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    const body = await request.json();
    const action = String(body.action ?? "") as DocumentWorkflowAction;
    const documentIds: string[] = Array.isArray(body.document_ids)
      ? [...new Set<string>(body.document_ids.map((id: unknown) => String(id).trim()).filter(Boolean))]
      : [];
    const versionIds = body.version_ids && typeof body.version_ids === "object"
      ? body.version_ids as Record<string, unknown>
      : {};

    if (!allowedActions.has(action)) {
      return NextResponse.json({ error: "不支持的审批操作" }, { status: 400 });
    }
    if (documentIds.length === 0) {
      return NextResponse.json({ error: "请选择至少一份资料" }, { status: 400 });
    }
    if (documentIds.length > 100) {
      return NextResponse.json({ error: "单次最多处理 100 份资料" }, { status: 400 });
    }

    const results = [];
    const errors = [];
    for (const documentId of documentIds) {
      try {
        results.push(await runDocumentWorkflow({
          documentId,
          action,
          actor: user,
          comment: String(body.comment ?? "").trim() || null,
          versionId: String(versionIds[documentId] ?? (documentIds.length === 1 ? body.version_id ?? "" : "")).trim() || null
        }));
      } catch (error) {
        errors.push({
          document_id: documentId,
          error: error instanceof Error ? error.message : "操作失败"
        });
      }
    }

    return NextResponse.json({
      ok: errors.length === 0,
      success_count: results.length,
      failure_count: errors.length,
      results,
      errors
    }, { status: results.length > 0 ? 200 : 400 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "批量审批失败" },
      { status: 400 }
    );
  }
}
