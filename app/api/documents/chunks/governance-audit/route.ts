import { NextResponse } from "next/server";
import { listDocumentChunkGovernanceAuditSources, requireAdmin } from "@/lib/db";
import { normalizeChunkGovernanceAudits } from "@/lib/knowledge-governance-audit";

const maxAuditLimit = 120;

export async function GET(request: Request) {
  try {
    await requireAdmin();
    const url = new URL(request.url);
    const knowledgeBaseId = url.searchParams.get("knowledge_base_id")?.trim() ?? "";
    const limit = normalizeLimit(url.searchParams.get("limit"));
    const chunks = await listDocumentChunkGovernanceAuditSources({
      knowledgeBaseId: knowledgeBaseId || undefined,
      limit: limit * 4
    });

    const audits = chunks
      .flatMap((chunk) => {
        return normalizeChunkGovernanceAudits(chunk.metadata.governance_audit).map((audit) => ({
          ...audit,
          chunk_id: chunk.id,
          document_id: chunk.document_id,
          knowledge_base_id: chunk.knowledge_base_id,
          chunk_index: chunk.chunk_index,
          token_estimate: chunk.token_estimate,
          content_preview: chunk.content_preview,
          document_title: chunk.document_title,
          file_name: chunk.file_name,
          knowledge_base_name: chunk.knowledge_base_name
        }));
      })
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, limit);

    return NextResponse.json({ audits });
  } catch (error) {
    const message = error instanceof Error ? error.message : "读取知识治理审计失败";
    if (message.includes("登录") || message.includes("管理员")) {
      return NextResponse.json({ error: message }, { status: 403 });
    }

    console.error("[documents:governance-audit]", error);
    return NextResponse.json(
      {
        audits: [],
        warning: message
      },
      { status: 200 }
    );
  }
}

function normalizeLimit(value: string | null) {
  const numeric = Number(value ?? "");
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return 60;
  }

  return Math.min(maxAuditLimit, Math.round(numeric));
}
