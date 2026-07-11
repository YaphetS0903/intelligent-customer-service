import { NextResponse } from "next/server";
import {
  createDocumentReviewerAssignment,
  getUserProfile,
  listDocumentReviewerAssignments,
  requireAdmin
} from "@/lib/db";
import type { DocumentReviewerType, DocumentSecurityLevel } from "@/lib/types";

const reviewerTypes = new Set<DocumentReviewerType>([
  "knowledge_base_manager",
  "department_head",
  "safety_reviewer",
  "quality_reviewer"
]);
const securityLevels = new Set<DocumentSecurityLevel>(["public", "internal", "confidential", "restricted"]);

function stringList(value: unknown) {
  return Array.isArray(value) ? [...new Set(value.map((item) => String(item).trim()).filter(Boolean))] : [];
}

export async function GET() {
  try {
    await requireAdmin();
    return NextResponse.json({ assignments: await listDocumentReviewerAssignments() });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "加载审批授权失败" }, { status: 400 });
  }
}

export async function POST(request: Request) {
  try {
    const admin = await requireAdmin();
    const body = await request.json();
    const userId = String(body.user_id ?? "").trim();
    const reviewerType = String(body.reviewer_type ?? "") as DocumentReviewerType;
    if (!userId || !(await getUserProfile(userId))) {
      return NextResponse.json({ error: "请选择有效审批人" }, { status: 400 });
    }
    if (!reviewerTypes.has(reviewerType)) {
      return NextResponse.json({ error: "请选择有效审批角色" }, { status: 400 });
    }
    const assignment = await createDocumentReviewerAssignment({
      user_id: userId,
      reviewer_type: reviewerType,
      knowledge_base_ids: stringList(body.knowledge_base_ids),
      departments: stringList(body.departments),
      security_levels: stringList(body.security_levels).filter((level): level is DocumentSecurityLevel => securityLevels.has(level as DocumentSecurityLevel)),
      can_review: body.can_review !== false,
      can_publish: Boolean(body.can_publish),
      active: body.active !== false,
      created_by: admin.id
    });
    return NextResponse.json({ assignment });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "创建审批授权失败" }, { status: 400 });
  }
}
