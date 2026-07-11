"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Archive,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock3,
  FileCheck2,
  Loader2,
  RefreshCw,
  RotateCcw,
  Send,
  ShieldCheck,
  Undo2,
  X,
  XCircle
} from "lucide-react";
import type {
  DocumentApprovalEvent,
  DocumentApprovalRequest,
  DocumentRecord,
  DocumentVersion,
  KnowledgeBase,
  UserProfile
} from "@/lib/types";
import type { DocumentWorkflowAction } from "@/lib/document-approval";

type WorkbenchTab = "pending" | "submitted" | "rejected" | "published";
type WorkbenchData = {
  current_user: UserProfile;
  documents: DocumentRecord[];
  requests: DocumentApprovalRequest[];
  events: DocumentApprovalEvent[];
  capabilities: Record<string, { can_review: boolean; can_publish: boolean }>;
  knowledge_bases: KnowledgeBase[];
  users: Array<Pick<UserProfile, "id" | "name" | "email" | "department" | "position" | "role" | "security_clearance">>;
  versions: DocumentVersion[];
};
type ConfirmState = {
  action: DocumentWorkflowAction;
  documentIds: string[];
  title: string;
  description: string;
  requireComment: boolean;
  commentLabel: string;
};
type ReleaseDiff = {
  documentId: string;
  documentTitle: string;
  targetVersion: DocumentVersion;
  publishedVersion: DocumentVersion | null;
  snapshotAvailable: boolean;
  summary: { same: number; changed: number; added: number; removed: number; before_chunks: number; after_chunks: number };
};

const tabs: Array<{ value: WorkbenchTab; label: string }> = [
  { value: "pending", label: "待我处理" },
  { value: "submitted", label: "我提交的" },
  { value: "rejected", label: "已驳回" },
  { value: "published", label: "已发布" }
];

