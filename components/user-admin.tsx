"use client";

import { useEffect, useMemo, useState } from "react";
import { Building2, ChevronDown, Loader2, Plus, RefreshCw, Save, Search, ShieldCheck, Trash2, UserCheck, UserPlus, Users } from "lucide-react";
import type {
  DocumentReviewerAssignment,
  DocumentReviewerType,
  DocumentSecurityLevel,
  KnowledgeBase,
  UserProfile,
  UserRole
} from "@/lib/types";
import { ActionConfirmDialog, ErrorRetry, PanelSkeleton, useToast } from "@/components/ui-feedback";

type AdminUser = UserProfile & {
  admin_locked: boolean;
};

type DraftUser = Pick<AdminUser, "name" | "department" | "position" | "security_clearance" | "role" | "status"> & {
  password: string;
};
type NewUserDraft = {
  email: string;
  password: string;
  name: string;
  department: string;
  position: string;
  security_clearance: DocumentSecurityLevel;
  role: UserRole;
};

type ReviewerDraft = {
  user_id: string;
  reviewer_type: DocumentReviewerType;
  knowledge_base_ids: string[];
  departments: string[];
  security_levels: DocumentSecurityLevel[];
  can_review: boolean;
  can_publish: boolean;
};

type UserAdminView = "accounts" | "reviewers";
type AccountPanel = "organization" | "new-user" | null;

const INITIAL_VISIBLE_USERS = 10;

const emptyNewUser: NewUserDraft = {
  email: "",
  password: "",
  name: "",
  department: "",
  position: "",
  security_clearance: "internal",
  role: "employee"
};

const emptyReviewerDraft: ReviewerDraft = {
  user_id: "",
  reviewer_type: "knowledge_base_manager",
  knowledge_base_ids: [],
  departments: [],
  security_levels: [],
  can_review: true,
  can_publish: false
};

