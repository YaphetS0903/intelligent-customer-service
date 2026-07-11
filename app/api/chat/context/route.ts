import { NextResponse } from "next/server";
import { canAccessDocument, getCurrentUser, listAccessibleKnowledgeBaseScopes, listDocuments } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await getCurrentUser();
    const documents = await listDocuments();
    const knowledgeBases = await listAccessibleKnowledgeBaseScopes(user, documents);

    return NextResponse.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        department: user.department,
        position: user.position,
        security_clearance: user.security_clearance
      },
      knowledgeBases,
      accessible_documents: documents
        .filter((document) => document.status === "ready" && canAccessDocument(user, document))
        .map((document) => ({
          id: document.id,
          knowledge_base_id: document.knowledge_base_id,
          title: document.title,
          security_level: document.security_level
        }))
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "读取对话上下文失败" },
      { status: 401 }
    );
  }
}
