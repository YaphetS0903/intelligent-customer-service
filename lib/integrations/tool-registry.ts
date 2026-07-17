import { getIntegrationTool, listIntegrationTools, upsertIntegrationTool } from "@/lib/integrations/tool-store";
import type { IntegrationTool } from "@/lib/integrations/types";

const builtInTools: Array<Omit<IntegrationTool, "created_at" | "updated_at">> = [
  {
    id: "winmail.unread_count",
    connector_id: "winmail",
    name: "查询本人未读邮件数量",
    description: "只读取当前登录员工已验证 Winmail 邮箱的收件箱未读数量。",
    status: "published",
    risk_level: "read",
    allowed_roles: ["admin", "employee"],
    data_scope: "self",
    input_schema: { type: "object", additionalProperties: false, properties: {} },
    timeout_ms: 12_000,
    metadata: { built_in: true, result_type: "winmail_unread" }
  },
  {
    id: "winmail.search_inbox",
    connector_id: "winmail",
    name: "查询本人邮件摘要",
    description: "按发件人、主题、时间和未读状态筛选当前登录员工的收件箱摘要，不读取附件和完整正文。",
    status: "published",
    risk_level: "read",
    allowed_roles: ["admin", "employee"],
    data_scope: "self",
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        sender: { type: "string", maxLength: 120 },
        subject: { type: "string", maxLength: 160 },
        date_from: { type: "string", format: "date-time" },
        date_to: { type: "string", format: "date-time" },
        unread_only: { type: "boolean" },
        limit: { type: "integer", minimum: 1, maximum: 20 }
      }
    },
    timeout_ms: 15_000,
    metadata: { built_in: true, result_type: "winmail_message_list", max_pages: 5, body_retained: false }
  }
];

let seededAt = 0;

export async function ensureBuiltInTools(force = false) {
  if (!force && Date.now() - seededAt < 60_000) return;
  for (const tool of builtInTools) await upsertIntegrationTool(tool);
  seededAt = Date.now();
}

export async function listRegisteredTools() {
  await ensureBuiltInTools();
  return listIntegrationTools();
}

export async function getRegisteredTool(id: string) {
  await ensureBuiltInTools();
  return getIntegrationTool(id);
}