export function UserAdmin() {
  const { pushToast } = useToast();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [drafts, setDrafts] = useState<Record<string, DraftUser>>({});
  const [newUser, setNewUser] = useState<NewUserDraft>(emptyNewUser);
  const [reviewerAssignments, setReviewerAssignments] = useState<DocumentReviewerAssignment[]>([]);
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBase[]>([]);
  const [reviewerDraft, setReviewerDraft] = useState<ReviewerDraft>(emptyReviewerDraft);
  const [savingReviewer, setSavingReviewer] = useState(false);
  const [deletingReviewerId, setDeletingReviewerId] = useState<string | null>(null);
  const [reviewerDeleteTarget, setReviewerDeleteTarget] = useState<DocumentReviewerAssignment | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<UserAdminView>("accounts");
  const [accountPanel, setAccountPanel] = useState<AccountPanel>(null);
  const [reviewerFormOpen, setReviewerFormOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [visibleUsers, setVisibleUsers] = useState(INITIAL_VISIBLE_USERS);

  useEffect(() => {
    void loadUsers({ silent: true });
  }, []);

  const departments = useMemo(() => {
    return Array.from(new Set(users.map((user) => user.department).filter(Boolean))).sort();
  }, [users]);

  const positions = useMemo(() => {
    return Array.from(new Set(users.map((user) => user.position).filter(Boolean))).sort();
  }, [users]);

  const filteredUsers = useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase("zh-CN");
    if (!query) return users;

    return users.filter((user) => [user.name, user.email, user.department, user.position]
      .some((value) => value.toLocaleLowerCase("zh-CN").includes(query)));
  }, [searchQuery, users]);

  const displayedUsers = filteredUsers.slice(0, visibleUsers);

  useEffect(() => {
    setVisibleUsers(INITIAL_VISIBLE_USERS);
  }, [searchQuery, activeView]);

  async function loadUsers({ silent = false }: { silent?: boolean } = {}) {
    setLoading(true);
    setLoadError(null);

    try {
      const [response, reviewerResponse, kbResponse] = await Promise.all([
        fetch("/api/users", { cache: "no-store" }),
        fetch("/api/admin/document-reviewers", { cache: "no-store" }),
        fetch("/api/knowledge-bases", { cache: "no-store" })
      ]);
      const [data, reviewerData, kbData] = await Promise.all([
        response.json(),
        reviewerResponse.json(),
        kbResponse.json()
      ]);

      if (!response.ok) {
        throw new Error(data.error ?? "读取用户失败");
      }
      if (!reviewerResponse.ok) throw new Error(reviewerData.error ?? "读取审批授权失败");
      if (!kbResponse.ok) throw new Error(kbData.error ?? "读取知识库失败");

      const nextUsers = data.users ?? [];
      setUsers(nextUsers);
      setDrafts(
        Object.fromEntries(
          nextUsers.map((user: AdminUser) => [
            user.id,
            {
              name: user.name,
              department: user.department,
              position: user.position,
              security_clearance: user.security_clearance,
              role: user.role,
              status: user.status,
              password: ""
            }
          ])
        )
      );
      setReviewerAssignments(reviewerData.assignments ?? []);
      setKnowledgeBases(kbData.knowledgeBases ?? []);

      if (!silent) {
        pushToast({
          tone: "success",
          title: "用户列表已刷新",
          description: `当前共 ${nextUsers.length} 个账号。`
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "读取用户失败";
      setLoadError(message);
      if (!silent) {
        pushToast({
          tone: "error",
          title: "读取用户失败",
          description: message
        });
      }
    } finally {
      setLoading(false);
    }
  }

  function updateDraft(id: string, input: Partial<DraftUser>) {
    setDrafts((current) => ({
      ...current,
      [id]: {
        ...current[id],
        ...input
      }
    }));
  }

  async function saveUser(user: AdminUser) {
    const draft = drafts[user.id];
    if (!draft) {
      return;
    }

    setSavingId(user.id);

    try {
      const response = await fetch(`/api/users/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft)
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "保存失败");
      }

      await loadUsers({ silent: true });
      pushToast({
        tone: "success",
        title: "用户信息已保存",
        description: draft.password ? "新密码已生效。" : "部门和权限会在下一次对话检索时生效。"
      });
    } catch (error) {
      pushToast({
        tone: "error",
        title: "保存用户失败",
        description: error instanceof Error ? error.message : "请检查用户信息后重试。"
      });
    } finally {
      setSavingId(null);
    }
  }

  async function createNewUser() {
    setCreating(true);

    try {
      const response = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newUser)
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "创建用户失败");
      }

      setNewUser(emptyNewUser);
      setAccountPanel(null);
      await loadUsers({ silent: true });
      pushToast({
        tone: "success",
        title: "用户已创建",
        description: "员工可以使用初始密码登录。"
      });
    } catch (error) {
      pushToast({
        tone: "error",
        title: "创建用户失败",
        description: error instanceof Error ? error.message : "请检查邮箱、姓名和初始密码。"
      });
    } finally {
      setCreating(false);
    }
  }

  async function createReviewerAssignment() {
    setSavingReviewer(true);
    try {
      const response = await fetch("/api/admin/document-reviewers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(reviewerDraft)
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "创建审批授权失败");
      setReviewerDraft(emptyReviewerDraft);
      setReviewerFormOpen(false);
      await loadUsers({ silent: true });
      pushToast({ tone: "success", title: "审批授权已创建", description: "该用户可以在指定范围内处理资料审批。" });
    } catch (error) {
      pushToast({ tone: "error", title: "创建审批授权失败", description: error instanceof Error ? error.message : "请检查授权范围。" });
    } finally {
      setSavingReviewer(false);
    }
  }

  async function deleteReviewerAssignment(id: string) {
    setDeletingReviewerId(id);
    try {
      const response = await fetch(`/api/admin/document-reviewers/${id}`, { method: "DELETE" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "删除审批授权失败");
      await loadUsers({ silent: true });
      pushToast({ tone: "success", title: "审批授权已删除" });
    } catch (error) {
      pushToast({ tone: "error", title: "删除审批授权失败", description: error instanceof Error ? error.message : "请稍后重试。" });
    } finally {
      setDeletingReviewerId(null);
      setReviewerDeleteTarget(null);
    }
  }

  return (
    <div className="space-y-3 pb-6">
      <header className="flex flex-col gap-3 border-b border-line pb-3 sm:flex-row sm:items-center sm:justify-between" data-testid="users-header">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-cyan/10 text-brand">
            <Users size={18} />
          </span>
          <div className="min-w-0">
            <h1 className="text-xl font-semibold text-ink">用户管理</h1>
            <p className="truncate text-sm text-slate-500">账号、组织、密级与资料审批权限</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void loadUsers()}
          disabled={loading}
          className="ui-button-secondary h-9 self-start px-3 sm:self-auto"
        >
          {loading ? <Loader2 className="animate-spin" size={16} /> : <RefreshCw size={16} />}
          刷新
        </button>
      </header>

      {loadError && (
        <ErrorRetry
          title="用户列表加载失败"
          message={loadError}
          retrying={loading}
          onRetry={() => void loadUsers()}
        />
      )}

      <section className="ui-card grid grid-cols-2 gap-1 p-1.5" role="tablist" aria-label="用户与权限视图">
        <UserViewButton active={activeView === "accounts"} onClick={() => setActiveView("accounts")}>
          账号管理 · {users.length}
        </UserViewButton>
        <UserViewButton active={activeView === "reviewers"} onClick={() => setActiveView("reviewers")}>
          审批授权 · {reviewerAssignments.length}
        </UserViewButton>
      </section>

      {activeView === "accounts" && (
        <section className="ui-card flex flex-col gap-3 p-3 lg:flex-row lg:items-center" data-testid="account-toolbar">
          <label className="relative min-w-0 flex-1">
            <span className="sr-only">搜索用户</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
            <input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="搜索姓名、邮箱、部门或岗位"
              className="h-10 w-full rounded-lg border border-line bg-white pl-9 pr-3 text-sm outline-none focus:border-brand"
            />
          </label>
          <span className="shrink-0 text-xs text-slate-500">显示 {Math.min(visibleUsers, filteredUsers.length)} / {filteredUsers.length}</span>
          <div className="grid grid-cols-2 gap-2 sm:flex">
            <button
              type="button"
              onClick={() => setAccountPanel((current) => current === "organization" ? null : "organization")}
              className={`ui-button-secondary h-10 px-3 ${accountPanel === "organization" ? "border-cyan text-brand" : ""}`}
            >
              <Building2 size={16} />
              组织字典
            </button>
            <button
              type="button"
              onClick={() => setAccountPanel((current) => current === "new-user" ? null : "new-user")}
              className="ui-button-primary h-10 px-3"
            >
              <UserPlus size={16} />
              新增用户
            </button>
          </div>
        </section>
      )}

      {activeView === "accounts" && accountPanel === "organization" && (
        <section className="ui-card p-4" data-testid="organization-directory">
          <div className="space-y-3 text-sm text-slate-600">
            <TagGroup label={`部门 · ${departments.length}`} items={departments} tone="cyan" />
            <TagGroup label={`岗位 · ${positions.length}`} items={positions} tone="emerald" />
            {departments.length === 0 && positions.length === 0 && <p>还没有部门或岗位数据。</p>}
          </div>
        </section>
      )}

      {activeView === "reviewers" && (
      <section className="ui-card p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-emerald-50 text-emerald-700"><UserCheck size={20} /></span>
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-ink">资料审批人授权</h2>
            <p className="truncate text-sm text-slate-500">按知识库、部门和资料密级限定审批范围</p>
          </div>
        </div>
          <button
            type="button"
            onClick={() => setReviewerFormOpen((current) => !current)}
            className="ui-button-primary h-10 self-start px-3 sm:self-auto"
          >
            <Plus size={16} />
            新增审批授权
          </button>
        </div>

        {reviewerFormOpen && (
        <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-slate-600">审批人</span>
            <select value={reviewerDraft.user_id} onChange={(event) => setReviewerDraft((current) => ({ ...current, user_id: event.target.value }))} className="ui-input h-11 w-full px-3">
              <option value="">选择员工</option>
              {users.filter((user) => user.status === "active").map((user) => <option key={user.id} value={user.id}>{user.name} · {user.department || "未分部门"}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-slate-600">审批角色</span>
            <select value={reviewerDraft.reviewer_type} onChange={(event) => setReviewerDraft((current) => ({ ...current, reviewer_type: event.target.value as DocumentReviewerType }))} className="ui-input h-11 w-full px-3">
              <option value="knowledge_base_manager">知识库管理员</option>
              <option value="department_head">部门负责人</option>
              <option value="safety_reviewer">安全审核员</option>
              <option value="quality_reviewer">质量审核员</option>
            </select>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-slate-600">知识库范围</span>
            <select multiple value={reviewerDraft.knowledge_base_ids} onChange={(event) => setReviewerDraft((current) => ({ ...current, knowledge_base_ids: selectedOptions(event.currentTarget) }))} className="ui-input min-h-24 w-full px-2 py-2 text-sm">
              {knowledgeBases.map((kb) => <option key={kb.id} value={kb.id}>{kb.name}</option>)}
            </select>
            <span className="mt-1 block text-xs text-slate-500">不选表示全部知识库</span>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-slate-600">部门范围</span>
            <select multiple value={reviewerDraft.departments} onChange={(event) => setReviewerDraft((current) => ({ ...current, departments: selectedOptions(event.currentTarget) }))} className="ui-input min-h-24 w-full px-2 py-2 text-sm">
              {departments.map((department) => <option key={department} value={department}>{department}</option>)}
            </select>
            <span className="mt-1 block text-xs text-slate-500">不选表示不限部门</span>
          </label>
          <fieldset className="md:col-span-2">
            <legend className="mb-1.5 text-xs font-medium text-slate-600">可审核资料密级</legend>
            <div className="grid grid-cols-2 gap-2 rounded-lg border border-line p-2 sm:grid-cols-4">
              {(["public", "internal", "confidential", "restricted"] as DocumentSecurityLevel[]).map((level) => (
                <label key={level} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md px-2 text-sm hover:bg-slate-50">
                  <input type="checkbox" checked={reviewerDraft.security_levels.includes(level)} onChange={() => setReviewerDraft((current) => ({ ...current, security_levels: current.security_levels.includes(level) ? current.security_levels.filter((item) => item !== level) : [...current.security_levels, level] }))} className="size-4 accent-blue-600" />
                  {securityClearanceLabel(level)}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="flex flex-wrap items-center gap-4 md:col-span-2">
            <label className="flex min-h-11 items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={reviewerDraft.can_review} onChange={(event) => setReviewerDraft((current) => ({ ...current, can_review: event.target.checked }))} className="size-4 accent-blue-600" />允许审核</label>
            <label className="flex min-h-11 items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={reviewerDraft.can_publish} onChange={(event) => setReviewerDraft((current) => ({ ...current, can_publish: event.target.checked }))} className="size-4 accent-blue-600" />允许正式发布</label>
            <button type="button" onClick={() => void createReviewerAssignment()} disabled={savingReviewer || !reviewerDraft.user_id || (!reviewerDraft.can_review && !reviewerDraft.can_publish)} className="ui-button-primary min-h-11 md:ml-auto">
              {savingReviewer ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}添加授权
            </button>
          </div>
        </div>
        )}

        <div className="mt-5 border-t border-line pt-4">
          <h3 className="text-sm font-semibold text-ink">现有审批授权</h3>
          {reviewerAssignments.length > 0 ? (
            <div className="mt-3 grid gap-3 xl:grid-cols-2">
              {reviewerAssignments.map((assignment) => {
                const user = users.find((item) => item.id === assignment.user_id);
                return (
                  <article key={assignment.id} className="rounded-lg border border-line bg-slate-50 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold text-ink">{user?.name ?? assignment.user_id}</p>
                        <p className="mt-1 text-sm text-slate-600">{reviewerTypeLabel(assignment.reviewer_type)} · {assignment.can_review ? "可审核" : "不可审核"} · {assignment.can_publish ? "可发布" : "不可发布"}</p>
                      </div>
                      <button type="button" onClick={() => setReviewerDeleteTarget(assignment)} disabled={deletingReviewerId === assignment.id} className="ui-button-danger min-h-11 px-3" aria-label={`删除 ${user?.name ?? "审批人"} 的授权`}>
                        {deletingReviewerId === assignment.id ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
                      </button>
                    </div>
                    <p className="mt-3 text-xs leading-5 text-slate-500">
                      知识库：{assignment.knowledge_base_ids.map((id) => knowledgeBases.find((kb) => kb.id === id)?.name ?? id).join("、") || "全部"}<br />
                      部门：{assignment.departments.join("、") || "不限"} · 密级：{assignment.security_levels.map(securityClearanceLabel).join("、") || "不限"}
                    </p>
                  </article>
                );
              })}
            </div>
          ) : <p className="mt-3 rounded-lg border border-dashed border-line px-4 py-6 text-center text-sm text-slate-500">还没有配置审批人，当前仅系统管理员可以处理审批。</p>}
        </div>
      </section>
      )}

      {activeView === "accounts" && accountPanel === "new-user" && (
      <section className="ui-card p-4" data-testid="new-user-panel">
        <div className="flex items-center gap-2">
          <Plus size={18} className="text-brand" />
          <h2 className="text-base font-semibold text-ink">新增用户</h2>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-8">
          <LabeledInput
            label="邮箱"
            value={newUser.email}
            onChange={(value) => setNewUser((current) => ({ ...current, email: value }))}
            type="email"
            placeholder="name@company.com"
            className="xl:col-span-2"
          />
          <LabeledInput
            label="姓名"
            value={newUser.name}
            onChange={(value) => setNewUser((current) => ({ ...current, name: value }))}
            placeholder="员工姓名"
          />
          <LabeledInput
            label="部门"
            value={newUser.department}
            onChange={(value) => setNewUser((current) => ({ ...current, department: value }))}
            list="department-suggestions"
            placeholder="例如：人力资源部"
          />
          <LabeledInput
            label="岗位"
            value={newUser.position}
            onChange={(value) => setNewUser((current) => ({ ...current, position: value }))}
            list="position-suggestions"
            placeholder="例如：质量工程师"
          />
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-slate-600">安全密级</span>
            <SecurityClearanceSelect
              value={newUser.security_clearance}
              onChange={(security_clearance) => setNewUser((current) => ({ ...current, security_clearance }))}
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-slate-600">角色</span>
            <select
              value={newUser.role}
              onChange={(event) => setNewUser((current) => ({ ...current, role: event.target.value as UserRole }))}
              className="h-11 w-full rounded-lg border border-line px-3 text-sm outline-none focus:border-brand"
            >
              <option value="employee">员工</option>
              <option value="admin">管理员</option>
            </select>
          </label>
          <LabeledInput
            label="初始密码"
            value={newUser.password}
            onChange={(value) => setNewUser((current) => ({ ...current, password: value }))}
            type="password"
            placeholder="初始密码"
          />
          <button
            type="button"
            onClick={() => void createNewUser()}
            disabled={creating || !newUser.email || !newUser.name || !newUser.password}
            className="ui-button-primary h-11 px-3 md:self-end xl:col-span-1"
          >
            {creating ? <Loader2 className="animate-spin" size={15} /> : <Plus size={15} />}
            创建
          </button>
        </div>
      </section>
      )}

      {activeView === "accounts" && (loading && users.length === 0 ? (
        <section className="grid gap-3 xl:grid-cols-2">
          <PanelSkeleton rows={3} />
          <PanelSkeleton rows={3} />
        </section>
      ) : (
        <>
          <section className="grid gap-3 xl:hidden">
            {displayedUsers.map((user) => (
              <UserMobileCard
                key={user.id}
                user={user}
                draft={drafts[user.id] ?? createDraftFromUser(user)}
                saving={savingId === user.id}
                onChange={(input) => updateDraft(user.id, input)}
                onSave={() => void saveUser(user)}
              />
            ))}
            {filteredUsers.length === 0 && <EmptyUsers searchQuery={searchQuery} />}
          </section>

          <section className="hidden overflow-hidden ui-card xl:block">
            <div className="overflow-x-auto">
              <table className="min-w-[1180px] w-full divide-y divide-line text-sm">
                <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-3">员工</th>
                    <th className="px-4 py-3">姓名</th>
                    <th className="px-4 py-3">部门</th>
                    <th className="px-4 py-3">岗位</th>
                    <th className="px-4 py-3">安全密级</th>
                    <th className="px-4 py-3">角色</th>
                    <th className="px-4 py-3">状态</th>
                    <th className="px-4 py-3">重置密码</th>
                    <th className="px-4 py-3">加入时间</th>
                    <th className="px-4 py-3">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {displayedUsers.map((user) => {
                    const draft = drafts[user.id] ?? createDraftFromUser(user);

                    return (
                      <tr key={user.id} className="align-top">
                        <td className="px-4 py-3">
                          <p className="font-medium text-ink">{user.email}</p>
                          {user.admin_locked && <AdminLockedPill />}
                        </td>
                        <td className="px-4 py-3">
                          <input
                            value={draft.name}
                            onChange={(event) => updateDraft(user.id, { name: event.target.value })}
                            className="h-10 w-40 rounded-lg border border-line px-3 text-sm outline-none focus:border-brand"
                          />
                        </td>
                        <td className="px-4 py-3">
                          <input
                            value={draft.department}
                            onChange={(event) => updateDraft(user.id, { department: event.target.value })}
                            list="department-suggestions"
                            placeholder="例如：人力资源部"
                            className="h-10 w-44 rounded-lg border border-line px-3 text-sm outline-none focus:border-brand"
                          />
                        </td>
                        <td className="px-4 py-3">
                          <input
                            value={draft.position}
                            onChange={(event) => updateDraft(user.id, { position: event.target.value })}
                            list="position-suggestions"
                            placeholder="例如：质量工程师"
                            className="h-10 w-44 rounded-lg border border-line px-3 text-sm outline-none focus:border-brand"
                          />
                        </td>
                        <td className="px-4 py-3">
                          <SecurityClearanceSelect
                            value={draft.security_clearance}
                            onChange={(security_clearance) => updateDraft(user.id, { security_clearance })}
                            className="w-32"
                          />
                        </td>
                        <td className="px-4 py-3">
                          <RoleSelect
                            value={draft.role}
                            disabled={user.admin_locked}
                            onChange={(role) => updateDraft(user.id, { role })}
                            className="w-32"
                          />
                        </td>
                        <td className="px-4 py-3">
                          <StatusSelect
                            value={draft.status}
                            disabled={user.admin_locked}
                            onChange={(status) => updateDraft(user.id, { status })}
                            className="w-28"
                          />
                        </td>
                        <td className="px-4 py-3">
                          <input
                            value={draft.password}
                            onChange={(event) => updateDraft(user.id, { password: event.target.value })}
                            type="password"
                            placeholder="留空不修改"
                            className="h-10 w-36 rounded-lg border border-line px-3 text-sm outline-none focus:border-brand"
                          />
                        </td>
                        <td className="px-4 py-3 text-xs leading-5 text-slate-500">
                          {new Date(user.created_at).toLocaleString("zh-CN")}
                        </td>
                        <td className="px-4 py-3">
                          <SaveButton saving={savingId === user.id} onClick={() => void saveUser(user)} />
                        </td>
                      </tr>
                    );
                  })}
                  {filteredUsers.length === 0 && (
                    <tr>
                      <td colSpan={10} className="px-4 py-8 text-center text-sm text-slate-500">
                        {searchQuery ? "没有匹配的用户。" : "暂无用户。员工首次登录或注册后会自动出现在这里。"}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
          <UserListPager total={filteredUsers.length} visible={visibleUsers} onChange={setVisibleUsers} />
        </>
      ))}

      <datalist id="department-suggestions">
        {departments.map((department) => (
          <option key={department} value={department} />
        ))}
      </datalist>
      <datalist id="position-suggestions">
        {positions.map((position) => (
          <option key={position} value={position} />
        ))}
      </datalist>
      <ActionConfirmDialog
        request={reviewerDeleteTarget ? {
          title: "删除审批授权？",
          description: "删除后，该用户会立即失去这条授权范围内的审核和发布权限。",
          details: ["不会删除员工账号。", "已经完成的审批记录会继续保留。"],
          confirmLabel: "删除授权",
          tone: "danger"
        } : null}
        onCancel={() => setReviewerDeleteTarget(null)}
        onConfirm={() => {
          const id = reviewerDeleteTarget?.id;
          setReviewerDeleteTarget(null);
          if (id) void deleteReviewerAssignment(id);
        }}
      />
    </div>
  );
}

function createDraftFromUser(user: AdminUser): DraftUser {
  return {
    name: user.name,
    department: user.department,
    position: user.position,
    security_clearance: user.security_clearance,
    role: user.role,
    status: user.status,
    password: ""
  };
}

function selectedOptions(select: HTMLSelectElement) {
  return Array.from(select.selectedOptions).map((option) => option.value);
}

function securityClearanceLabel(level: DocumentSecurityLevel) {
  return ({ public: "公开", internal: "内部", confidential: "保密", restricted: "受限" })[level];
}

function reviewerTypeLabel(type: DocumentReviewerType) {
  return ({
    knowledge_base_manager: "知识库管理员",
    department_head: "部门负责人",
    safety_reviewer: "安全审核员",
    quality_reviewer: "质量审核员"
  })[type];
}

function TagGroup({ label, items, tone }: { label: string; items: string[]; tone: "cyan" | "emerald" }) {
  if (items.length === 0) {
    return null;
  }

  const tagClass = tone === "cyan"
    ? "bg-slate-100 text-slate-600"
    : "bg-emerald-50 text-emerald-700";

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="font-medium text-ink">{label}</span>
      {items.map((item) => (
        <span key={item} className={`rounded-full px-2.5 py-1 text-xs ${tagClass}`}>
          {item}
        </span>
      ))}
    </div>
  );
}

function LabeledInput({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  list,
  className = ""
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
  list?: string;
  className?: string;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1.5 block text-xs font-medium text-slate-600">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        type={type}
        list={list}
        placeholder={placeholder}
        className="h-11 w-full rounded-lg border border-line px-3 text-sm outline-none focus:border-brand"
      />
    </label>
  );
}

function UserMobileCard({
  user,
  draft,
  saving,
  onChange,
  onSave
}: {
  user: AdminUser;
  draft: DraftUser;
  saving: boolean;
  onChange: (input: Partial<DraftUser>) => void;
  onSave: () => void;
}) {
  return (
    <article className="ui-card p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="break-words text-sm font-semibold text-ink">{user.email}</p>
          <p className="mt-1 text-xs text-slate-500">加入：{new Date(user.created_at).toLocaleString("zh-CN")}</p>
          {user.admin_locked && <AdminLockedPill />}
        </div>
        <SaveButton saving={saving} onClick={onSave} className="sm:w-auto" />
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <LabeledInput label="姓名" value={draft.name} onChange={(value) => onChange({ name: value })} />
        <LabeledInput
          label="部门"
          value={draft.department}
          onChange={(value) => onChange({ department: value })}
          list="department-suggestions"
          placeholder="例如：人力资源部"
        />
        <LabeledInput
          label="岗位"
          value={draft.position}
          onChange={(value) => onChange({ position: value })}
          list="position-suggestions"
          placeholder="例如：质量工程师"
        />
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-slate-600">安全密级</span>
          <SecurityClearanceSelect value={draft.security_clearance} onChange={(security_clearance) => onChange({ security_clearance })} />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-slate-600">重置密码</span>
          <input
            value={draft.password}
            onChange={(event) => onChange({ password: event.target.value })}
            type="password"
            placeholder="留空不修改"
            className="h-11 w-full rounded-lg border border-line px-3 text-sm outline-none focus:border-brand"
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-slate-600">角色</span>
          <RoleSelect value={draft.role} disabled={user.admin_locked} onChange={(role) => onChange({ role })} />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-slate-600">状态</span>
          <StatusSelect value={draft.status} disabled={user.admin_locked} onChange={(status) => onChange({ status })} />
        </label>
      </div>
    </article>
  );
}

function RoleSelect({
  value,
  disabled,
  onChange,
  className = "w-full"
}: {
  value: UserRole;
  disabled: boolean;
  onChange: (role: UserRole) => void;
  className?: string;
}) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value as UserRole)}
      disabled={disabled}
      className={`h-10 rounded-lg border border-line px-3 text-sm outline-none focus:border-brand disabled:bg-slate-50 disabled:text-slate-400 ${className}`}
    >
      <option value="employee">员工</option>
      <option value="admin">管理员</option>
    </select>
  );
}

function SecurityClearanceSelect({
  value,
  onChange,
  className = "w-full"
}: {
  value: DocumentSecurityLevel;
  onChange: (value: DocumentSecurityLevel) => void;
  className?: string;
}) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value as DocumentSecurityLevel)}
      className={`h-10 rounded-lg border border-line px-3 text-sm outline-none focus:border-brand ${className}`}
    >
      <option value="public">公开</option>
      <option value="internal">内部</option>
      <option value="confidential">保密</option>
      <option value="restricted">受限</option>
    </select>
  );
}

function StatusSelect({
  value,
  disabled,
  onChange,
  className = "w-full"
}: {
  value: UserProfile["status"];
  disabled: boolean;
  onChange: (status: UserProfile["status"]) => void;
  className?: string;
}) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value as UserProfile["status"])}
      disabled={disabled}
      className={`h-10 rounded-lg border border-line px-3 text-sm outline-none focus:border-brand disabled:bg-slate-50 disabled:text-slate-400 ${className}`}
    >
      <option value="active">启用</option>
      <option value="disabled">禁用</option>
    </select>
  );
}

function SaveButton({
  saving,
  onClick,
  className = ""
}: {
  saving: boolean;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={saving}
      className={`ui-button-primary h-10 px-3 ${className}`}
    >
      {saving ? <Loader2 className="animate-spin" size={15} /> : <Save size={15} />}
      保存
    </button>
  );
}

function AdminLockedPill() {
  return (
    <span className="mt-2 inline-flex items-center gap-1 rounded-full bg-cyan/10 px-2 py-0.5 text-xs text-brand">
      <ShieldCheck size={12} />
      环境变量管理员
    </span>
  );
}

function UserViewButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`h-10 rounded-md px-3 text-sm font-semibold transition ${active ? "bg-brand text-white" : "text-slate-600 hover:bg-slate-100"}`}
    >
      {children}
    </button>
  );
}

function UserListPager({ total, visible, onChange }: { total: number; visible: number; onChange: (value: number) => void }) {
  if (total <= INITIAL_VISIBLE_USERS) return null;

  const hasMore = visible < total;
  const nextCount = Math.min(total, visible + INITIAL_VISIBLE_USERS);

  return (
    <div className="flex items-center justify-center gap-2 border-t border-line pt-3">
      {hasMore && (
        <button type="button" onClick={() => onChange(nextCount)} className="ui-button-secondary h-9 px-3 text-xs">
          再显示 {nextCount - visible} 个
          <ChevronDown size={14} />
        </button>
      )}
      {visible > INITIAL_VISIBLE_USERS && (
        <button type="button" onClick={() => onChange(INITIAL_VISIBLE_USERS)} className="ui-button-secondary h-9 px-3 text-xs">
          收起列表
        </button>
      )}
      <span className="text-xs text-slate-500">共 {total} 个</span>
    </div>
  );
}

function EmptyUsers({ searchQuery = "" }: { searchQuery?: string }) {
  return (
    <section className="ui-card border-dashed p-8 text-center text-sm text-slate-500">
      {searchQuery ? "没有匹配的用户。" : "暂无用户。员工首次登录或注册后会自动出现在这里。"}
    </section>
  );
}
