"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, Loader2, Plus, Save, ShieldCheck, Trash2, X } from "lucide-react";
import { ActionConfirmDialog } from "@/components/ui-feedback";
import type { DocumentPermissionTemplate, DocumentSecurityLevel, UserProfile, UserRole } from "@/lib/types";

type TemplateDraft = {
  name: string;
  description: string;
  security_level: DocumentSecurityLevel;
  acl_departments: string[];
  acl_positions: string[];
  acl_roles: UserRole[];
  acl_users: string[];
};

const emptyDraft: TemplateDraft = {
  name: "",
  description: "",
  security_level: "internal",
  acl_departments: [],
  acl_positions: [],
  acl_roles: [],
  acl_users: []
};

export function DocumentPermissionTemplateManager({
  templates,
  users,
  departments,
  positions,
  onChanged
}: {
  templates: DocumentPermissionTemplate[];
  users: UserProfile[];
  departments: string[];
  positions: string[];
  onChanged: () => Promise<void> | void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<TemplateDraft>(emptyDraft);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DocumentPermissionTemplate | null>(null);
  const [error, setError] = useState("");

  async function createTemplate() {
    if (!draft.name.trim()) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/admin/document-permission-templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...draft, name: draft.name.trim(), description: draft.description.trim() || null })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "创建权限模板失败");
      setDraft(emptyDraft);
      await onChanged();
    } catch (error) {
      setError(error instanceof Error ? error.message : "创建权限模板失败");
    } finally {
      setSaving(false);
    }
  }

  async function deleteTemplate(id: string) {
    setDeletingId(id);
    setError("");
    try {
      const response = await fetch(`/api/admin/document-permission-templates/${id}`, { method: "DELETE" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "删除权限模板失败");
      await onChanged();
    } catch (error) {
      setError(error instanceof Error ? error.message : "删除权限模板失败");
    } finally {
      setDeletingId(null);
      setDeleteTarget(null);
    }
  }

  function updateList(key: "acl_departments" | "acl_positions" | "acl_users", select: HTMLSelectElement) {
    setDraft((current) => ({ ...current, [key]: Array.from(select.selectedOptions).map((option) => option.value) }));
  }

  return (
    <section className="mt-5 overflow-hidden rounded-lg border border-line bg-white">
      <button type="button" onClick={() => setOpen((current) => !current)} className="flex min-h-14 w-full items-center justify-between gap-4 px-4 text-left hover:bg-slate-50" aria-expanded={open}>
        <span className="flex min-w-0 items-center gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-blue-50 text-blue-700"><ShieldCheck size={18} /></span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-ink">文档权限模板</span>
            <span className="mt-1 block text-xs text-slate-500">保存常用部门、岗位、角色、员工和密级组合，上传资料时可以直接套用。</span>
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2 text-xs font-semibold text-slate-500">{templates.length} 个模板{open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</span>
      </button>

      {open && (
        <div className="border-t border-line p-4">
          <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-4">
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-slate-600">模板名称</span>
              <input value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} className="ui-input h-11 w-full" placeholder="例如：生产部内部资料" />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-slate-600">资料密级</span>
              <select value={draft.security_level} onChange={(event) => setDraft((current) => ({ ...current, security_level: event.target.value as DocumentSecurityLevel }))} className="ui-input h-11 w-full">
                <option value="public">公开</option><option value="internal">内部</option><option value="confidential">保密</option><option value="restricted">受限</option>
              </select>
            </label>
            <label className="block lg:col-span-2">
              <span className="mb-1.5 block text-xs font-medium text-slate-600">说明</span>
              <input value={draft.description} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} className="ui-input h-11 w-full" placeholder="说明模板适用场景" />
            </label>
            <TemplateMultiSelect label="可见部门" values={draft.acl_departments} options={departments} onChange={(select) => updateList("acl_departments", select)} />
            <TemplateMultiSelect label="可见岗位" values={draft.acl_positions} options={positions} onChange={(select) => updateList("acl_positions", select)} />
            <TemplateMultiSelect label="指定员工" values={draft.acl_users} options={users.map((user) => user.id)} optionLabels={Object.fromEntries(users.map((user) => [user.id, `${user.name} · ${user.department || "未分部门"}`]))} onChange={(select) => updateList("acl_users", select)} />
            <fieldset>
              <legend className="mb-1.5 text-xs font-medium text-slate-600">可见系统角色</legend>
              <div className="flex min-h-24 flex-col justify-center gap-2 rounded-lg border border-line px-3">
                {(["employee", "admin"] as UserRole[]).map((role) => (
                  <label key={role} className="flex min-h-9 cursor-pointer items-center gap-2 text-sm text-slate-700">
                    <input type="checkbox" checked={draft.acl_roles.includes(role)} onChange={() => setDraft((current) => ({ ...current, acl_roles: current.acl_roles.includes(role) ? current.acl_roles.filter((item) => item !== role) : [...current.acl_roles, role] }))} className="size-4 accent-blue-600" />
                    {role === "admin" ? "管理员" : "员工"}
                  </label>
                ))}
              </div>
            </fieldset>
          </div>
          {error && <p className="mt-3 flex items-center gap-2 text-sm text-red-700" role="alert"><X size={16} />{error}</p>}
          <div className="mt-4 flex justify-end">
            <button type="button" onClick={() => void createTemplate()} disabled={saving || !draft.name.trim()} className="ui-button-primary min-h-11">
              {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}保存模板
            </button>
          </div>

          <div className="mt-5 border-t border-line pt-4">
            {templates.length > 0 ? (
              <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
                {templates.map((template) => (
                  <article key={template.id} className="rounded-lg border border-line bg-slate-50 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div><h3 className="text-sm font-semibold text-ink">{template.name}</h3><p className="mt-1 text-xs text-slate-500">{template.description || "未填写说明"}</p></div>
                      <button type="button" onClick={() => setDeleteTarget(template)} disabled={deletingId === template.id} className="ui-button-danger min-h-11 px-3" aria-label={`删除模板 ${template.name}`}>
                        {deletingId === template.id ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
                      </button>
                    </div>
                    <p className="mt-3 text-xs leading-5 text-slate-600">{templateSummary(template)}</p>
                  </article>
                ))}
              </div>
            ) : (
              <div className="flex min-h-24 items-center justify-center rounded-lg border border-dashed border-line text-sm text-slate-500"><Plus size={16} className="mr-2" />还没有权限模板</div>
            )}
          </div>
        </div>
      )}
      <ActionConfirmDialog
        request={deleteTarget ? {
          title: "删除权限模板？",
          description: `确认删除模板「${deleteTarget.name}」吗？`,
          details: ["已经应用到资料的权限不会被修改。", "删除后不能再从资料权限配置中套用此模板。"],
          confirmLabel: "删除模板",
          tone: "danger"
        } : null}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => {
          const id = deleteTarget?.id;
          setDeleteTarget(null);
          if (id) void deleteTemplate(id);
        }}
      />
    </section>
  );
}

function TemplateMultiSelect({ label, values, options, optionLabels = {}, onChange }: { label: string; values: string[]; options: string[]; optionLabels?: Record<string, string>; onChange: (select: HTMLSelectElement) => void }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-slate-600">{label}</span>
      <select multiple value={values} onChange={(event) => onChange(event.currentTarget)} className="ui-input min-h-24 w-full px-2 py-2 text-sm">
        {options.map((option) => <option key={option} value={option}>{optionLabels[option] ?? option}</option>)}
      </select>
    </label>
  );
}

function templateSummary(template: DocumentPermissionTemplate) {
  const level = ({ public: "公开", internal: "内部", confidential: "保密", restricted: "受限" })[template.security_level];
  const scopes = [
    template.acl_departments.length ? `${template.acl_departments.length} 个部门` : "",
    template.acl_positions.length ? `${template.acl_positions.length} 个岗位` : "",
    template.acl_roles.length ? `${template.acl_roles.length} 个角色` : "",
    template.acl_users.length ? `${template.acl_users.length} 名员工` : ""
  ].filter(Boolean);
  return `密级：${level} · ${scopes.join("、") || "默认可见范围"}`;
}
