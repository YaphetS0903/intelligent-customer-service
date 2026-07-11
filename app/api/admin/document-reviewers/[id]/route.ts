import { NextResponse } from "next/server";
import {
  deleteDocumentReviewerAssignment,
  requireAdmin,
  updateDocumentReviewerAssignment
} from "@/lib/db";
import type { DocumentReviewerType, DocumentSecurityLevel } from "@/lib/types";

type RouteContext = { params: Promise<{ id: string }> };
const reviewerTypes = new Set<DocumentReviewerType>(["knowledge_base_manager", "department_head", "safety_reviewer", "quality_reviewer"]);
const securityLevels = new Set<DocumentSecurityLevel>(["public", "internal", "confidential", "restricted"]);
const stringList = (value: unknown) => Array.isArray(value)
  ? [...new Set(value.map((item) => String(item).trim()).filter(Boolean))]
  : [];

export async function PATCH(request: Request, { params }: RouteContext) {
  try {
    await requireAdmin();
    const { id } = await params;
    const body = await request.json();
    const reviewerType = body.reviewer_type === undefined ? undefined : String(body.reviewer_type) as DocumentReviewerType;
    if (reviewerType && !reviewerTypes.has(reviewerType)) {
      return NextResponse.json({ error: "审批角色无效" }, { status: 400 });
    }
    const assignment = await updateDocumentReviewerAssignment(id, {
      reviewer_type: reviewerType,
      knowledge_base_ids: body.knowledge_base_ids === undefined ? undefined : stringList(body.knowledge_base_ids),
      departments: body.departments === undefined ? undefined : stringList(body.departments),
      security_levels: body.security_levels === undefined
        ? undefined
        : stringList(body.security_levels).filter((level): level is DocumentSecurityLevel => securityLevels.has(level as DocumentSecurityLevel)),
      can_review: body.can_review === undefined ? undefined : Boolean(body.can_review),
      can_publish: body.can_publish === undefined ? undefined : Boolean(body.can_publish),
      active: body.active === undefined ? undefined : Boolean(body.active)
    });
    return NextResponse.json({ assignment });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "更新审批授权失败" }, { status: 400 });
  }
}

export async function DELETE(_request: Request, { params }: RouteContext) {
  try {
    await requireAdmin();
    const { id } = await params;
    await deleteDocumentReviewerAssignment(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "删除审批授权失败" }, { status: 400 });
  }
}