export function ApprovalWorkbench() {
  const [data, setData] = useState<WorkbenchData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [tab, setTab] = useState<WorkbenchTab>("pending");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [comment, setComment] = useState("");
  const [working, setWorking] = useState(false);
  const [releaseDiffs, setReleaseDiffs] = useState<ReleaseDiff[]>([]);
  const [releaseDiffLoading, setReleaseDiffLoading] = useState(false);
  const [releaseDiffError, setReleaseDiffError] = useState("");
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  async function load() {
    setLoading(true);
    setLoadError("");
    try {
      const response = await fetch("/api/document-approvals", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "加载审批工作台失败");
      setData(payload);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "加载审批工作台失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    setSelectedIds([]);
  }, [tab]);

  const documentById = useMemo(() => new Map(data?.documents.map((item) => [item.id, item]) ?? []), [data]);
  const kbById = useMemo(() => new Map(data?.knowledge_bases.map((item) => [item.id, item]) ?? []), [data]);
  const userById = useMemo(() => new Map(data?.users.map((item) => [item.id, item]) ?? []), [data]);
  const versionById = useMemo(() => new Map(data?.versions.map((item) => [item.id, item]) ?? []), [data]);
  const eventsByDocument = useMemo(() => {
    const map = new Map<string, DocumentApprovalEvent[]>();
    for (const event of data?.events ?? []) {
      const current = map.get(event.document_id) ?? [];
      current.push(event);
      map.set(event.document_id, current);
    }
    return map;
  }, [data]);
  const visibleRequests = useMemo(() => {
    if (!data) return [];
    return data.requests.filter((request) => {
      const capability = data.capabilities[request.document_id];
      if (tab === "pending") {
        return (request.status === "pending" && capability?.can_review) || (request.status === "approved" && capability?.can_publish);
      }
      if (tab === "submitted") return request.submitted_by === data.current_user.id;
      if (tab === "rejected") return request.status === "rejected";
      return request.status === "published" || request.status === "archived";
    });
  }, [data, tab]);

  const counts = useMemo(() => {
    if (!data) return { pending: 0, submitted: 0, rejected: 0, published: 0 };
    return {
      pending: data.requests.filter((request) => {
        const capability = data.capabilities[request.document_id];
        return (request.status === "pending" && capability?.can_review) || (request.status === "approved" && capability?.can_publish);
      }).length,
      submitted: data.requests.filter((request) => request.submitted_by === data.current_user.id).length,
      rejected: data.requests.filter((request) => request.status === "rejected").length,
      published: data.requests.filter((request) => request.status === "published" || request.status === "archived").length
    };
  }, [data]);

  async function openConfirm(action: DocumentWorkflowAction, documentIds: string[]) {
    const presets: Record<DocumentWorkflowAction, Omit<ConfirmState, "action" | "documentIds">> = {
      submit_review: { title: "提交资料审核", description: "提交后资料进入审核中，员工仍无法检索。", requireComment: false, commentLabel: "提交说明（可选）" },
      withdraw_review: { title: "撤回审批申请", description: "撤回后资料恢复为草稿，可以继续修改。", requireComment: false, commentLabel: "撤回说明（可选）" },
      approve_review: { title: "审核通过", description: "通过后资料进入待发布状态，还需要有发布权限的人员正式发布。", requireComment: false, commentLabel: "审核意见（可选）" },
      reject_review: { title: "驳回资料", description: "资料会退回提交人修改，驳回原因将写入审批记录。", requireComment: true, commentLabel: "修改意见（必填）" },
      publish: { title: "发布资料", description: "发布后符合权限范围的员工可以在问答中检索该资料。", requireComment: false, commentLabel: "发布说明（可选）" },
      archive: { title: "归档资料", description: "归档后员工将无法继续检索该资料。", requireComment: false, commentLabel: "归档说明（可选）" },
      restore_draft: { title: "恢复为草稿", description: "资料恢复为草稿后可以修改并重新提交审核。", requireComment: false, commentLabel: "恢复说明（可选）" }
    };
    setComment("");
    setReleaseDiffs([]);
    setReleaseDiffError("");
    setConfirmState({ action, documentIds, ...presets[action] });
    if (action !== "publish") return;

    setReleaseDiffLoading(true);
    try {
      const diffs = await Promise.all(documentIds.map(async (documentId) => {
        const request = data?.requests.find((item) => item.document_id === documentId && item.status === "approved");
        const document = documentById.get(documentId);
        if (!request?.document_version_id || !document) throw new Error("审批请求没有关联可发布版本");
        const response = await fetch(`/api/documents/${documentId}/release-diff?version_id=${encodeURIComponent(request.document_version_id)}`, { cache: "no-store" });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? `读取「${document.title}」发布差异失败`);
        return {
          documentId,
          documentTitle: document.title,
          targetVersion: payload.target_version,
          publishedVersion: payload.published_version,
          snapshotAvailable: payload.snapshot_available,
          summary: payload.summary
        } as ReleaseDiff;
      }));
      setReleaseDiffs(diffs);
    } catch (error) {
      setReleaseDiffError(error instanceof Error ? error.message : "读取发布差异失败");
    } finally {
      setReleaseDiffLoading(false);
    }
  }

  async function submitAction() {
    if (!confirmState || (confirmState.requireComment && !comment.trim())) return;
    setWorking(true);
    try {
      const response = await fetch("/api/document-approvals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: confirmState.action,
          document_ids: confirmState.documentIds,
          version_ids: Object.fromEntries(confirmState.documentIds.map((documentId) => [
            documentId,
            data?.requests.find((item) => item.document_id === documentId && ["pending", "approved"].includes(item.status))?.document_version_id ?? null
          ])),
          comment: comment.trim() || null
        })
      });
      const payload = await response.json();
      if (!response.ok && !payload.success_count) throw new Error(payload.error ?? payload.errors?.[0]?.error ?? "操作失败");
      const failureText = payload.failure_count ? `，${payload.failure_count} 份失败` : "";
      setNotice({ tone: payload.failure_count ? "error" : "success", text: `已完成 ${payload.success_count} 份资料${failureText}` });
      setConfirmState(null);
      setSelectedIds([]);
      await load();
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "操作失败，请重试" });
    } finally {
      setWorking(false);
    }
  }

  if (loading && !data) return <WorkbenchSkeleton />;

  if (loadError && !data) {
    return (
      <section className="ui-section flex min-h-[360px] flex-col items-center justify-center text-center">
        <XCircle size={32} className="text-red-600" />
        <h1 className="mt-4 text-xl font-semibold text-ink">审批工作台加载失败</h1>
        <p className="mt-2 max-w-lg text-sm text-slate-600">{loadError}</p>
        <button type="button" onClick={() => void load()} className="ui-button-primary mt-5 min-h-11">
          <RefreshCw size={16} />重新加载
        </button>
      </section>
    );
  }

  if (!data) return null;

  const selectedRequests = visibleRequests.filter((request) => selectedIds.includes(request.document_id));
  const bulkAction = resolveBulkAction(tab, selectedRequests);
  const canBulkReject = tab === "pending" && selectedRequests.length > 0 && selectedRequests.every((request) => request.status === "pending");

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-4 border-b border-line pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="ui-page-kicker">DOCUMENT APPROVAL</p>
          <h1 className="ui-page-title mt-1">资料审批工作台</h1>
          <p className="ui-muted mt-2">审核、发布与归档都经过权限校验，并保留完整操作时间线。</p>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading} className="ui-button-secondary min-h-11 self-start sm:self-auto">
          {loading ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}刷新
        </button>
      </header>

      <section className="grid overflow-hidden rounded-lg border border-line bg-white sm:grid-cols-2 xl:grid-cols-4" aria-label="审批概览">
        <Metric icon={Clock3} label="待我处理" value={counts.pending} tone="amber" />
        <Metric icon={Send} label="我提交的" value={counts.submitted} tone="blue" />
        <Metric icon={XCircle} label="已驳回" value={counts.rejected} tone="red" />
        <Metric icon={CheckCircle2} label="已发布" value={counts.published} tone="green" />
      </section>

      <section className="border-b border-line" aria-label="审批分类">
        <div className="flex gap-1 overflow-x-auto pb-px">
          {tabs.map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => setTab(item.value)}
              className={`min-h-11 shrink-0 border-b-2 px-4 text-sm font-semibold transition ${
                tab === item.value ? "border-brand text-brand" : "border-transparent text-slate-500 hover:text-ink"
              }`}
            >
              {item.label}<span className="ml-2 tabular-nums">{counts[item.value]}</span>
            </button>
          ))}
        </div>
      </section>

      {selectedIds.length > 0 && (bulkAction || canBulkReject) && (
        <div className="sticky top-20 z-20 flex flex-col gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 shadow-sm sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm font-semibold text-blue-900">已选择 {selectedIds.length} 份资料</p>
          <div className="flex gap-2">
            <button type="button" onClick={() => setSelectedIds([])} className="ui-button-secondary min-h-11 flex-1 sm:flex-none">取消选择</button>
            {canBulkReject && (
              <button type="button" onClick={() => void openConfirm("reject_review", selectedIds)} className="ui-button-danger min-h-11 flex-1 sm:flex-none">
                <XCircle size={16} />批量驳回
              </button>
            )}
            {bulkAction && (
              <button type="button" onClick={() => void openConfirm(bulkAction, selectedIds)} className="ui-button-primary min-h-11 flex-1 sm:flex-none">
                {actionIcon(bulkAction)}批量{actionLabel(bulkAction)}
              </button>
            )}
          </div>
        </div>
      )}

      {visibleRequests.length > 0 ? (
        <div className="space-y-3">
          {visibleRequests.map((request) => {
            const document = documentById.get(request.document_id);
            if (!document) return null;
            const capability = data.capabilities[document.id];
            const requestEvents = eventsByDocument.get(document.id) ?? [];
            const requestVersion = request.document_version_id ? versionById.get(request.document_version_id) : null;
            const expanded = expandedId === request.id;
            const actions = availableActions(request, document, data.current_user, capability);
            return (
              <article key={request.id} className="overflow-hidden rounded-lg border border-line bg-white shadow-panel">
                <div className="grid gap-4 p-4 lg:grid-cols-[auto_minmax(0,1fr)_auto] lg:items-center">
                  <label className="flex size-11 items-center justify-center self-start rounded-lg border border-line bg-slate-50" title="选择资料">
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(document.id)}
                      onChange={() => setSelectedIds((current) => current.includes(document.id)
                        ? current.filter((id) => id !== document.id)
                        : [...current, document.id])}
                      className="size-4 accent-blue-600"
                      aria-label={`选择 ${document.title}`}
                    />
                  </label>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="min-w-0 text-base font-semibold text-ink">{document.title}</h2>
                      <StatusBadge status={request.status} />
                      <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600">{securityLabel(document.security_level)}</span>
                    </div>
                    <p className="mt-2 text-sm text-slate-600">
                      {kbById.get(document.knowledge_base_id)?.name ?? "未知知识库"} · 提交人 {userById.get(request.submitted_by)?.name ?? request.submitted_by}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      提交于 {formatDate(request.submitted_at)} · 审批版本 {requestVersion ? `v${requestVersion.version}` : "未关联"} · {permissionSummary(document)}
                    </p>
                    {request.review_comment && (
                      <p className="mt-3 rounded-md border-l-4 border-amber-400 bg-amber-50 px-3 py-2 text-sm leading-6 text-amber-900">
                        审核意见：{request.review_comment}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2 lg:max-w-[360px] lg:justify-end">
                    {actions.map((action) => (
                      <button
                        key={action}
                        type="button"
                        onClick={() => void openConfirm(action, [document.id])}
                        className={`${action === "reject_review" || action === "archive" ? "ui-button-danger" : action === "publish" || action === "approve_review" ? "ui-button-success" : "ui-button-secondary"} min-h-11 px-3`}
                      >
                        {actionIcon(action)}{actionLabel(action)}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => setExpandedId(expanded ? null : request.id)}
                      className="ui-button-secondary min-h-11 px-3"
                      aria-expanded={expanded}
                    >
                      {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}审批记录
                    </button>
                  </div>
                </div>
                {expanded && <ApprovalTimeline events={requestEvents} userById={userById} />}
              </article>
            );
          })}
        </div>
      ) : (
        <EmptyState tab={tab} />
      )}

      {confirmState && (
        <div className="fixed inset-0 z-[100] flex items-end justify-center bg-slate-950/45 p-0 backdrop-blur-sm sm:items-center sm:p-4" role="presentation">
          <div role="dialog" aria-modal="true" aria-labelledby="approval-dialog-title" className="w-full rounded-t-lg border border-line bg-white p-5 shadow-2xl sm:max-w-lg sm:rounded-lg">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 id="approval-dialog-title" className="text-lg font-semibold text-ink">{confirmState.title}</h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">{confirmState.description}</p>
              </div>
              <button type="button" onClick={() => setConfirmState(null)} disabled={working} className="grid size-11 shrink-0 place-items-center rounded-lg text-slate-500 hover:bg-slate-100" aria-label="关闭">
                <X size={18} />
              </button>
            </div>
            {confirmState.action === "publish" && (
              <div className="mt-5 rounded-lg border border-line bg-slate-50 p-3">
                <h3 className="text-sm font-semibold text-ink">发布版本差异</h3>
                {releaseDiffLoading && <p className="mt-2 flex items-center gap-2 text-sm text-slate-500"><Loader2 size={15} className="animate-spin" />正在对比线上版本与待发布版本</p>}
                {releaseDiffError && <p className="mt-2 text-sm leading-6 text-red-700" role="alert">{releaseDiffError}</p>}
                {!releaseDiffLoading && !releaseDiffError && releaseDiffs.length > 0 && (
                  <div className="mt-3 space-y-3">
                    {releaseDiffs.map((diff) => (
                      <div key={diff.documentId} className="rounded-md border border-line bg-white px-3 py-3">
                        <p className="text-sm font-semibold text-ink">{diff.documentTitle}</p>
                        <p className="mt-1 text-xs text-slate-500">
                          {diff.publishedVersion ? `线上 v${diff.publishedVersion.version}` : "首次发布"} → 待发布 v{diff.targetVersion.version}
                        </p>
                        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                          <DiffMetric label="未变化" value={diff.summary.same} tone="neutral" />
                          <DiffMetric label="修改" value={diff.summary.changed} tone="warning" />
                          <DiffMetric label="新增" value={diff.summary.added} tone="success" />
                          <DiffMetric label="删除" value={diff.summary.removed} tone="danger" />
                        </div>
                        {!diff.snapshotAvailable && <p className="mt-2 text-xs text-red-700">该版本没有正文快照，不能发布。</p>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            <label className="mt-5 block text-sm font-semibold text-ink" htmlFor="approval-comment">{confirmState.commentLabel}</label>
            <textarea
              id="approval-comment"
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              rows={4}
              autoFocus={confirmState.requireComment}
              className="ui-input mt-2 min-h-28 w-full py-3"
              placeholder={confirmState.requireComment ? "请说明需要修改的内容" : "补充本次操作说明"}
            />
            {confirmState.requireComment && !comment.trim() && <p className="mt-2 text-sm text-red-600" role="alert">驳回资料必须填写修改意见。</p>}
            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button type="button" onClick={() => setConfirmState(null)} disabled={working} className="ui-button-secondary min-h-11">取消</button>
              <button
                type="button"
                onClick={() => void submitAction()}
                disabled={working || (confirmState.requireComment && !comment.trim()) || (confirmState.action === "publish" && (releaseDiffLoading || Boolean(releaseDiffError) || releaseDiffs.some((diff) => !diff.snapshotAvailable)))}
                className="ui-button-primary min-h-11"
              >
                {working ? <Loader2 size={16} className="animate-spin" /> : actionIcon(confirmState.action)}
                确认{actionLabel(confirmState.action)} {confirmState.documentIds.length > 1 ? `${confirmState.documentIds.length} 份` : ""}
              </button>
            </div>
          </div>
        </div>
      )}

      {notice && (
        <div className={`fixed bottom-5 right-5 z-[110] max-w-sm rounded-lg border px-4 py-3 text-sm font-medium shadow-lg ${notice.tone === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-red-200 bg-red-50 text-red-900"}`} role="status" aria-live="polite">
          <div className="flex items-start gap-3">
            {notice.tone === "success" ? <CheckCircle2 size={18} /> : <XCircle size={18} />}
            <span>{notice.text}</span>
            <button type="button" onClick={() => setNotice(null)} aria-label="关闭提示" className="ml-auto"><X size={16} /></button>
          </div>
        </div>
      )}
    </div>
  );
}

function Metric({ icon: Icon, label, value, tone }: { icon: typeof Clock3; label: string; value: number; tone: "amber" | "blue" | "red" | "green" }) {
  const tones = { amber: "bg-amber-50 text-amber-700", blue: "bg-blue-50 text-blue-700", red: "bg-red-50 text-red-700", green: "bg-emerald-50 text-emerald-700" };
  return (
    <div className="flex items-center gap-3 border-b border-line p-4 last:border-b-0 sm:[&:nth-child(odd)]:border-r xl:border-b-0 xl:border-r xl:last:border-r-0">
      <span className={`grid size-10 shrink-0 place-items-center rounded-lg ${tones[tone]}`}><Icon size={19} /></span>
      <div><p className="text-xs font-medium text-slate-500">{label}</p><p className="mt-1 text-xl font-semibold tabular-nums text-ink">{value}</p></div>
    </div>
  );
}

function DiffMetric({ label, value, tone }: { label: string; value: number; tone: "neutral" | "warning" | "success" | "danger" }) {
  const classes = {
    neutral: "bg-slate-100 text-slate-700",
    warning: "bg-amber-100 text-amber-800",
    success: "bg-emerald-100 text-emerald-800",
    danger: "bg-red-100 text-red-800"
  };
  return <div className={`rounded-md px-2 py-2 text-center ${classes[tone]}`}><p className="text-xs font-medium">{label}</p><p className="mt-1 text-lg font-semibold tabular-nums">{value}</p></div>;
}

function ApprovalTimeline({ events, userById }: { events: DocumentApprovalEvent[]; userById: Map<string, WorkbenchData["users"][number]> }) {
  return (
    <div className="border-t border-line bg-slate-50 px-4 py-4">
      <h3 className="text-sm font-semibold text-ink">完整审批时间线</h3>
      {events.length > 0 ? (
        <ol className="mt-4 space-y-4">
          {events.map((event) => (
            <li key={event.id} className="grid grid-cols-[24px_minmax(0,1fr)] gap-3">
              <span className="mt-0.5 grid size-6 place-items-center rounded-full bg-white text-brand ring-1 ring-line"><Check size={13} /></span>
              <div>
                <p className="text-sm font-semibold text-ink">{eventLabel(event.action)}</p>
                <p className="mt-1 text-xs text-slate-500">{userById.get(event.actor_id)?.name ?? event.actor_name} · {formatDate(event.created_at)}</p>
                {event.comment && <p className="mt-2 text-sm leading-6 text-slate-700">{event.comment}</p>}
                {eventVersionSummary(event) && <p className="mt-2 text-xs font-medium text-blue-700">{eventVersionSummary(event)}</p>}
              </div>
            </li>
          ))}
        </ol>
      ) : <p className="mt-3 text-sm text-slate-500">暂无审批记录。</p>}
    </div>
  );
}

function EmptyState({ tab }: { tab: WorkbenchTab }) {
  const copy = {
    pending: ["暂无待处理资料", "新的审核或发布任务会显示在这里。"],
    submitted: ["还没有提交记录", "资料提交审核后，可以在这里跟踪处理进度。"],
    rejected: ["暂无驳回资料", "被驳回的资料及修改意见会集中显示在这里。"],
    published: ["暂无发布记录", "审核通过并正式发布的资料会显示在这里。"]
  }[tab];
  return (
    <section className="flex min-h-[300px] flex-col items-center justify-center rounded-lg border border-dashed border-line bg-white px-5 text-center">
      <FileCheck2 size={34} className="text-slate-400" />
      <h2 className="mt-4 text-lg font-semibold text-ink">{copy[0]}</h2>
      <p className="mt-2 text-sm text-slate-500">{copy[1]}</p>
    </section>
  );
}

function WorkbenchSkeleton() {
  return (
    <div className="animate-pulse space-y-5" aria-label="正在加载审批工作台">
      <div className="h-20 rounded-lg bg-slate-100" />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 4 }).map((_, index) => <div key={index} className="h-24 rounded-lg bg-slate-100" />)}</div>
      {Array.from({ length: 3 }).map((_, index) => <div key={index} className="h-36 rounded-lg bg-slate-100" />)}
    </div>
  );
}

function availableActions(
  request: DocumentApprovalRequest,
  document: DocumentRecord,
  user: UserProfile,
  capability?: { can_review: boolean; can_publish: boolean }
): DocumentWorkflowAction[] {
  if (request.status === "pending") {
    const actions: DocumentWorkflowAction[] = [];
    if (capability?.can_review) actions.push("approve_review", "reject_review");
    if (request.submitted_by === user.id || user.role === "admin") actions.push("withdraw_review");
    return actions;
  }
  if (request.status === "approved" && capability?.can_publish) return ["publish"];
  if (request.status === "rejected" && (request.submitted_by === user.id || user.role === "admin")) return ["restore_draft"];
  if (request.status === "published" && capability?.can_publish && document.publish_status === "published") return ["archive"];
  return [];
}

function resolveBulkAction(tab: WorkbenchTab, requests: DocumentApprovalRequest[]): DocumentWorkflowAction | null {
  if (requests.length === 0) return null;
  if (tab === "pending") return requests.every((item) => item.status === "approved") ? "publish" : requests.every((item) => item.status === "pending") ? "approve_review" : null;
  if (tab === "rejected") return "restore_draft";
  if (tab === "published" && requests.every((item) => item.status === "published")) return "archive";
  return null;
}

function StatusBadge({ status }: { status: DocumentApprovalRequest["status"] }) {
  const labels = { pending: "审核中", approved: "已通过待发布", rejected: "已驳回", withdrawn: "已撤回", published: "已发布", archived: "已归档" };
  const classes = { pending: "bg-amber-100 text-amber-800", approved: "bg-cyan-100 text-cyan-800", rejected: "bg-red-100 text-red-800", withdrawn: "bg-slate-100 text-slate-600", published: "bg-emerald-100 text-emerald-800", archived: "bg-zinc-100 text-zinc-600" };
  return <span className={`rounded-md px-2 py-1 text-xs font-semibold ${classes[status]}`}>{labels[status]}</span>;
}

function actionLabel(action: DocumentWorkflowAction) {
  return ({ submit_review: "提交审核", withdraw_review: "撤回", approve_review: "通过", reject_review: "驳回", publish: "发布", archive: "归档", restore_draft: "恢复草稿" })[action];
}

function actionIcon(action: DocumentWorkflowAction) {
  if (action === "approve_review") return <ShieldCheck size={16} />;
  if (action === "reject_review") return <XCircle size={16} />;
  if (action === "publish" || action === "submit_review") return <Send size={16} />;
  if (action === "archive") return <Archive size={16} />;
  if (action === "withdraw_review") return <Undo2 size={16} />;
  return <RotateCcw size={16} />;
}

function eventLabel(action: DocumentApprovalEvent["action"]) {
  return ({ submitted: "提交审核", withdrawn: "撤回审批", approved: "审核通过", rejected: "驳回修改", published: "正式发布", archived: "资料归档", restored_to_draft: "恢复草稿", content_edit_started: "开始内容修改", release_rollback_requested: "发起发布回退", version_rolled_back: "回滚资料版本", acl_updated: "更新可见权限" })[action];
}

function eventVersionSummary(event: DocumentApprovalEvent) {
  const version = event.metadata.published_version ?? event.metadata.document_version ?? event.metadata.restored_version;
  const previousVersion = event.metadata.previous_published_version;
  if (event.action === "published" && typeof version === "number") {
    return `${event.metadata.release_kind === "rollback" ? "回退发布" : "发布版本"}：${typeof previousVersion === "number" ? `v${previousVersion} → ` : ""}v${version}`;
  }
  if ((event.action === "submitted" || event.action === "release_rollback_requested") && typeof version === "number") {
    return `审批版本：v${version}`;
  }
  return "";
}

function securityLabel(level: DocumentRecord["security_level"]) {
  return ({ public: "公开", internal: "内部", confidential: "保密", restricted: "受限" })[level];
}

function permissionSummary(document: DocumentRecord) {
  const parts = [
    document.acl_departments.length ? `${document.acl_departments.length} 个部门` : "",
    document.acl_positions.length ? `${document.acl_positions.length} 个岗位` : "",
    document.acl_roles.length ? `${document.acl_roles.length} 个角色` : "",
    document.acl_users.length ? `${document.acl_users.length} 名员工` : ""
  ].filter(Boolean);
  return parts.length ? `可见范围：${parts.join("、")}` : "可见范围：按资料默认范围";
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short", hour12: false }).format(new Date(value));
}
