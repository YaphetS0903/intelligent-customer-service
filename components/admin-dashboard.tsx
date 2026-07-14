"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Clock,
  Database,
  Eye,
  FileUp,
  GitCompareArrows,
  Loader2,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Send,
  Shield,
  Sparkles,
  Trash2
} from "lucide-react";
import { StatusPill } from "@/components/status-pill";
import { DocumentPermissionTemplateManager } from "@/components/document-permission-template-manager";
import { ActionConfirmDialog, ErrorRetry, PanelSkeleton, useToast, type ActionConfirmRequest } from "@/components/ui-feedback";
import type {
  DocumentChunk,
  DocumentChunkGovernanceAudit,
  DocumentProcessingJobSnapshot,
  DocumentPermissionTemplate,
  DocumentPublishStatus,
  DocumentRecord,
  DocumentSecurityLevel,
  DocumentVersion,
  KnowledgeBase,
  UserProfile
} from "@/lib/types";

type DocumentPreview = {
  document: DocumentRecord;
  total_chunks: number;
  preview_limit?: number;
  preview_offset?: number;
  preview_count?: number;
  has_previous?: boolean;
  has_next?: boolean;
  truncated?: boolean;
  target_chunk_id?: string | null;
  target_chunk_found?: boolean;
  chunks: Array<Pick<DocumentChunk, "id" | "chunk_index" | "content" | "token_estimate" | "metadata">>;
};

type DocumentPreviewGroup = {
  key: string;
  label: string;
  helper: string;
  parser: string | null;
  page: number | null;
  chunks: DocumentPreview["chunks"];
  tokenEstimate: number;
  characterCount: number;
};

type DocumentVersionCompare = {
  document: DocumentRecord;
  version: DocumentVersion;
  summary: {
    current_chunks: number;
    version_chunks: number;
    same: number;
    changed: number;
    added: number;
    removed: number;
    current_tokens: number;
    version_tokens: number;
  };
  snapshot_available: boolean;
  total_items: number;
  diff_limit: number;
  diff_offset: number;
  has_previous: boolean;
  has_next: boolean;
  showing_only_changes: boolean;
  items: Array<{
    chunk_index: number;
    status: "same" | "changed" | "added" | "removed";
    before: CompareChunkPayload | null;
    after: CompareChunkPayload | null;
  }>;
};

type CompareChunkPayload = {
  content: string;
  token_estimate: number;
  metadata: DocumentChunk["metadata"];
};

type CompareTextPart = {
  value: string;
  kind: "same" | "added" | "removed";
};

type DocumentProcessingDiagnostic = {
  chunk_count: number;
  total_tokens: number;
  average_tokens: number;
  min_tokens: number;
  max_tokens: number;
  empty_chunks: number;
  short_chunks: number;
  long_chunks: number;
  noisy_chunks: number;
  quality_score: number;
  quality_warnings: string[];
  parser_summary: string | null;
  parsers: string[];
  page_count: number;
  ocr_used: boolean;
  ocr_applicable: boolean;
  can_reprocess: boolean;
  last_error: string | null;
  last_version_note: string | null;
  last_processed_at: string | null;
  processing_age_ms: number | null;
  is_stale_processing: boolean;
};

type OcrStatus = {
  configured: boolean;
  provider: string;
  model: string;
  request_format: string;
  local_text: boolean;
};

type FailedUploadRetryItem = {
  id: string;
  file: File;
  file_name: string;
  error: string;
  knowledge_base_id: string;
  department: string | null;
  change_note: string;
  attempts: number;
  last_attempt_at: string;
};

type ChunkGovernanceInput = {
  summary: string;
  keywords: string[];
  synonyms: string[];
};

type ChunkMetadataSuggestion = ChunkGovernanceInput & {
  chunk_id: string;
  model?: string | null;
  generated_at?: string;
  job_id?: string | null;
};

type ChunkMetadataSuggestionJob = {
  id: string;
  knowledge_base_id: string;
  status: "queued" | "generating" | "ready" | "failed";
  total_chunks: number;
  processed_chunks: number;
  suggested_chunks: number;
  failed_chunks: number;
  message: string;
  model: string | null;
  error: string | null;
  started_at: string;
  updated_at: string;
  finished_at: string | null;
};

type ChunkMetadataSuggestionStats = {
  knowledge_base_id: string;
  total_chunks: number;
  missing_chunks: number;
  pending_suggestions: number;
};

type PendingChunkMetadataSuggestion = {
  chunk_id: string;
  document_id: string;
  knowledge_base_id: string;
  chunk_index: number;
  token_estimate: number;
  content_preview: string;
  document_title: string;
  file_name: string;
  knowledge_base_name: string;
  summary: string;
  keywords: string[];
  synonyms: string[];
  model: string | null;
  generated_at: string | null;
  job_id: string | null;
};

type GovernanceRetestQueueResult = {
  candidate_task_count: number;
  queued_task_count: number;
  skipped_reason: string | null;
  job: {
    id: string;
    status: "queued" | "running" | "completed" | "failed" | "canceled";
  } | null;
};

type GovernanceAuditRecord = DocumentChunkGovernanceAudit & {
  chunk_id: string;
  document_id: string;
  knowledge_base_id: string;
  chunk_index: number;
  token_estimate: number;
  content_preview: string;
  document_title: string;
  file_name: string;
  knowledge_base_name: string;
};

type AdminConfirmDialogState = ActionConfirmRequest & {
  resolve: (confirmed: boolean) => void;
};

type DocumentPreviewRetryState = {
  document: DocumentRecord;
  offset: number;
  targetChunkId: string | null;
  message: string;
};

export function AdminDashboard() {
  const { pushToast } = useToast();
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBase[]>([]);
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [documentVersions, setDocumentVersions] = useState<DocumentVersion[]>([]);
  const [permissionTemplates, setPermissionTemplates] = useState<DocumentPermissionTemplate[]>([]);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [documentDiagnostics, setDocumentDiagnostics] = useState<Record<string, DocumentProcessingDiagnostic>>({});
  const [documentProcessingJobs, setDocumentProcessingJobs] = useState<Record<string, DocumentProcessingJobSnapshot>>({});
  const [ocrStatus, setOcrStatus] = useState<OcrStatus | null>(null);
  const [ragProvider, setRagProvider] = useState("openai_file_search");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selectedKb, setSelectedKb] = useState("");
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editVisibility, setEditVisibility] = useState<KnowledgeBase["visibility"]>("all");
  const [editDepartments, setEditDepartments] = useState("");
  const [editPositions, setEditPositions] = useState("");
  const [uploading, setUploading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [provisioning, setProvisioning] = useState(false);
  const [creating, setCreating] = useState(false);
  const [savingKb, setSavingKb] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [previewLoadingId, setPreviewLoadingId] = useState<string | null>(null);
  const [reprocessingId, setReprocessingId] = useState<string | null>(null);
  const [selectedDocumentIds, setSelectedDocumentIds] = useState<string[]>([]);
  const [bulkWorking, setBulkWorking] = useState<string | null>(null);
  const [documentPreview, setDocumentPreview] = useState<DocumentPreview | null>(null);
  const [previewError, setPreviewError] = useState<DocumentPreviewRetryState | null>(null);
  const [versionCompare, setVersionCompare] = useState<DocumentVersionCompare | null>(null);
  const [versionCompareLoadingId, setVersionCompareLoadingId] = useState<string | null>(null);
  const [failedUploads, setFailedUploads] = useState<FailedUploadRetryItem[]>([]);
  const [retryingUploadId, setRetryingUploadId] = useState<string | null>(null);
  const [chunkGovernanceWorkingId, setChunkGovernanceWorkingId] = useState<string | null>(null);
  const [chunkSuggestionWorking, setChunkSuggestionWorking] = useState(false);
  const [chunkSuggestionJobStarting, setChunkSuggestionJobStarting] = useState(false);
  const [chunkMetadataSuggestions, setChunkMetadataSuggestions] = useState<Record<string, ChunkMetadataSuggestion>>({});
  const [chunkSuggestionJobs, setChunkSuggestionJobs] = useState<ChunkMetadataSuggestionJob[]>([]);
  const [chunkSuggestionStats, setChunkSuggestionStats] = useState<ChunkMetadataSuggestionStats[]>([]);
  const [pendingChunkSuggestions, setPendingChunkSuggestions] = useState<PendingChunkMetadataSuggestion[]>([]);
  const [governanceAudits, setGovernanceAudits] = useState<GovernanceAuditRecord[]>([]);
  const [pendingSuggestionScope, setPendingSuggestionScope] = useState<"active" | "all">("active");
  const [selectedPendingSuggestionIds, setSelectedPendingSuggestionIds] = useState<string[]>([]);
  const [pendingSuggestionWorkingId, setPendingSuggestionWorkingId] = useState<string | null>(null);
  const [targetPreviewChunkId, setTargetPreviewChunkId] = useState<string | null>(null);
  const [handledPreviewRequestKey, setHandledPreviewRequestKey] = useState<string | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<AdminConfirmDialogState | null>(null);

  function requestAdminConfirm(input: ActionConfirmRequest) {
    return new Promise<boolean>((resolve) => {
      setConfirmDialog({
        ...input,
        cancelLabel: input.cancelLabel ?? "取消",
        tone: input.tone ?? "warning",
        resolve
      });
    });
  }

  function settleAdminConfirm(confirmed: boolean) {
    setConfirmDialog((current) => {
      current?.resolve(confirmed);
      return null;
    });
  }

  useEffect(() => {
    void refresh({ rethrow: false, silent: true });
  }, []);

  const activeKb = useMemo(
    () => knowledgeBases.find((item) => item.id === selectedKb) ?? knowledgeBases[0],
    [knowledgeBases, selectedKb]
  );

  const activeDocuments = useMemo(
    () => documents.filter((document) => !activeKb || document.knowledge_base_id === activeKb.id),
    [documents, activeKb]
  );
  const activeDocumentVersions = useMemo(
    () => documentVersions.filter((version) => !activeKb || version.knowledge_base_id === activeKb.id),
    [documentVersions, activeKb]
  );
  const aclDepartments = useMemo(
    () => [...new Set(users.map((user) => user.department).filter(Boolean))].sort((a, b) => a.localeCompare(b, "zh-CN")),
    [users]
  );
  const aclPositions = useMemo(
    () => [...new Set(users.map((user) => user.position).filter(Boolean))].sort((a, b) => a.localeCompare(b, "zh-CN")),
    [users]
  );
  const selectedDocuments = useMemo(
    () => activeDocuments.filter((document) => selectedDocumentIds.includes(document.id)),
    [activeDocuments, selectedDocumentIds]
  );
  const allActiveDocumentsSelected = activeDocuments.length > 0 && selectedDocuments.length === activeDocuments.length;
  const activeDocumentStats = useMemo(() => {
    return activeDocuments.reduce(
      (stats, document) => ({
        ...stats,
        [document.status]: stats[document.status] + 1,
        total: stats.total + 1
      }),
      {
        total: 0,
        uploading: 0,
        processing: 0,
        ready: 0,
        failed: 0
      }
    );
  }, [activeDocuments]);
  const activeChunkSuggestionJob = useMemo(
    () => chunkSuggestionJobs.find((job) =>
      job.knowledge_base_id === activeKb?.id && (job.status === "queued" || job.status === "generating")
    ) ?? chunkSuggestionJobs.find((job) => job.knowledge_base_id === activeKb?.id) ?? null,
    [activeKb?.id, chunkSuggestionJobs]
  );
  const activeChunkSuggestionStats = useMemo(
    () => chunkSuggestionStats.find((row) => row.knowledge_base_id === activeKb?.id) ?? null,
    [activeKb?.id, chunkSuggestionStats]
  );
  const activePendingChunkSuggestions = useMemo(
    () => pendingChunkSuggestions.filter((item) => item.knowledge_base_id === activeKb?.id),
    [activeKb?.id, pendingChunkSuggestions]
  );
  const activeGovernanceAudits = useMemo(
    () => governanceAudits.filter((item) => item.knowledge_base_id === activeKb?.id),
    [activeKb?.id, governanceAudits]
  );
  const visiblePendingChunkSuggestions = pendingSuggestionScope === "all"
    ? pendingChunkSuggestions
    : activePendingChunkSuggestions;
  const selectedPendingChunkSuggestions = useMemo(
    () => pendingChunkSuggestions.filter((item) => selectedPendingSuggestionIds.includes(item.chunk_id)),
    [pendingChunkSuggestions, selectedPendingSuggestionIds]
  );
  const hasRunningChunkSuggestionJob = chunkSuggestionJobs.some((job) => job.status === "queued" || job.status === "generating");
  const isLocalTextRag = ragProvider === "local_text";
  const canUpload = Boolean(activeKb && (isLocalTextRag || activeKb.openai_vector_store_id));
  const hasPendingDocuments = activeDocumentStats.uploading + activeDocumentStats.processing > 0;
  const hasLoadedContent = knowledgeBases.length > 0 || documents.length > 0 || documentVersions.length > 0;

  useEffect(() => {
    if (!hasPendingDocuments && !hasRunningChunkSuggestionJob) {
      return;
    }

    const timer = window.setInterval(() => {
      void refresh({ silent: true, rethrow: false });
    }, 6000);

    return () => window.clearInterval(timer);
  }, [hasPendingDocuments, hasRunningChunkSuggestionJob]);

  useEffect(() => {
    setSelectedPendingSuggestionIds((current) => {
      if (current.length === 0) {
        return current;
      }

      const availableIds = new Set(pendingChunkSuggestions.map((item) => item.chunk_id));
      return current.filter((chunkId) => availableIds.has(chunkId));
    });
  }, [pendingChunkSuggestions]);

  useEffect(() => {
    if (!activeKb) {
      setEditName("");
      setEditDescription("");
      setEditVisibility("all");
      setEditDepartments("");
      setEditPositions("");
      return;
    }

    setEditName(activeKb.name);
    setEditDescription(activeKb.description ?? "");
    setEditVisibility(activeKb.visibility);
    setEditDepartments(activeKb.departments.join(", "));
    setEditPositions(activeKb.positions.join(", "));
  }, [activeKb]);

  useEffect(() => {
    setSelectedDocumentIds((current) =>
      current.filter((id) => activeDocuments.some((document) => document.id === id))
    );
  }, [activeDocuments]);

  useEffect(() => {
    if (!notice) {
      return;
    }

    const tone = noticeTone(notice);
    pushToast({
      tone,
      title: noticeTitle(tone),
      description: notice,
      durationMs: tone === "error" ? 6200 : 4200
    });
    setNotice(null);
  }, [notice, pushToast]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const documentId = params.get("document");
    const chunkId = params.get("chunk");
    const requestKey = documentId ? `${documentId}:${chunkId ?? ""}` : "";

    if (!documentId || handledPreviewRequestKey === requestKey || documents.length === 0) {
      return;
    }

    const document = documents.find((item) => item.id === documentId);
    if (!document) {
      return;
    }

    setHandledPreviewRequestKey(requestKey);
    setSelectedKb(document.knowledge_base_id);
    void loadDocumentPreview(document, 0, chunkId);
  }, [documents, handledPreviewRequestKey]);

  function parseList(value: string) {
    return value
      .split(/[,，\n]/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  function knowledgeBaseLabel(kb: KnowledgeBase) {
    if (kb.visibility === "all") {
      return "全员可见";
    }

    if (kb.visibility === "admin_only") {
      return "仅管理员";
    }

    if (kb.visibility === "position") {
      return `岗位：${kb.positions.join("、") || "未设置"}`;
    }

    return `部门：${kb.departments.join("、") || "未设置"}`;
  }

  async function refresh(options: { silent?: boolean; rethrow?: boolean } = {}) {
    const { silent = false, rethrow = true } = options;

    try {
      const [kbResponse, docResponse, suggestionJobsResponse, pendingSuggestionsResponse, auditResponse] = await Promise.all([
        fetch("/api/knowledge-bases", { cache: "no-store" }),
        fetch("/api/documents", { cache: "no-store" }),
        fetch("/api/documents/chunks/suggestion-jobs", { cache: "no-store" }),
        fetch("/api/documents/chunks/pending-suggestions", { cache: "no-store" }),
        fetch("/api/documents/chunks/governance-audit?limit=60", { cache: "no-store" }).catch((error) => {
          console.warn("[documents:governance-audit]", error);
          return null;
        })
      ]);
      const kbData = await kbResponse.json();
      const docData = await docResponse.json();
      const suggestionJobsData = await suggestionJobsResponse.json();
      const pendingSuggestionsData = await pendingSuggestionsResponse.json();
      const auditData = auditResponse ? await auditResponse.json().catch(() => ({ audits: [] })) : { audits: [] };

      if (!kbResponse.ok) {
        throw new Error(kbData.error ?? "知识库加载失败");
      }

      if (!docResponse.ok) {
        throw new Error(docData.error ?? "资料加载失败");
      }

      if (!suggestionJobsResponse.ok) {
        throw new Error(suggestionJobsData.error ?? "全库治理队列加载失败");
      }

      if (!pendingSuggestionsResponse.ok) {
        throw new Error(pendingSuggestionsData.error ?? "待确认治理建议加载失败");
      }

      if (auditResponse && !auditResponse.ok) {
        console.warn("[documents:governance-audit]", auditData.error ?? "知识治理审计加载失败");
      }

      setKnowledgeBases(kbData.knowledgeBases ?? []);
      setRagProvider(kbData.ragProvider ?? "openai_file_search");
      setDocuments(docData.documents ?? []);
      setDocumentVersions(docData.documentVersions ?? []);
      setPermissionTemplates(docData.permissionTemplates ?? []);
      setUsers(docData.users ?? []);
      setDocumentDiagnostics(docData.documentDiagnostics ?? {});
      setDocumentProcessingJobs(docData.documentProcessingJobs ?? {});
      setChunkSuggestionJobs(suggestionJobsData.jobs ?? []);
      setChunkSuggestionStats(suggestionJobsData.stats ?? []);
      setPendingChunkSuggestions(pendingSuggestionsData.suggestions ?? []);
      setGovernanceAudits(auditData.audits ?? []);
      setOcrStatus(docData.ocrStatus ?? null);
      setLoadError(null);
      if (!selectedKb && kbData.knowledgeBases?.[0]) {
        setSelectedKb(kbData.knowledgeBases[0].id);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "知识管理数据加载失败";
      setLoadError(message);
      if (!silent) {
        setNotice(message);
      }
      if (rethrow) {
        throw error;
      }
    } finally {
      setInitialLoading(false);
    }
  }

  async function refreshDocumentStatuses() {
    setRefreshing(true);
    setNotice(null);

    try {
      const response = await fetch("/api/documents/refresh", {
        method: "POST"
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "刷新失败");
      }

      setDocuments(data.documents ?? []);
      setNotice("文档处理状态已刷新。");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "刷新失败");
    } finally {
      setRefreshing(false);
    }
  }

  async function provisionVectorStore() {
    if (!activeKb) {
      setNotice("请先选择知识库");
      return;
    }

    setProvisioning(true);
    setNotice(null);

    try {
      const response = await fetch(`/api/knowledge-bases/${activeKb.id}/provision`, {
        method: "POST"
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "创建 Vector Store 失败");
      }

      await refresh();
      setNotice("Vector Store 已创建，后续上传资料会进入 OpenAI File Search。");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "创建 Vector Store 失败");
    } finally {
      setProvisioning(false);
    }
  }

  async function createKb() {
    if (!name.trim()) {
      setNotice("请输入知识库名称");
      return;
    }

    setCreating(true);
    setNotice(null);
    try {
      const response = await fetch("/api/knowledge-bases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          description,
          visibility: "all",
          departments: [],
          positions: []
        })
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error ?? "创建失败");
      }
      setName("");
      setDescription("");
      setSelectedKb(data.knowledgeBase.id);
      await refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "创建失败");
    } finally {
      setCreating(false);
    }
  }

  async function saveKnowledgeBase() {
    if (!activeKb) {
      setNotice("请先选择知识库");
      return;
    }

    if (!editName.trim()) {
      setNotice("知识库名称不能为空");
      return;
    }

    const departments = parseList(editDepartments);
    const positions = parseList(editPositions);

    if (editVisibility === "department" && departments.length === 0) {
      setNotice("部门可见时至少填写一个部门");
      return;
    }

    if (editVisibility === "position" && positions.length === 0) {
      setNotice("岗位可见时至少填写一个岗位");
      return;
    }

    setSavingKb(true);
    setNotice(null);

    try {
      const response = await fetch(`/api/knowledge-bases/${activeKb.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editName,
          description: editDescription,
          visibility: editVisibility,
          departments,
          positions
        })
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "保存失败");
      }

      await refresh();
      setNotice("知识库权限配置已保存。");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "保存失败");
    } finally {
      setSavingKb(false);
    }
  }

  async function deleteKnowledgeBase() {
    if (!activeKb) {
      return;
    }

    if (!(await requestAdminConfirm({
      title: "删除知识库？",
      description: `确认删除知识库「${activeKb.name}」吗？`,
      details: [
        "会同时删除该知识库下的资料、分片和关联配置。",
        "删除后无法恢复，请确认不是线上员工正在使用的资料范围。"
      ],
      confirmLabel: "确认删除",
      tone: "danger"
    }))) {
      return;
    }

    setDeletingId(activeKb.id);
    setNotice(null);

    try {
      const response = await fetch(`/api/knowledge-bases/${activeKb.id}`, {
        method: "DELETE"
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "删除失败");
      }

      setSelectedKb("");
      await refresh();
      setNotice("知识库已删除。");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "删除失败");
    } finally {
      setDeletingId(null);
    }
  }

  async function deleteDocument(document: DocumentRecord) {
    if (!(await requestAdminConfirm({
      title: "删除资料？",
      description: `确认删除资料「${document.title}」吗？`,
      details: [
        "会清理该资料对应的知识分片和远端文件记录。",
        "删除后员工端将无法再从这份资料召回答案。"
      ],
      confirmLabel: "确认删除",
      tone: "danger"
    }))) {
      return;
    }

    setDeletingId(document.id);
    setNotice(null);

    try {
      const response = await fetch(`/api/documents/${document.id}`, {
        method: "DELETE"
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "删除失败");
      }

      await refresh();
      setNotice("资料已删除。");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "删除失败");
    } finally {
      setDeletingId(null);
    }
  }

  async function uploadDocument(formData: FormData, retryContext?: {
    retryItemId?: string;
    knowledgeBaseId?: string;
    department?: string | null;
  }) {
    const targetKnowledgeBaseId = retryContext?.knowledgeBaseId ?? activeKb?.id ?? "";
    const files = formData.getAll("file").filter((item): item is File => item instanceof File);
    const changeNote = String(formData.get("change_note") ?? "");
    const department = retryContext?.department ?? (String(formData.get("department") ?? "") || null);
    const retryItemId = retryContext?.retryItemId ?? null;

    if (!targetKnowledgeBaseId) {
      setNotice("请先创建知识库");
      return;
    }

    if (files.length === 0) {
      setNotice("请先选择要上传的文件");
      return;
    }

    formData.set("knowledge_base_id", targetKnowledgeBaseId);
    if (department) {
      formData.set("department", department);
    } else {
      formData.delete("department");
    }

    if (retryItemId) {
      setRetryingUploadId(retryItemId);
    } else {
      setUploading(true);
    }
    setNotice(null);

    try {
      const response = await fetch("/api/documents/upload", {
        method: "POST",
        body: formData
      });
      const data = await response.json();
      const results = Array.isArray(data.results) ? data.results as Array<{ file_name?: string; status?: string; error?: string }> : [];

      if (!response.ok && results.length === 0) {
        throw new Error(data.error ?? "上传失败");
      }

      await refresh();
      const readyCount = results.filter((item) => item.status === "ready").length;
      const processingCount = results.filter((item) => item.status === "processing" || item.status === "uploading").length;
      const failedItems = results.filter((item) => item.status === "failed");
      const failedCount = failedItems.length;
      const totalCount = results.length || 1;
      const chunkCount = Number(data.chunks ?? 0);

      if (failedCount > 0) {
        const retryItems = buildFailedUploadRetryItems({
          files,
          failedItems,
          knowledgeBaseId: targetKnowledgeBaseId,
          department,
          changeNote,
          retryItemId
        });

        setFailedUploads((current) => {
          const nextRetryItems = retryItems.map((retryItem) => {
            const previous = current.find((item) => item.id === retryItem.id);
            return previous ? { ...retryItem, attempts: previous.attempts + 1 } : retryItem;
          });
          const withoutRetried = retryItemId ? current.filter((item) => item.id !== retryItemId) : current;
          return [...nextRetryItems, ...withoutRetried].slice(0, 12);
        });

        const failureDetails = failedItems
          .slice(0, 3)
          .map((item) => `${item.file_name ?? "未知文件"}：${item.error ?? "未返回失败原因"}`)
          .join("；");
        setNotice(`已处理 ${totalCount} 份资料，成功 ${readyCount} 份，失败 ${failedCount} 份。${failureDetails}`);
      } else if (readyCount > 0) {
        if (retryItemId) {
          setFailedUploads((current) => current.filter((item) => item.id !== retryItemId));
        }
        setNotice(`已上传 ${readyCount} 份资料并生成 ${chunkCount} 个知识分片。新资料默认为草稿，请在资料治理中提交审核并发布后再用于员工问答。`);
      } else if (processingCount > 0) {
        if (retryItemId) {
          setFailedUploads((current) => current.filter((item) => item.id !== retryItemId));
        }
        setNotice(`已提交 ${processingCount} 份资料进入后台处理。页面会自动刷新状态，处理完成后可预览分片并发布。`);
      } else {
        if (retryItemId) {
          setFailedUploads((current) => current.filter((item) => item.id !== retryItemId));
        }
        setNotice("资料已提交处理。OpenAI File Search 可能需要一点时间完成索引，请稍后点击“刷新状态”。");
      }
    } catch (error) {
      if (retryItemId) {
        setFailedUploads((current) =>
          current.map((item) =>
            item.id === retryItemId
              ? {
                  ...item,
                  attempts: item.attempts + 1,
                  error: error instanceof Error ? error.message : "上传失败",
                  last_attempt_at: new Date().toISOString()
                }
              : item
          )
        );
      }
      setNotice(error instanceof Error ? error.message : "上传失败");
    } finally {
      if (retryItemId) {
        setRetryingUploadId(null);
      } else {
        setUploading(false);
      }
    }
  }

  function retryFailedUpload(item: FailedUploadRetryItem) {
    const formData = new FormData();
    formData.append("file", item.file, item.file.name);
    if (item.change_note) {
      formData.set("change_note", item.change_note);
    }

    void uploadDocument(formData, {
      retryItemId: item.id,
      knowledgeBaseId: item.knowledge_base_id,
      department: item.department
    });
  }

  function dismissFailedUpload(itemId: string) {
    setFailedUploads((current) => current.filter((item) => item.id !== itemId));
  }

  async function loadDocumentPreview(document: DocumentRecord, offset = 0, targetChunkId: string | null = null) {
    setPreviewLoadingId(document.id);
    setNotice(null);
    setPreviewError(null);
    setTargetPreviewChunkId(targetChunkId);
    const previewOffset = Math.max(offset, 0);
    let lastError: unknown = null;

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const params = new URLSearchParams({
        limit: "160",
        offset: String(previewOffset)
      });
      if (targetChunkId) {
        params.set("chunk", targetChunkId);
      }

      try {
        const response = await fetch(`/api/documents/${document.id}/preview?${params.toString()}`, {
          cache: "no-store"
        });
        const text = await response.text();
        const data = text ? JSON.parse(text) : {};

        if (!response.ok) {
          throw new Error(typeof data.error === "string" ? data.error : "读取识别预览失败");
        }

        setDocumentPreview(data);
        setPreviewError(null);
        setPreviewLoadingId(null);
        return;
      } catch (error) {
        lastError = error;
        if (attempt < 3) {
          await waitForPreviewRetry(attempt * 800);
        }
      }
    }

    const message = lastError instanceof Error ? lastError.message : "读取识别预览失败";
    setPreviewError({
      document,
      offset: previewOffset,
      targetChunkId,
      message: `资料「${document.title}」预览暂时加载失败：${message}`
    });
    setNotice(message);
    setPreviewLoadingId(null);
  }

  function openGovernanceAudit(item: GovernanceAuditRecord) {
    const document = documents.find((candidate) => candidate.id === item.document_id);
    if (!document) {
      setNotice("这条审计对应的资料当前未加载，刷新后再试。");
      return;
    }

    void loadDocumentPreview(document, 0, item.chunk_id);
  }

  async function saveChunkGovernance(chunk: DocumentPreview["chunks"][number], input: ChunkGovernanceInput) {
    if (!documentPreview) {
      return;
    }

    setChunkGovernanceWorkingId(`meta:${chunk.id}`);
    setNotice(null);

    try {
      const response = await fetch(`/api/documents/${documentPreview.document.id}/chunks/${chunk.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input)
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "保存分片治理信息失败");
      }

      setDocumentPreview((current) => current
        ? {
            ...current,
            chunks: current.chunks.map((item) => item.id === chunk.id ? data.chunk : item)
          }
        : current
      );
      setChunkMetadataSuggestions((current) => {
        if (!current[chunk.id]) {
          return current;
        }

        const next = { ...current };
        delete next[chunk.id];
        return next;
      });
      await refresh({ silent: true, rethrow: false });
      setNotice(`分片摘要和同义词已保存，后续本地检索会参与召回。${formatRetestQueueNotice(data.retest_queue)}`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "保存分片治理信息失败");
    } finally {
      setChunkGovernanceWorkingId(null);
    }
  }

  async function splitChunk(chunk: DocumentPreview["chunks"][number], parts: string[]) {
    if (!documentPreview) {
      return;
    }

    setChunkGovernanceWorkingId(`split:${chunk.id}`);
    setNotice(null);

    try {
      const response = await fetch(`/api/documents/${documentPreview.document.id}/chunks/${chunk.id}/split`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parts })
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "拆分分片失败");
      }

      await refresh({ silent: true, rethrow: false });
      await loadDocumentPreview(documentPreview.document, documentPreview.preview_offset ?? 0);
      setNotice(`分片已拆分，当前资料共 ${data.total_chunks ?? "多"} 个分片，已生成治理前版本快照。${formatRetestQueueNotice(data.retest_queue)}`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "拆分分片失败");
    } finally {
      setChunkGovernanceWorkingId(null);
    }
  }

  async function mergeChunk(chunk: DocumentPreview["chunks"][number], direction: "previous" | "next") {
    if (!documentPreview) {
      return;
    }

    setChunkGovernanceWorkingId(`merge:${direction}:${chunk.id}`);
    setNotice(null);

    try {
      const response = await fetch(`/api/documents/${documentPreview.document.id}/chunks/${chunk.id}/merge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ direction })
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "合并分片失败");
      }

      await refresh({ silent: true, rethrow: false });
      await loadDocumentPreview(documentPreview.document, documentPreview.preview_offset ?? 0);
      setNotice(`分片已合并，当前资料共 ${data.total_chunks ?? "多"} 个分片，已生成治理前版本快照。${formatRetestQueueNotice(data.retest_queue)}`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "合并分片失败");
    } finally {
      setChunkGovernanceWorkingId(null);
    }
  }

  async function generateChunkMetadataSuggestions(chunks: DocumentPreview["chunks"]) {
    if (!documentPreview) {
      return;
    }

    const targets = chunks.filter(needsChunkMetadataSuggestion).slice(0, 12);

    if (targets.length === 0) {
      setNotice("当前页面/段落的分片都已有摘要、关键词和同义词。");
      return;
    }

    setChunkSuggestionWorking(true);
    setNotice(null);

    try {
      const response = await fetch(`/api/documents/${documentPreview.document.id}/chunks/suggestions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chunk_ids: targets.map((chunk) => chunk.id),
          only_missing: true
        })
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "生成分片建议失败");
      }

      const suggestions = cleanChunkMetadataSuggestions(data.suggestions);
      setChunkMetadataSuggestions((current) => ({
        ...current,
        ...Object.fromEntries(suggestions.map((suggestion) => [suggestion.chunk_id, suggestion]))
      }));
      setNotice(
        suggestions.length > 0
          ? `已生成 ${suggestions.length} 条分片治理建议，请展开对应分片确认后保存。`
          : data.message ?? "没有生成新的分片治理建议。"
      );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "生成分片建议失败");
    } finally {
      setChunkSuggestionWorking(false);
    }
  }

  async function startChunkMetadataSuggestionJob() {
    if (!activeKb) {
      setNotice("请先选择知识库。");
      return;
    }

    const missingCount = activeChunkSuggestionStats?.missing_chunks ?? 0;
    const pendingCount = activeChunkSuggestionStats?.pending_suggestions ?? 0;
    if (missingCount === 0) {
      setNotice(pendingCount > 0 ? "当前知识库已有待确认建议，请先预览资料并保存治理结果。" : "当前知识库没有需要生成建议的分片。");
      return;
    }

    const batchLimit = 80;
    if (!(await requestAdminConfirm({
      title: "启动全库治理队列？",
      description: `确认为「${activeKb.name}」启动全库分片治理建议吗？`,
      details: [
        `本次最多处理 ${Math.min(missingCount, batchLimit)} 个缺摘要/关键词的分片。`,
        "生成后不会自动覆盖正式知识，需要管理员在待确认台里保存。"
      ],
      confirmLabel: "启动队列",
      tone: "warning"
    }))) {
      return;
    }

    setChunkSuggestionJobStarting(true);
    setNotice(null);

    try {
      const response = await fetch("/api/documents/chunks/suggestion-jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          knowledge_base_id: activeKb.id,
          limit: batchLimit
        })
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "启动全库治理队列失败");
      }

      setChunkSuggestionJobs((current) => {
        const job = data.job as ChunkMetadataSuggestionJob;
        return [job, ...current.filter((item) => item.id !== job.id)];
      });
      setNotice("全库分片治理建议已进入后台队列，页面会自动刷新进度。");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "启动全库治理队列失败");
    } finally {
      setChunkSuggestionJobStarting(false);
    }
  }

  async function openPendingChunkSuggestion(item: PendingChunkMetadataSuggestion) {
    const document = documents.find((candidate) => candidate.id === item.document_id);
    if (!document) {
      setNotice("没有找到这条建议关联的资料，可能资料已被删除。");
      return;
    }

    setSelectedKb(item.knowledge_base_id);
    await loadDocumentPreview(document, 0, item.chunk_id);
  }

  async function revokePendingChunkSuggestions(items: PendingChunkMetadataSuggestion[]) {
    if (items.length === 0) {
      return;
    }

    if (!(await requestAdminConfirm({
      title: items.length === 1 ? "撤销这条治理建议？" : `撤销 ${items.length} 条治理建议？`,
      description: items.length === 1
        ? `确认撤销「${items[0].document_title}」第 ${items[0].chunk_index + 1} 个分片的 AI 治理建议吗？`
        : "确认撤销所选 AI 治理建议吗？",
      details: [
        "正式知识不会被修改。",
        "撤销后这些待确认摘要、关键词和同义词建议会从确认台移除。"
      ],
      confirmLabel: "确认撤销",
      tone: "danger"
    }))) {
      return;
    }

    const chunkIds = items.map((item) => item.chunk_id);
    const workingId = items.length === 1 ? chunkIds[0] : "batch";
    setPendingSuggestionWorkingId(workingId);
    setNotice(null);

    try {
      const response = await fetch("/api/documents/chunks/pending-suggestions", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chunk_ids: chunkIds })
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "撤销治理建议失败");
      }

      const removedIds = new Set(chunkIds);
      setPendingChunkSuggestions((current) => current.filter((item) => !removedIds.has(item.chunk_id)));
      setChunkMetadataSuggestions((current) => {
        const next = { ...current };
        for (const chunkId of removedIds) {
          delete next[chunkId];
        }
        return next;
      });
      setDocumentPreview((current) => current
        ? {
            ...current,
            chunks: current.chunks.map((chunk) => {
              if (!removedIds.has(chunk.id) || !chunk.metadata.pending_suggestion) {
                return chunk;
              }

              const metadata = { ...chunk.metadata };
              delete metadata.pending_suggestion;
              return { ...chunk, metadata };
            })
          }
        : current
      );
      await refresh({ silent: true, rethrow: false });
      setNotice(`已撤销 ${data.removed ?? chunkIds.length} 条待确认治理建议。`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "撤销治理建议失败");
    } finally {
      setPendingSuggestionWorkingId(null);
    }
  }

  async function applyPendingChunkSuggestions(items: PendingChunkMetadataSuggestion[]) {
    if (items.length === 0) {
      setNotice("请先勾选要保存的治理建议。");
      return;
    }

    const previewLines = items.slice(0, 3).map((item) => `- ${item.document_title} #${item.chunk_index + 1}`);
    const moreText = items.length > 3 ? `\n...还有 ${items.length - 3} 条` : "";
    if (!(await requestAdminConfirm({
      title: "保存治理建议到正式知识？",
      description: `确认把 ${items.length} 条 AI 治理建议写入正式摘要、关键词和同义词吗？`,
      details: [
        ...previewLines,
        ...(moreText ? [moreText.trim()] : []),
        "保存后会清除待确认状态，并参与后续本地检索召回。"
      ],
      confirmLabel: "确认保存",
      tone: "warning"
    }))) {
      return;
    }

    const chunkIds = items.map((item) => item.chunk_id);
    const appliedMap = new Map(items.map((item) => [item.chunk_id, item]));
    setPendingSuggestionWorkingId("apply");
    setNotice(null);

    try {
      const response = await fetch("/api/documents/chunks/pending-suggestions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chunk_ids: chunkIds })
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "保存治理建议失败");
      }

      const appliedIds = new Set(chunkIds);
      setPendingChunkSuggestions((current) => current.filter((item) => !appliedIds.has(item.chunk_id)));
      setSelectedPendingSuggestionIds((current) => current.filter((chunkId) => !appliedIds.has(chunkId)));
      setChunkMetadataSuggestions((current) => {
        const next = { ...current };
        for (const chunkId of appliedIds) {
          delete next[chunkId];
        }
        return next;
      });
      setDocumentPreview((current) => current
        ? {
            ...current,
            chunks: current.chunks.map((chunk) => {
              const suggestion = appliedMap.get(chunk.id);
              if (!suggestion) {
                return chunk;
              }

              const metadata = {
                ...chunk.metadata,
                summary: suggestion.summary,
                keywords: suggestion.keywords,
                synonyms: suggestion.synonyms
              };
              delete metadata.pending_suggestion;
              return { ...chunk, metadata };
            })
          }
        : current
      );
      await refresh({ silent: true, rethrow: false });
      setNotice(`已保存 ${data.applied ?? chunkIds.length} 条治理建议，后续检索会使用这些摘要和同义词。${formatRetestQueueNotice(data.retest_queue)}`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "保存治理建议失败");
    } finally {
      setPendingSuggestionWorkingId(null);
    }
  }

  async function loadDocumentVersionCompare(version: DocumentVersion, offset = 0) {
    if (!version.document_id) {
      setNotice("这条版本记录没有关联资料，无法对比。");
      return;
    }

    setVersionCompareLoadingId(version.id);
    setNotice(null);

    try {
      const params = new URLSearchParams({
        limit: "40",
        offset: String(Math.max(offset, 0))
      });
      const response = await fetch(
        `/api/documents/${version.document_id}/versions/${version.id}/compare?${params.toString()}`,
        { cache: "no-store" }
      );
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "读取版本对比失败");
      }

      setVersionCompare(data);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "读取版本对比失败");
    } finally {
      setVersionCompareLoadingId(null);
    }
  }

  async function reprocessDocument(document: DocumentRecord) {
    const diagnostic = documentDiagnostics[document.id];

    if (diagnostic ? !diagnostic.can_reprocess : !document.storage_path) {
      setNotice(`资料「${document.title}」没有保留原文件，无法直接重新识别。请重新上传原文件。`);
      return;
    }

    if (!(await requestAdminConfirm({
      title: "重新识别资料？",
      description: `确认重新识别「${document.title}」吗？`,
      details: [
        "成功后会刷新可检索文本并生成新版本。",
        "如果 OCR 或解析服务仍不可用，资料会记录新的失败原因。"
      ],
      confirmLabel: "重新识别",
      tone: "warning"
    }))) {
      return;
    }

    setReprocessingId(document.id);
    setNotice(null);

    try {
      const response = await fetch(`/api/documents/${document.id}/reprocess`, {
        method: "POST"
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "重新识别失败");
      }

      await refresh();
      setDocumentPreview(null);
      setNotice(data.message ?? "资料已进入后台重新识别队列，页面会自动刷新状态。");
    } catch (error) {
      await refresh();
      setNotice(error instanceof Error ? error.message : "重新识别失败");
    } finally {
      setReprocessingId(null);
    }
  }

  function toggleDocumentSelection(documentId: string) {
    setSelectedDocumentIds((current) =>
      current.includes(documentId) ? current.filter((id) => id !== documentId) : [...current, documentId]
    );
  }

  function toggleAllActiveDocuments() {
    if (allActiveDocumentsSelected) {
      setSelectedDocumentIds([]);
      return;
    }

    setSelectedDocumentIds(activeDocuments.map((document) => document.id));
  }

  async function runBulkWorkflow(
    action: "submit_review" | "approve_review" | "publish" | "archive",
    label: string,
    filter: (document: DocumentRecord) => boolean,
    confirmInput?: ActionConfirmRequest
  ) {
    const targets = selectedDocuments.filter(filter);
    const skipped = selectedDocuments.length - targets.length;

    if (targets.length === 0) {
      setNotice(`没有符合「${label}」条件的资料。`);
      return;
    }

    if (confirmInput && !(await requestAdminConfirm(confirmInput))) {
      return;
    }

    setBulkWorking(action);
    setNotice(null);

    try {
      const response = await fetch("/api/document-approvals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, document_ids: targets.map((document) => document.id) })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok && !data.success_count) throw new Error(data.error ?? data.errors?.[0]?.error ?? "操作失败");

      await refresh();
      setSelectedDocumentIds([]);

      const skippedText = skipped > 0 ? `，跳过 ${skipped} 份不符合条件的资料` : "";
      const failureText = data.failure_count > 0 ? `，失败 ${data.failure_count} 份：${data.errors?.slice(0, 2).map((item: { error: string }) => item.error).join("；")}` : "";
      setNotice(`批量${label}完成：成功 ${data.success_count ?? 0} 份${skippedText}${failureText}`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : `批量${label}后刷新失败`);
    } finally {
      setBulkWorking(null);
    }
  }

  async function runBulkReprocess() {
    if (selectedDocuments.length === 0) {
      setNotice("请先选择要重新识别的资料。");
      return;
    }

    const targets = selectedDocuments.filter((document) =>
      documentDiagnostics[document.id]?.can_reprocess ?? Boolean(document.storage_path)
    );
    const skipped = selectedDocuments.length - targets.length;

    if (targets.length === 0) {
      setNotice("选中的资料都没有保留原文件，无法直接重新识别。请重新上传原文件。");
      return;
    }

    const skippedText = skipped > 0 ? `，其中 ${skipped} 份没有原文件会跳过` : "";
    if (!(await requestAdminConfirm({
      title: "批量重新识别资料？",
      description: `确认重新识别 ${targets.length} 份资料吗${skippedText}？`,
      details: [
        "成功后会刷新可检索文本并生成新版本。",
        "没有保留原文件的资料会被跳过。"
      ],
      confirmLabel: "批量重新识别",
      tone: "warning"
    }))) {
      return;
    }

    setBulkWorking("reprocess");
    setNotice(null);

    const failures: string[] = [];
    let success = 0;

    try {
      for (const document of targets) {
        try {
          const response = await fetch(`/api/documents/${document.id}/reprocess`, {
            method: "POST"
          });
          const data = await response.json().catch(() => ({}));

          if (!response.ok) {
            throw new Error(data.error ?? "重新识别失败");
          }

          success += 1;
        } catch (error) {
          failures.push(`${document.title}：${error instanceof Error ? error.message : "重新识别失败"}`);
        }
      }

      await refresh();
      setSelectedDocumentIds([]);

      const finalSkippedText = skipped > 0 ? `，跳过 ${skipped} 份未保留原文件的资料` : "";
      const failureText = failures.length > 0 ? `，失败 ${failures.length} 份：${failures.slice(0, 2).join("；")}` : "";
      setNotice(`批量重新识别完成：成功 ${success} 份${finalSkippedText}${failureText}`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "批量重新识别后刷新失败");
    } finally {
      setBulkWorking(null);
    }
  }

  async function runBulkDelete() {
    if (selectedDocuments.length === 0) {
      setNotice("请先选择要删除的资料。");
      return;
    }

    if (!(await requestAdminConfirm({
      title: "批量删除资料？",
      description: `确认删除选中的 ${selectedDocuments.length} 份资料吗？`,
      details: [
        "会同时清理对应知识分片和远端文件。",
        "删除后无法恢复，请确认这些资料已经不再需要。"
      ],
      confirmLabel: "确认删除",
      tone: "danger"
    }))) {
      return;
    }

    setBulkWorking("delete");
    setNotice(null);

    const failures: string[] = [];
    let success = 0;

    try {
      for (const document of selectedDocuments) {
        try {
          const response = await fetch(`/api/documents/${document.id}`, {
            method: "DELETE"
          });
          const data = await response.json().catch(() => ({}));

          if (!response.ok) {
            throw new Error(data.error ?? "删除失败");
          }

          success += 1;
        } catch (error) {
          failures.push(`${document.title}：${error instanceof Error ? error.message : "删除失败"}`);
        }
      }

      await refresh();
      setSelectedDocumentIds([]);

      const failureText = failures.length > 0 ? `，失败 ${failures.length} 份：${failures.slice(0, 2).join("；")}` : "";
      setNotice(`批量删除完成：成功 ${success} 份${failureText}`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "批量删除后刷新失败");
    } finally {
      setBulkWorking(null);
    }
  }

  async function saveDocumentGovernance(
    document: DocumentRecord,
    input: {
      security_level: DocumentSecurityLevel;
      publish_status?: DocumentPublishStatus;
      version_id?: string;
      action?: "submit_review" | "approve_review" | "publish" | "archive" | "restore_draft";
      acl_departments: string[];
      acl_positions: string[];
      acl_roles: Array<"admin" | "employee">;
      acl_users: string[];
    }
  ) {
    setDeletingId(`save:${document.id}`);
    setNotice(null);

    try {
      const response = await fetch(`/api/documents/${document.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input)
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "保存资料治理配置失败");
      }

      setDocuments((current) => current.map((item) => (item.id === document.id ? data.document : item)));
      setNotice(input.action ? "资料审批状态已更新。" : "资料权限治理配置已保存。");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "保存资料治理配置失败");
    } finally {
      setDeletingId(null);
    }
  }

  async function rollbackDocumentVersion(version: DocumentVersion) {
    if (!version.document_id) {
      setNotice("这条版本记录没有关联资料，无法回滚。");
      return;
    }

    if (!(await requestAdminConfirm({
      title: "回滚资料版本？",
      description: `确认基于 v${version.version}「${version.title}」发起发布回退审批吗？`,
      details: [
        "系统会生成新的回退候选版本并提交审核。",
        "审核通过并正式发布前，该回退版本不会进入员工问答。"
      ],
      confirmLabel: "提交回退审批",
      tone: "warning"
    }))) {
      return;
    }

    setDeletingId(`rollback:${version.id}`);
    setNotice(null);

    try {
      const response = await fetch(`/api/documents/${version.document_id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "rollback_version",
          version_id: version.id,
          comment: `发布回退到 v${version.version}${version.change_note ? `：${version.change_note}` : ""}`
        })
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "版本回滚失败");
      }

      await refresh();
      setNotice(`已基于 v${version.version} 生成回退候选，并提交审批。`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "版本回滚失败");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <>
    <div className="space-y-5">
      <section className="ui-card p-5 shadow-soft">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-xl font-semibold text-ink">知识管理</h1>
            <p className="mt-1 text-sm text-slate-500">创建托管知识库，上传企业资料，供员工对话时检索。</p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="rounded-lg bg-cyan/10 px-3 py-2 text-sm text-brand">
              {isLocalTextRag
                ? "RAG 模式：本地文本检索"
                : activeKb?.openai_vector_store_id
                ? `Vector Store: ${activeKb.openai_vector_store_id}`
                : "未绑定 OpenAI vector store"}
            </div>
            {activeKb && !activeKb.openai_vector_store_id && !isLocalTextRag && (
              <button
                type="button"
                onClick={() => void provisionVectorStore()}
                disabled={provisioning}
                className="ui-button-primary h-11 px-3 sm:h-9"
              >
                {provisioning ? <Loader2 className="animate-spin" size={16} /> : <Plus size={16} />}
                创建 Vector Store
              </button>
            )}
          </div>
        </div>
      </section>

      {initialLoading && <DocumentsAdminSkeleton />}

      {loadError && !initialLoading && !hasLoadedContent && (
        <ErrorRetry
          title="知识管理加载失败"
          message={loadError}
          retrying={initialLoading}
          onRetry={() => {
            setInitialLoading(true);
            void refresh({ rethrow: false, silent: true });
          }}
        />
      )}

      {!initialLoading && (!loadError || hasLoadedContent) && (
        <>
          <UploadReadiness
            activeKb={activeKb}
            stats={activeDocumentStats}
            ragProvider={ragProvider}
            onProvision={() => void provisionVectorStore()}
            provisioning={provisioning}
          />

          <div className="grid min-w-0 gap-5 xl:grid-cols-[420px_minmax(0,1fr)]">
        <section className="min-w-0 space-y-5">
          <div className="ui-card p-5">
          <div className="flex items-center gap-2">
            <Database size={18} className="text-brand" />
            <h2 className="text-base font-semibold text-ink">创建知识库</h2>
          </div>
          <div className="mt-4 space-y-3">
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="例如：HR 制度与新员工培训"
              className="ui-input h-11 w-full"
            />
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="说明这个知识库包含哪些资料"
              className="ui-input min-h-24 w-full resize-none py-3"
            />
            <button
              onClick={() => void createKb()}
              disabled={creating}
              className="ui-button-primary h-11 sm:h-10"
            >
              {creating ? <Loader2 className="animate-spin" size={16} /> : <Plus size={16} />}
              创建知识库
            </button>
          </div>

          <div className="mt-6 space-y-2">
            {knowledgeBases.map((kb) => (
              <button
                key={kb.id}
                onClick={() => setSelectedKb(kb.id)}
                className={`w-full rounded-lg border px-3 py-3 text-left transition ${
                  activeKb?.id === kb.id ? "border-cyan bg-cyan/10" : "border-line hover:bg-slate-50"
                }`}
              >
                <span className="block text-sm font-semibold text-ink">{kb.name}</span>
                <span className="mt-1 block text-xs text-slate-500">{kb.description ?? "暂无说明"}</span>
                <span className="mt-2 inline-flex rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-600">
                  {knowledgeBaseLabel(kb)}
                </span>
              </button>
            ))}
            {knowledgeBases.length === 0 && <KnowledgeBaseEmptyState />}
          </div>
          </div>

          <div className="ui-card p-5">
            <div className="flex items-center gap-2">
              <Shield size={18} className="text-brand" />
              <h2 className="text-base font-semibold text-ink">权限配置</h2>
            </div>
            {activeKb ? (
              <div className="mt-4 space-y-3">
                <input
                  value={editName}
                  onChange={(event) => setEditName(event.target.value)}
                  placeholder="知识库名称"
                  className="ui-input h-11 w-full"
                />
                <textarea
                  value={editDescription}
                  onChange={(event) => setEditDescription(event.target.value)}
                  placeholder="知识库说明"
                  className="ui-input min-h-20 w-full resize-none py-3"
                />
                <select
                  value={editVisibility}
                  onChange={(event) => setEditVisibility(event.target.value as KnowledgeBase["visibility"])}
                  className="ui-input h-11 w-full"
                >
                  <option value="all">全员可见</option>
                  <option value="department">指定部门</option>
                  <option value="position">指定岗位</option>
                  <option value="admin_only">仅管理员</option>
                </select>
                {editVisibility === "department" && (
                  <textarea
                    value={editDepartments}
                    onChange={(event) => setEditDepartments(event.target.value)}
                    placeholder="部门名称，多个用逗号或换行分隔"
                    className="ui-input min-h-20 w-full resize-none py-3"
                  />
                )}
                {editVisibility === "position" && (
                  <textarea
                    value={editPositions}
                    onChange={(event) => setEditPositions(event.target.value)}
                    placeholder="岗位名称，多个用逗号或换行分隔"
                    className="ui-input min-h-20 w-full resize-none py-3"
                  />
                )}
                <div className="flex flex-col gap-2 sm:flex-row">
                  <button
                    type="button"
                    onClick={() => void saveKnowledgeBase()}
                    disabled={savingKb}
                    className="ui-button-primary h-11 sm:h-10"
                  >
                    {savingKb ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />}
                    保存配置
                  </button>
                  <button
                    type="button"
                    onClick={() => void deleteKnowledgeBase()}
                    disabled={deletingId === activeKb.id}
                    className="ui-button-danger h-11 sm:h-10"
                  >
                    {deletingId === activeKb.id ? <Loader2 className="animate-spin" size={16} /> : <Trash2 size={16} />}
                    删除知识库
                  </button>
                </div>
              </div>
            ) : (
              <p className="mt-4 rounded-lg border border-dashed border-line bg-slate-50 px-4 py-6 text-sm leading-6 text-slate-500">
                先创建一个知识库，再配置可见范围。
              </p>
            )}
          </div>
        </section>

        <section className="ui-card min-w-0 p-5">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-2">
              <FileUp size={18} className="text-brand" />
              <h2 className="text-base font-semibold text-ink">上传资料</h2>
            </div>
            <button
              type="button"
              onClick={() => void refreshDocumentStatuses()}
              disabled={refreshing || documents.length === 0 || !hasPendingDocuments}
              className="ui-button-secondary h-11 px-3 sm:h-9"
              title={!hasPendingDocuments ? "没有待刷新的资料" : "刷新处理状态"}
            >
              {refreshing ? <Loader2 className="animate-spin" size={16} /> : <RefreshCw size={16} />}
              刷新状态
            </button>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-4">
            <DocumentMetric label="全部资料" value={activeDocumentStats.total} />
            <DocumentMetric label="可检索" value={activeDocumentStats.ready} tone="good" />
            <DocumentMetric label="处理中" value={activeDocumentStats.uploading + activeDocumentStats.processing} tone="warn" />
            <DocumentMetric label="失败" value={activeDocumentStats.failed} tone="bad" />
          </div>
          <form
            className="mt-4 grid min-w-0 gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_160px]"
            onSubmit={(event) => {
              event.preventDefault();
              void uploadDocument(new FormData(event.currentTarget));
              event.currentTarget.reset();
            }}
          >
            <input
              name="file"
              type="file"
              accept=".pdf,.txt,.md,.docx,.pptx,.xlsx,image/*"
              multiple
              className="min-w-0 rounded-lg border border-line px-3 py-2 text-sm"
              required
            />
            <input
              name="change_note"
              placeholder="版本说明，例如：补充安全培训第 2 版"
              className="ui-input h-11 min-w-0"
            />
            {activeKb?.visibility === "department" && (
              <input type="hidden" name="department" value={activeKb.departments[0] ?? ""} />
            )}
            <button
              disabled={uploading || !canUpload}
              title={!canUpload ? "请先创建 Vector Store 或切换 local_text 模式" : "上传入库"}
              className="ui-button-success h-11"
            >
              {uploading ? <Loader2 className="animate-spin" size={16} /> : <FileUp size={16} />}
              批量入库
            </button>
          </form>
          {failedUploads.length > 0 && (
            <FailedUploadRetryPanel
              items={failedUploads}
              retryingId={retryingUploadId}
              onRetry={retryFailedUpload}
              onDismiss={dismissFailedUpload}
              onClear={() => setFailedUploads([])}
            />
          )}
          {!canUpload && (
            <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              {isLocalTextRag
                ? "请先创建或选择一个知识库。local_text 模式会把可解析文字切块存入当前数据库，不需要 Vector Store。"
                : "上传前需要先给当前知识库创建 Vector Store。创建完成后，资料会同步到 OpenAI File Search。"}
            </div>
          )}
          {activeDocumentStats.ready > 0 && (
            <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
              当前知识库已有可检索资料，可以进入员工端发起测试问答并检查来源引用。
            </div>
          )}
          <div className="mt-3 rounded-lg border border-cyan/20 bg-cyan/10 px-3 py-2 text-sm text-brand">
            新资料默认草稿。解析完成后，请在“权限治理”中提交审核并审核发布，发布后才会进入员工端检索。
          </div>
          {ocrStatus && (
            <OcrStatusPanel
              status={ocrStatus}
              failedCount={activeDocumentStats.failed}
              ocrCandidateCount={activeDocuments.filter((document) => documentDiagnostics[document.id]?.ocr_applicable).length}
            />
          )}
          <DocumentAttentionPanel
            documents={activeDocuments}
            diagnostics={documentDiagnostics}
            reprocessingId={reprocessingId}
            onReprocess={(document) => void reprocessDocument(document)}
          />
          <DocumentQualityPanel
            documents={activeDocuments}
            diagnostics={documentDiagnostics}
            previewLoadingId={previewLoadingId}
            reprocessingId={reprocessingId}
            onPreview={(document) => void loadDocumentPreview(document)}
            onReprocess={(document) => void reprocessDocument(document)}
          />
          <DocumentPermissionTemplateManager
            templates={permissionTemplates}
            users={users}
            departments={aclDepartments}
            positions={aclPositions}
            onChanged={() => refresh({ silent: true, rethrow: false })}
          />
          {activeKb && activeDocumentStats.ready > 0 && (
            <ChunkSuggestionQueuePanel
              stats={activeChunkSuggestionStats}
              job={activeChunkSuggestionJob}
              starting={chunkSuggestionJobStarting}
              onStart={() => void startChunkMetadataSuggestionJob()}
            />
          )}
          <PendingSuggestionReviewPanel
            activeKnowledgeBaseName={activeKb?.name ?? "当前知识库"}
            activeCount={activePendingChunkSuggestions.length}
            allCount={pendingChunkSuggestions.length}
            scope={pendingSuggestionScope}
            suggestions={visiblePendingChunkSuggestions}
            selectedIds={selectedPendingSuggestionIds}
            workingId={pendingSuggestionWorkingId}
            onScopeChange={setPendingSuggestionScope}
            onSelectionChange={setSelectedPendingSuggestionIds}
            onApplySelected={() => void applyPendingChunkSuggestions(selectedPendingChunkSuggestions)}
            onRevokeSelected={() => void revokePendingChunkSuggestions(selectedPendingChunkSuggestions)}
            onOpen={(item) => void openPendingChunkSuggestion(item)}
            onRevoke={(item) => void revokePendingChunkSuggestions([item])}
          />
          <GovernanceAuditPanel
            activeKnowledgeBaseName={activeKb?.name ?? "当前知识库"}
            activeCount={activeGovernanceAudits.length}
            allCount={governanceAudits.length}
            audits={activeGovernanceAudits.slice(0, 12)}
            onOpen={(item) => openGovernanceAudit(item)}
          />

          {selectedDocuments.length > 0 && (
            <div className="mt-4 rounded-lg border border-cyan/20 bg-cyan/5 px-3 py-3">
              <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                <p className="text-sm font-medium text-brand">
                  已选择 {selectedDocuments.length} 份资料
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      void runBulkWorkflow(
                        "submit_review",
                        "提交审核",
                        (document) => document.publish_status === "draft",
                        {
                          title: "批量提交审核？",
                          description: `确认提交选中的 ${selectedDocuments.length} 份资料进入审核吗？`,
                          details: [
                            "只有草稿资料会被提交，其他状态会自动跳过。",
                            "提交后仍需审核发布，员工端暂不会检索这些草稿。"
                          ],
                          confirmLabel: "提交审核",
                          tone: "info"
                        }
                      )
                    }
                    disabled={Boolean(bulkWorking)}
                    className="ui-button-secondary h-11 px-3 text-xs sm:h-9"
                  >
                    {bulkWorking === "submit_review" ? <Loader2 className="animate-spin" size={14} /> : <Clock size={14} />}
                    提交审核
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      void runBulkWorkflow(
                        "approve_review",
                        "审核通过",
                        (document) => document.status === "ready" && document.publish_status === "pending_review",
                        {
                          title: "批量审核通过？",
                          description: `确认通过选中的 ${selectedDocuments.length} 份资料吗？`,
                          details: [
                            "只有已解析完成且待审核的资料会被处理。",
                            "通过后仍需正式发布，员工端暂时无法检索。"
                          ],
                          confirmLabel: "审核通过",
                          tone: "warning"
                        }
                      )
                    }
                    disabled={Boolean(bulkWorking)}
                    className="ui-button-success h-11 px-3 text-xs sm:h-9"
                  >
                    {bulkWorking === "approve_review" ? <Loader2 className="animate-spin" size={14} /> : <CheckCircle2 size={14} />}
                    审核通过
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      void runBulkWorkflow(
                        "publish",
                        "发布",
                        (document) => document.status === "ready" && document.publish_status === "approved",
                        {
                          title: "批量发布资料？",
                          description: `确认发布选中的 ${selectedDocuments.length} 份资料吗？`,
                          details: [
                            "只有审核通过的资料会被发布。",
                            "发布后符合权限范围的员工可以在问答中检索。"
                          ],
                          confirmLabel: "确认发布",
                          tone: "warning"
                        }
                      )
                    }
                    disabled={Boolean(bulkWorking)}
                    className="ui-button-success h-11 px-3 text-xs sm:h-9"
                  >
                    {bulkWorking === "publish" ? <Loader2 className="animate-spin" size={14} /> : <Send size={14} />}
                    发布
                  </button>
                  <button
                    type="button"
                    onClick={() => void runBulkReprocess()}
                    disabled={Boolean(bulkWorking)}
                    className="ui-button-secondary h-11 px-3 text-xs sm:h-9"
                  >
                    {bulkWorking === "reprocess" ? <Loader2 className="animate-spin" size={14} /> : <RotateCcw size={14} />}
                    重新识别
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      void runBulkWorkflow(
                        "archive",
                        "归档",
                        (document) => document.publish_status === "published",
                        {
                          title: "批量归档资料？",
                          description: `确认归档选中的 ${selectedDocuments.length} 份资料吗？`,
                          details: [
                            "只有已发布资料会被归档。",
                            "归档后员工端不会再检索这些资料。"
                          ],
                          confirmLabel: "确认归档",
                          tone: "warning"
                        }
                      )
                    }
                    disabled={Boolean(bulkWorking)}
                    className="ui-button-secondary h-11 px-3 text-xs sm:h-9"
                  >
                    {bulkWorking === "archive" ? <Loader2 className="animate-spin" size={14} /> : <Shield size={14} />}
                    归档
                  </button>
                  <button
                    type="button"
                    onClick={() => void runBulkDelete()}
                    disabled={Boolean(bulkWorking)}
                    className="ui-button-danger h-11 px-3 text-xs sm:h-9"
                  >
                    {bulkWorking === "delete" ? <Loader2 className="animate-spin" size={14} /> : <Trash2 size={14} />}
                    删除
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedDocumentIds([])}
                    disabled={Boolean(bulkWorking)}
                    className="ui-button-secondary h-11 px-3 text-xs sm:h-9"
                  >
                    取消选择
                  </button>
                </div>
              </div>
            </div>
          )}

          <div className="mt-5 space-y-3 md:hidden">
            {activeDocuments.map((document) => {
              const diagnostic = documentDiagnostics[document.id];
              const processingJob = documentProcessingJobs[document.id];
              const needsReprocessAction = document.status === "failed" || Boolean(diagnostic?.is_stale_processing);
              const reprocessActionLabel = diagnostic?.is_stale_processing ? "重新入队" : "重新识别";
              const reprocessActionClass = document.status === "failed"
                ? "border-red-200 text-red-700 hover:bg-red-50"
                : "border-amber-200 text-amber-700 hover:bg-amber-50";
              const mobileReprocessActionClass = needsReprocessAction
                ? reprocessActionClass
                : "border-line text-slate-600 hover:bg-slate-50";

              return (
                <article key={document.id} className="rounded-lg border border-line bg-white p-4 shadow-sm">
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      checked={selectedDocumentIds.includes(document.id)}
                      onChange={() => toggleDocumentSelection(document.id)}
                      disabled={Boolean(bulkWorking)}
                      aria-label={`选择资料 ${document.title}`}
                      className="mt-1 size-5 rounded border-line text-brand focus:ring-cyan"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="break-words text-sm font-semibold leading-5 text-ink">{document.title}</p>
                      <p className="mt-1 break-all text-xs leading-5 text-slate-500">{document.file_name}</p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                          {securityLevelLabel(document.security_level)}
                        </span>
                        <span className={`rounded-full px-2 py-0.5 text-xs ${publishStatusClass(document.publish_status)}`}>
                          {publishStatusLabel(document.publish_status)}
                        </span>
                      </div>
                    </div>
                    <StatusPill status={document.status} />
                  </div>

                  <div className="mt-3 grid gap-2 text-xs leading-5 text-slate-500">
                    <p>
                      知识库：{knowledgeBases.find((kb) => kb.id === document.knowledge_base_id)?.name ?? "未知知识库"}
                      {document.department ? ` · ${document.department}` : ""}
                    </p>
                    <p>创建时间：{new Date(document.created_at).toLocaleString("zh-CN")}</p>
                    <p className="break-all">Vector 文件：{document.openai_file_id ?? "未同步"}</p>
                  </div>

                  <DocumentProcessingSummary
                    document={document}
                    diagnostic={diagnostic}
                    processingJob={processingJob}
                    ocrStatus={ocrStatus}
                  />
                  {document.status === "failed" && (
                    <DocumentFailureReason
                      document={document}
                      diagnostic={diagnostic}
                      versions={activeDocumentVersions}
                    />
                  )}
                  {diagnostic?.is_stale_processing && (
                    <DocumentStaleProcessingWarning diagnostic={diagnostic} />
                  )}

                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void loadDocumentPreview(document)}
                      disabled={previewLoadingId === document.id}
                      className="ui-button-secondary h-11 flex-1 px-3 text-xs"
                    >
                      {previewLoadingId === document.id ? <Loader2 className="animate-spin" size={14} /> : <Eye size={14} />}
                      预览
                    </button>
                    <button
                      type="button"
                      onClick={() => void reprocessDocument(document)}
                      disabled={
                        reprocessingId === document.id ||
                        ((document.status === "processing" || document.status === "uploading") && !diagnostic?.is_stale_processing)
                      }
                      className={`inline-flex h-11 flex-1 items-center justify-center gap-1.5 rounded-lg border px-3 text-xs font-medium disabled:border-line disabled:text-slate-300 ${mobileReprocessActionClass}`}
                    >
                      {reprocessingId === document.id ? <Loader2 className="animate-spin" size={14} /> : <RotateCcw size={14} />}
                      {needsReprocessAction ? reprocessActionLabel : "重新识别"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void deleteDocument(document)}
                      disabled={deletingId === document.id}
                      className="ui-button-danger h-11 flex-1 px-3 text-xs"
                    >
                      {deletingId === document.id ? <Loader2 className="animate-spin" size={14} /> : <Trash2 size={14} />}
                      删除
                    </button>
                  </div>

                  <DocumentGovernancePanel
                    document={document}
                    versions={activeDocumentVersions.filter((version) => version.document_id === document.id && version.status === "ready")}
                    permissionTemplates={permissionTemplates}
                    users={users}
                    departments={aclDepartments}
                    positions={aclPositions}
                    saving={deletingId === `save:${document.id}`}
                    onSave={(input) => void saveDocumentGovernance(document, input)}
                    onWorkflow={(action, input) => void saveDocumentGovernance(document, { ...input, action })}
                  />
                </article>
              );
            })}
            {activeDocuments.length === 0 && (
              <DocumentEmptyState activeKb={activeKb} />
            )}
          </div>

          <div className="mt-5 overflow-x-auto rounded-lg border border-line max-md:hidden">
            <table className="min-w-[860px] divide-y divide-line text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500">
                <tr>
                  <th className="w-10 px-4 py-3">
                    <input
                      type="checkbox"
                      checked={allActiveDocumentsSelected}
                      onChange={toggleAllActiveDocuments}
                      disabled={activeDocuments.length === 0 || Boolean(bulkWorking)}
                      aria-label="选择当前知识库全部资料"
                      className="size-4 rounded border-line text-brand focus:ring-cyan"
                    />
                  </th>
                  <th className="px-4 py-3">文件</th>
                  <th className="px-4 py-3">知识库</th>
                  <th className="px-4 py-3">状态</th>
                  <th className="px-4 py-3">Vector 文件</th>
                  <th className="px-4 py-3">时间</th>
                  <th className="px-4 py-3">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {activeDocuments.map((document) => {
                  const diagnostic = documentDiagnostics[document.id];
                  const processingJob = documentProcessingJobs[document.id];
                  const needsReprocessAction = document.status === "failed" || Boolean(diagnostic?.is_stale_processing);
                  const reprocessActionLabel = diagnostic?.is_stale_processing ? "重新入队" : "重新识别";
                  const reprocessActionClass = document.status === "failed"
                    ? "border-red-200 text-red-700 hover:bg-red-50"
                    : "border-amber-200 text-amber-700 hover:bg-amber-50";

                  return (
                  <tr key={document.id}>
                    <td className="px-4 py-3 align-top">
                      <input
                        type="checkbox"
                        checked={selectedDocumentIds.includes(document.id)}
                        onChange={() => toggleDocumentSelection(document.id)}
                        disabled={Boolean(bulkWorking)}
                        aria-label={`选择资料 ${document.title}`}
                        className="size-4 rounded border-line text-brand focus:ring-cyan"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-ink">{document.title}</p>
                      <p className="text-xs text-slate-500">{document.file_name}</p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                          {securityLevelLabel(document.security_level)}
                        </span>
                        <span className={`rounded-full px-2 py-0.5 text-xs ${publishStatusClass(document.publish_status)}`}>
                          {publishStatusLabel(document.publish_status)}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500">
                      {knowledgeBases.find((kb) => kb.id === document.knowledge_base_id)?.name ?? "未知知识库"}
                      {document.department && <span className="mt-1 block">部门：{document.department}</span>}
                    </td>
                    <td className="px-4 py-3">
                      <StatusPill status={document.status} />
                      <DocumentProcessingSummary
                        document={document}
                        diagnostic={diagnostic}
                        processingJob={processingJob}
                        ocrStatus={ocrStatus}
                      />
                      {document.status === "failed" && (
                        <DocumentFailureReason
                          document={document}
                          diagnostic={diagnostic}
                          versions={activeDocumentVersions}
                        />
                      )}
                      {diagnostic?.is_stale_processing && (
                        <DocumentStaleProcessingWarning diagnostic={diagnostic} />
                      )}
                      {needsReprocessAction && (
                        <button
                          type="button"
                          onClick={() => void reprocessDocument(document)}
                          disabled={reprocessingId === document.id}
                          className={`mt-2 inline-flex h-10 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium disabled:border-line disabled:text-slate-300 md:h-8 md:px-2 ${reprocessActionClass}`}
                        >
                          {reprocessingId === document.id ? <Loader2 className="animate-spin" size={14} /> : <RotateCcw size={14} />}
                          {reprocessActionLabel}
                        </button>
                      )}
                      <DocumentGovernancePanel
                        document={document}
                        versions={activeDocumentVersions.filter((version) => version.document_id === document.id && version.status === "ready")}
                        permissionTemplates={permissionTemplates}
                        users={users}
                        departments={aclDepartments}
                        positions={aclPositions}
                        saving={deletingId === `save:${document.id}`}
                        onSave={(input) => void saveDocumentGovernance(document, input)}
                        onWorkflow={(action, input) => void saveDocumentGovernance(document, { ...input, action })}
                      />
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500">{document.openai_file_id ?? "未同步"}</td>
                  <td className="px-4 py-3 text-xs text-slate-500">
                    {new Date(document.created_at).toLocaleString("zh-CN")}
                  </td>
                  <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => void loadDocumentPreview(document)}
                          disabled={previewLoadingId === document.id}
                          className="inline-flex size-8 items-center justify-center rounded-lg border border-line text-slate-600 hover:bg-slate-50 disabled:text-slate-300"
                          title="预览识别文本"
                          aria-label="预览识别文本"
                        >
                          {previewLoadingId === document.id ? <Loader2 className="animate-spin" size={15} /> : <Eye size={15} />}
                        </button>
                        <button
                          type="button"
                          onClick={() => void reprocessDocument(document)}
                          disabled={
                            reprocessingId === document.id ||
                            ((document.status === "processing" || document.status === "uploading") && !diagnostic?.is_stale_processing)
                          }
                          className="inline-flex size-8 items-center justify-center rounded-lg border border-line text-slate-600 hover:bg-slate-50 disabled:text-slate-300"
                          title="重新识别/OCR"
                          aria-label="重新识别/OCR"
                        >
                          {reprocessingId === document.id ? <Loader2 className="animate-spin" size={15} /> : <RotateCcw size={15} />}
                        </button>
                        <button
                          type="button"
                          onClick={() => void deleteDocument(document)}
                          disabled={deletingId === document.id}
                          className="inline-flex size-8 items-center justify-center rounded-lg border border-red-200 text-red-700 hover:bg-red-50 disabled:text-slate-300"
                          title="删除资料"
                          aria-label="删除资料"
                        >
                          {deletingId === document.id ? <Loader2 className="animate-spin" size={15} /> : <Trash2 size={15} />}
                        </button>
                      </div>
                  </td>
                </tr>
                  );
                })}
                {activeDocuments.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-sm text-slate-500">
                      <DocumentEmptyState activeKb={activeKb} compact />
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {previewError && (
            <div className="mt-3">
              <ErrorRetry
                title="识别预览加载失败"
                message={previewError.message}
                actionLabel="重试预览"
                retrying={previewLoadingId === previewError.document.id}
                onRetry={() => void loadDocumentPreview(previewError.document, previewError.offset, previewError.targetChunkId)}
              />
            </div>
          )}

          {documentPreview && (
            <DocumentPreviewPanel
              preview={documentPreview}
              loading={previewLoadingId === documentPreview.document.id}
              targetChunkId={targetPreviewChunkId}
              chunkWorkingId={chunkGovernanceWorkingId}
              chunkSuggestionWorking={chunkSuggestionWorking}
              chunkMetadataSuggestions={chunkMetadataSuggestions}
              onPageChange={(offset) => void loadDocumentPreview(documentPreview.document, offset)}
              onSaveChunkGovernance={(chunk, input) => void saveChunkGovernance(chunk, input)}
              onGenerateChunkMetadataSuggestions={(chunks) => void generateChunkMetadataSuggestions(chunks)}
              onSplitChunk={(chunk, parts) => void splitChunk(chunk, parts)}
              onMergeChunk={(chunk, direction) => void mergeChunk(chunk, direction)}
              onClose={() => {
                setDocumentPreview(null);
                setChunkMetadataSuggestions({});
              }}
            />
          )}

          {versionCompare && (
            <DocumentVersionComparePanel
              compare={versionCompare}
              loading={versionCompareLoadingId === versionCompare.version.id}
              onPageChange={(offset) => void loadDocumentVersionCompare(versionCompare.version, offset)}
              onClose={() => setVersionCompare(null)}
            />
          )}

          <div className="mt-5 rounded-lg border border-line">
            <div className="border-b border-line bg-slate-50 px-4 py-3">
              <h3 className="text-sm font-semibold text-ink">资料版本记录</h3>
              <p className="mt-1 text-xs text-slate-500">记录每次上传和回滚形成的版本，便于追踪资料何时变更、处理结果和上传说明。</p>
            </div>
            <div className="divide-y divide-line">
              {activeDocumentVersions.slice(0, 12).map((version) => (
                <div key={version.id} className="grid gap-3 px-4 py-3 text-sm lg:grid-cols-[1fr_100px_110px_170px_170px] lg:items-center">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-ink">{version.title}</p>
                    <p className="mt-1 truncate text-xs text-slate-500">{version.file_name}</p>
                    {version.change_note && (
                      <p className="mt-1 text-xs leading-5 text-slate-500">说明：{version.change_note}</p>
                    )}
                  </div>
                  <span className="text-xs font-medium text-slate-600">v{version.version}</span>
                  <StatusPill status={version.status} />
                  <span className="text-xs text-slate-500">{new Date(version.created_at).toLocaleString("zh-CN")}</span>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void loadDocumentVersionCompare(version)}
                      disabled={!version.document_id || versionCompareLoadingId === version.id}
                      className="ui-button-secondary h-11 px-3 text-xs sm:h-8 sm:px-2"
                      title="对比当前版本"
                    >
                      {versionCompareLoadingId === version.id ? <Loader2 className="animate-spin" size={14} /> : <GitCompareArrows size={14} />}
                      对比
                    </button>
                    <button
                      type="button"
                      onClick={() => void rollbackDocumentVersion(version)}
                      disabled={!version.document_id || deletingId === `rollback:${version.id}`}
                      className="ui-button-secondary h-11 px-3 text-xs sm:h-8 sm:px-2"
                      title="回滚到该版本"
                    >
                      {deletingId === `rollback:${version.id}` ? <Loader2 className="animate-spin" size={14} /> : <RotateCcw size={14} />}
                      回滚
                    </button>
                  </div>
                </div>
              ))}
              {activeDocumentVersions.length === 0 && (
                <div className="px-4 py-8 text-center text-sm text-slate-500">
                  暂无版本记录。上传资料后会自动生成版本。
                </div>
              )}
            </div>
          </div>
        </section>
          </div>
        </>
      )}
    </div>
    <ActionConfirmDialog
      request={confirmDialog}
      onCancel={() => settleAdminConfirm(false)}
      onConfirm={() => settleAdminConfirm(true)}
    />
    </>
  );
}

function DocumentsAdminSkeleton() {
  return (
    <div className="grid min-w-0 gap-5 xl:grid-cols-[420px_minmax(0,1fr)]" aria-label="知识管理加载中">
      <section className="space-y-5">
        <PanelSkeleton rows={4} />
        <PanelSkeleton rows={3} />
      </section>
      <section className="ui-card min-w-0 p-5">
        <div className="animate-pulse space-y-5">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="h-5 w-32 rounded-full bg-slate-200" />
            <div className="h-10 w-28 rounded-lg bg-slate-100" />
          </div>
          <div className="grid gap-3 md:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="h-20 rounded-lg bg-slate-100" />
            ))}
          </div>
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_160px]">
            <div className="h-11 rounded-lg bg-slate-100" />
            <div className="h-11 rounded-lg bg-slate-100" />
            <div className="h-11 rounded-lg bg-slate-100" />
          </div>
          <div className="space-y-3 md:hidden">
            {Array.from({ length: 3 }).map((_, index) => (
              <div key={index} className="rounded-lg border border-line bg-white p-4">
                <div className="h-4 w-3/4 rounded-full bg-slate-200" />
                <div className="mt-3 h-3 w-full rounded-full bg-slate-100" />
                <div className="mt-3 grid grid-cols-3 gap-2">
                  <div className="h-10 rounded-lg bg-slate-100" />
                  <div className="h-10 rounded-lg bg-slate-100" />
                  <div className="h-10 rounded-lg bg-slate-100" />
                </div>
              </div>
            ))}
          </div>
          <div className="hidden overflow-hidden rounded-lg border border-line md:block">
            {Array.from({ length: 5 }).map((_, index) => (
              <div key={index} className="grid grid-cols-[1.4fr_1fr_1fr_90px] gap-3 border-b border-line px-4 py-4 last:border-b-0">
                <div className="h-4 rounded-full bg-slate-100" />
                <div className="h-4 rounded-full bg-slate-100" />
                <div className="h-4 rounded-full bg-slate-100" />
                <div className="h-8 rounded-lg bg-slate-100" />
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

function KnowledgeBaseEmptyState() {
  return (
    <div className="rounded-lg border border-dashed border-line bg-slate-50 px-4 py-6 text-sm leading-6 text-slate-500">
      <p className="font-semibold text-ink">还没有知识库</p>
      <p className="mt-1">先创建一个知识库，再上传制度、手册、FAQ、PPT 或扫描件资料。</p>
    </div>
  );
}

function DocumentEmptyState({
  activeKb,
  compact = false
}: {
  activeKb: KnowledgeBase | undefined;
  compact?: boolean;
}) {
  return (
    <div className={`rounded-lg border border-dashed border-line bg-slate-50 text-center text-sm leading-6 text-slate-500 ${compact ? "px-4 py-6" : "px-4 py-8"}`}>
      <p className="font-semibold text-ink">{activeKb ? "当前知识库暂无资料" : "请先选择或创建知识库"}</p>
      <p className="mt-1">
        {activeKb
          ? "上传资料后会显示解析状态、OCR 结果、失败原因、重识别入口和治理操作。"
          : "创建知识库后，这里会展示资料列表、版本记录和分片治理结果。"}
      </p>
    </div>
  );
}

function buildFailedUploadRetryItems({
  files,
  failedItems,
  knowledgeBaseId,
  department,
  changeNote,
  retryItemId
}: {
  files: File[];
  failedItems: Array<{ file_name?: string; error?: string }>;
  knowledgeBaseId: string;
  department: string | null;
  changeNote: string;
  retryItemId: string | null;
}): FailedUploadRetryItem[] {
  const remainingFiles = [...files];

  return failedItems
    .map((failedItem) => {
      const matchingIndex = remainingFiles.findIndex((file) => file.name === failedItem.file_name);
      const fileIndex = matchingIndex >= 0 ? matchingIndex : 0;
      const [file] = remainingFiles.splice(fileIndex, 1);

      if (!file) {
        return null;
      }

      return {
        id: retryItemId ?? createUploadRetryId(file),
        file,
        file_name: failedItem.file_name ?? file.name,
        error: failedItem.error ?? "未返回失败原因",
        knowledge_base_id: knowledgeBaseId,
        department,
        change_note: changeNote,
        attempts: 1,
        last_attempt_at: new Date().toISOString()
      };
    })
    .filter((item): item is FailedUploadRetryItem => Boolean(item));
}

function createUploadRetryId(file: File) {
  const randomId = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(16).slice(2);

  return `upload-retry-${file.name}-${file.size}-${file.lastModified}-${randomId}`;
}

function FailedUploadRetryPanel({
  items,
  retryingId,
  onRetry,
  onDismiss,
  onClear
}: {
  items: FailedUploadRetryItem[];
  retryingId: string | null;
  onRetry: (item: FailedUploadRetryItem) => void;
  onDismiss: (itemId: string) => void;
  onClear: () => void;
}) {
  const isWorking = Boolean(retryingId);

  return (
    <div className="mt-3 overflow-hidden rounded-lg border border-red-200 bg-white">
      <div className="flex flex-col gap-3 border-b border-red-100 bg-red-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-2">
          <CircleAlert className="mt-0.5 shrink-0 text-red-700" size={17} />
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-red-800">本次上传失败文件</h3>
            <p className="mt-1 text-xs leading-5 text-red-700">
              已保留本次选择的文件，可直接重试；刷新页面后需要重新选择文件上传。
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClear}
          disabled={isWorking}
          className="ui-button-secondary h-11 shrink-0 px-3 text-xs sm:h-9"
        >
          清空记录
        </button>
      </div>

      <div className="divide-y divide-red-100">
        {items.map((item) => {
          const retrying = retryingId === item.id;

          return (
            <div key={item.id} className="grid gap-3 px-4 py-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="max-w-full truncate text-sm font-semibold text-ink" title={item.file_name}>
                    {item.file_name}
                  </p>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                    {formatFileSize(item.file.size)}
                  </span>
                  {item.file.type && (
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                      {item.file.type}
                    </span>
                  )}
                </div>
                <p className="mt-1 text-xs leading-5 text-red-700">{item.error}</p>
                <p className="mt-1 text-xs text-slate-500">
                  已尝试 {item.attempts} 次 · 最近：{formatRetryTime(item.last_attempt_at)}
                </p>
              </div>

              <div className="flex flex-wrap gap-2 lg:justify-end">
                <button
                  type="button"
                  onClick={() => onRetry(item)}
                  disabled={isWorking}
                  className="ui-button-primary h-11 px-3 text-xs sm:h-9"
                >
                  {retrying ? <Loader2 className="animate-spin" size={14} /> : <RotateCcw size={14} />}
                  重试
                </button>
                <button
                  type="button"
                  onClick={() => onDismiss(item.id)}
                  disabled={isWorking}
                  className="ui-button-secondary h-11 px-3 text-xs sm:h-9"
                >
                  <Trash2 size={14} />
                  移除
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function formatFileSize(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "未知大小";
  }

  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`;
}

function formatRetryTime(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "刚刚";
  }

  return date.toLocaleString("zh-CN");
}

function formatDurationFromMs(value: number | null | undefined) {
  if (!Number.isFinite(value ?? NaN) || !value || value <= 0) {
    return "一段时间";
  }

  const minutes = Math.max(1, Math.round(value / 60000));
  if (minutes < 60) {
    return `${minutes} 分钟`;
  }

  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  return restMinutes > 0 ? `${hours} 小时 ${restMinutes} 分钟` : `${hours} 小时`;
}

function UploadReadiness({
  activeKb,
  stats,
  ragProvider,
  onProvision,
  provisioning
}: {
  activeKb: KnowledgeBase | undefined;
  stats: {
    total: number;
    uploading: number;
    processing: number;
    ready: number;
    failed: number;
  };
  ragProvider: string;
  onProvision: () => void;
  provisioning: boolean;
}) {
  const isLocalTextRag = ragProvider === "local_text";
  const steps = [
    {
      label: "选择知识库",
      ready: Boolean(activeKb),
      detail: activeKb ? activeKb.name : "先创建或选择一个知识库"
    },
    {
      label: isLocalTextRag ? "本地文本切块" : "绑定 Vector Store",
      ready: isLocalTextRag ? Boolean(activeKb) : Boolean(activeKb?.openai_vector_store_id),
      detail: isLocalTextRag
        ? "可解析文字会存入当前数据库 document_chunks"
        : activeKb?.openai_vector_store_id
          ? "已绑定，可上传资料"
          : "资料入库前必须完成"
    },
    {
      label: "上传资料",
      ready: stats.total > 0,
      detail: stats.total > 0 ? `已上传 ${stats.total} 份资料` : "支持 PDF、TXT、MD、DOCX、PPTX、XLSX"
    },
    {
      label: "可用于问答",
      ready: stats.ready > 0,
      detail: stats.ready > 0 ? `${stats.ready} 份资料可检索` : "刷新状态直到资料变为可用"
    }
  ];

  return (
    <section className="ui-card p-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-base font-semibold text-ink">资料入库流程</h2>
          <p className="mt-1 text-sm text-slate-500">按顺序完成后，员工端问答会检索这些资料并展示来源引用。</p>
        </div>
        {activeKb && !activeKb.openai_vector_store_id && !isLocalTextRag && (
          <button
            type="button"
            onClick={onProvision}
            disabled={provisioning}
            className="ui-button-primary h-11 sm:h-10"
          >
            {provisioning ? <Loader2 className="animate-spin" size={16} /> : <Plus size={16} />}
            创建 Vector Store
          </button>
        )}
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-4">
        {steps.map((step) => (
          <div
            key={step.label}
            className={`rounded-lg border p-3 ${
              step.ready ? "border-emerald-200 bg-emerald-50" : "border-line bg-slate-50"
            }`}
          >
            <div className="flex items-center gap-2">
              {step.ready ? (
                <CheckCircle2 size={16} className="text-emerald-700" />
              ) : (
                <Clock size={16} className="text-slate-500" />
              )}
              <p className={`text-sm font-semibold ${step.ready ? "text-emerald-800" : "text-slate-700"}`}>
                {step.label}
              </p>
            </div>
            <p className={`mt-2 text-xs leading-5 ${step.ready ? "text-emerald-700" : "text-slate-500"}`}>
              {step.detail}
            </p>
          </div>
        ))}
      </div>
      {stats.failed > 0 && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          <span className="inline-flex items-center gap-2 font-medium">
            <CircleAlert size={15} />
            有 {stats.failed} 份资料处理失败
          </span>
          <p className="mt-1">可在资料表中查看失败原因并点击“重新识别”；如果没有保留原文件，再重新上传或检查 OCR/模型配置。</p>
        </div>
      )}
    </section>
  );
}

function OcrStatusPanel({
  status,
  failedCount,
  ocrCandidateCount
}: {
  status: OcrStatus;
  failedCount: number;
  ocrCandidateCount: number;
}) {
  if (!status.local_text && status.configured) {
    return null;
  }

  const shouldWarn = status.local_text && ocrCandidateCount > 0 && !status.configured;

  return (
    <div className={`mt-3 rounded-lg border px-3 py-2 text-sm ${
      shouldWarn ? "border-amber-200 bg-amber-50 text-amber-800" : "border-line bg-slate-50 text-slate-600"
    }`}>
      <span className="inline-flex items-center gap-2 font-medium">
        {status.configured ? <CheckCircle2 size={15} /> : <CircleAlert size={15} />}
        OCR 状态：{status.configured ? "已配置" : "未配置"}
      </span>
      <p className="mt-1 leading-6">
        {status.configured
          ? `扫描件 PDF 和图片会调用 ${status.provider}${status.model ? ` / ${status.model}` : ""} 识别，当前请求格式：${status.request_format}。`
          : status.local_text
            ? `当前有 ${ocrCandidateCount} 份 PDF/图片资料可能需要 OCR；若是扫描件或图片文字，需先到系统配置页接入 OCR，再重新识别。`
            : "OpenAI File Search 模式下由远端索引处理；如切换 local_text，扫描件 PDF/图片需要配置 OCR。"}
      </p>
      {failedCount > 0 && !status.configured && (
        <p className="mt-1 text-xs leading-5">已有失败资料时，配置 OCR 后可在表格里点“重新识别”。</p>
      )}
    </div>
  );
}

function DocumentAttentionPanel({
  documents,
  diagnostics,
  reprocessingId,
  onReprocess
}: {
  documents: DocumentRecord[];
  diagnostics: Record<string, DocumentProcessingDiagnostic>;
  reprocessingId: string | null;
  onReprocess: (document: DocumentRecord) => void;
}) {
  const failedDocuments = documents.filter((document) => document.status === "failed");
  const staleDocuments = documents.filter((document) => diagnostics[document.id]?.is_stale_processing);
  const attentionItems = [
    ...staleDocuments.map((document) => ({
      document,
      tone: "warn" as const,
      label: "处理超时",
      detail: `已处理 ${formatDurationFromMs(diagnostics[document.id]?.processing_age_ms)}，可重新入队`
    })),
    ...failedDocuments
      .filter((document) => !diagnostics[document.id]?.is_stale_processing)
      .map((document) => ({
        document,
        tone: "bad" as const,
        label: "处理失败",
        detail: diagnostics[document.id]?.last_error ?? "查看表格中的失败原因后重新识别"
      }))
  ];

  if (attentionItems.length === 0) {
    return null;
  }

  return (
    <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-3">
      <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="inline-flex items-center gap-2 text-sm font-semibold text-amber-900">
            <CircleAlert size={15} />
            资料处理关注项
          </p>
          <p className="mt-1 text-xs leading-5 text-amber-800">
            {failedDocuments.length > 0 ? `${failedDocuments.length} 份失败` : ""}
            {failedDocuments.length > 0 && staleDocuments.length > 0 ? "，" : ""}
            {staleDocuments.length > 0 ? `${staleDocuments.length} 份处理超时` : ""}
            。可以直接重新识别/重新入队，页面会自动刷新处理状态。
          </p>
        </div>
      </div>
      <div className="mt-3 grid gap-2 lg:grid-cols-2">
        {attentionItems.slice(0, 4).map(({ document, tone, label, detail }) => (
          <div key={`${label}:${document.id}`} className="rounded-lg border border-white/70 bg-white px-3 py-2">
            <div className="flex min-w-0 items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                    tone === "bad" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"
                  }`}>
                    {label}
                  </span>
                  <p className="truncate text-sm font-semibold text-ink" title={document.title}>{document.title}</p>
                </div>
                <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-600">{detail}</p>
              </div>
              <button
                type="button"
                onClick={() => onReprocess(document)}
                disabled={reprocessingId === document.id}
                className="ui-button-secondary h-11 shrink-0 px-3 text-xs sm:h-8 sm:px-2"
              >
                {reprocessingId === document.id ? <Loader2 className="animate-spin" size={14} /> : <RotateCcw size={14} />}
                {tone === "bad" ? "重新识别" : "重新入队"}
              </button>
            </div>
          </div>
        ))}
      </div>
      {attentionItems.length > 4 && (
        <p className="mt-2 text-xs text-amber-800">还有 {attentionItems.length - 4} 份资料需要处理，可在下方表格中筛查。</p>
      )}
    </div>
  );
}

function DocumentQualityPanel({
  documents,
  diagnostics,
  previewLoadingId,
  reprocessingId,
  onPreview,
  onReprocess
}: {
  documents: DocumentRecord[];
  diagnostics: Record<string, DocumentProcessingDiagnostic>;
  previewLoadingId: string | null;
  reprocessingId: string | null;
  onPreview: (document: DocumentRecord) => void;
  onReprocess: (document: DocumentRecord) => void;
}) {
  const overview = useMemo(
    () => buildDocumentQualityOverview(documents, diagnostics),
    [diagnostics, documents]
  );

  if (overview.readyDocuments === 0) {
    return null;
  }

  const issueTotal = overview.emptyChunks + overview.shortChunks + overview.longChunks + overview.noisyChunks;
  const scoreTone = overview.averageScore >= 90 ? "good" : overview.averageScore >= 70 ? "warn" : "bad";

  return (
    <div className="mt-3 rounded-lg border border-line bg-white px-3 py-3">
      <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="inline-flex items-center gap-2 text-sm font-semibold text-ink">
            {overview.issueDocuments > 0 ? <CircleAlert size={15} className="text-amber-700" /> : <CheckCircle2 size={15} className="text-emerald-700" />}
            知识分片质量
          </p>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            检查空分片、过短/过长分片和疑似 OCR 噪声，帮助定位检索命中率不稳定的资料。
          </p>
        </div>
        <span className={`inline-flex w-fit rounded-full px-2.5 py-1 text-xs font-semibold ${qualityScoreClass(overview.averageScore)}`}>
          平均 {overview.averageScore} 分
        </span>
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-4">
        <DocumentMetric label="质量分" value={overview.averageScore} tone={scoreTone} />
        <DocumentMetric label="分片总数" value={overview.totalChunks} />
        <DocumentMetric label="风险资料" value={overview.issueDocuments} tone={overview.issueDocuments > 0 ? "warn" : "good"} />
        <DocumentMetric label="疑似问题" value={issueTotal} tone={issueTotal > 0 ? "warn" : "good"} />
      </div>

      {overview.issueRows.length > 0 ? (
        <div className="mt-3 grid gap-2 xl:grid-cols-2">
          {overview.issueRows.slice(0, 4).map(({ document, diagnostic, issueCount }) => (
            <div key={`quality:${document.id}`} className="rounded-lg border border-amber-100 bg-amber-50/60 px-3 py-3">
              <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${qualityScoreClass(diagnostic.quality_score)}`}>
                      {diagnostic.quality_score} 分
                    </span>
                    <p className="truncate text-sm font-semibold text-ink" title={document.title}>{document.title}</p>
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs leading-5 text-amber-800">
                    {diagnostic.quality_warnings.slice(0, 3).join("、") || "建议检查分片内容"}
                  </p>
                  <p className="mt-1 text-xs leading-5 text-slate-500">
                    {diagnostic.chunk_count} 分片 · 平均 {diagnostic.average_tokens} tokens · 最大 {diagnostic.max_tokens} tokens · 问题 {issueCount}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    onClick={() => onPreview(document)}
                    disabled={previewLoadingId === document.id}
                    className="ui-button-secondary h-11 px-3 text-xs sm:h-8 sm:px-2"
                  >
                    {previewLoadingId === document.id ? <Loader2 className="animate-spin" size={14} /> : <Eye size={14} />}
                    预览
                  </button>
                  <button
                    type="button"
                    onClick={() => onReprocess(document)}
                    disabled={!diagnostic.can_reprocess || reprocessingId === document.id}
                    className="ui-button-secondary h-11 px-3 text-xs sm:h-8 sm:px-2"
                    title={diagnostic.can_reprocess ? "重新识别并生成分片" : "没有保留原文件，无法直接重新识别"}
                  >
                    {reprocessingId === document.id ? <Loader2 className="animate-spin" size={14} /> : <RotateCcw size={14} />}
                    重识别
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-3 rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          当前可检索资料未发现明显分片质量风险。
        </div>
      )}
      {overview.issueRows.length > 4 && (
        <p className="mt-2 text-xs text-amber-800">还有 {overview.issueRows.length - 4} 份资料存在分片风险，可在下方资料列表逐个预览。</p>
      )}
    </div>
  );
}

function ChunkSuggestionQueuePanel({
  stats,
  job,
  starting,
  onStart
}: {
  stats: ChunkMetadataSuggestionStats | null;
  job: ChunkMetadataSuggestionJob | null;
  starting: boolean;
  onStart: () => void;
}) {
  const running = job?.status === "queued" || job?.status === "generating";
  const total = job?.total_chunks ?? 0;
  const processed = job?.processed_chunks ?? 0;
  const progress = total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : running ? 5 : 0;
  const missing = stats?.missing_chunks ?? 0;
  const pending = stats?.pending_suggestions ?? 0;
  const canStart = !running && missing > 0;

  return (
    <div className="mt-3 rounded-lg border border-blue-100 bg-blue-50/60 px-3 py-3">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="inline-flex items-center gap-2 text-sm font-semibold text-blue-900">
            <Sparkles size={15} />
            全库分片治理队列
          </p>
          <p className="mt-1 text-xs leading-5 text-blue-800">
            扫描当前知识库缺摘要、关键词或同义词的分片，后台分批生成待确认建议；建议不会自动覆盖正式知识。
          </p>
        </div>
        <button
          type="button"
          onClick={onStart}
          disabled={starting || !canStart}
          className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-lg bg-blue-700 px-3 text-xs font-semibold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 sm:min-h-9"
        >
          {starting || running ? <Loader2 className="animate-spin" size={14} /> : <Sparkles size={14} />}
          {running ? "生成中" : "启动全库建议"}
        </button>
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-4">
        <DocumentMetric label="分片总数" value={stats?.total_chunks ?? 0} />
        <DocumentMetric label="缺治理" value={missing} tone={missing > 0 ? "warn" : "good"} />
        <DocumentMetric label="待确认" value={pending} tone={pending > 0 ? "warn" : "good"} />
        <DocumentMetric label="本轮生成" value={job?.suggested_chunks ?? 0} tone={(job?.suggested_chunks ?? 0) > 0 ? "good" : undefined} />
      </div>

      {job && (
        <div className="mt-3 rounded-lg border border-white/80 bg-white px-3 py-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${chunkSuggestionJobStatusClass(job.status)}`}>
                  {chunkSuggestionJobStatusLabel(job.status)}
                </span>
                <p className="truncate text-xs text-slate-500" title={job.id}>{job.id}</p>
              </div>
              <p className="mt-1 text-xs leading-5 text-slate-600">{job.message}</p>
              {job.error && <p className="mt-1 text-xs leading-5 text-red-700">{job.error}</p>}
            </div>
            <span className="shrink-0 text-xs tabular-nums text-slate-500">
              {job.processed_chunks}/{job.total_chunks || 0}
            </span>
          </div>
          {(running || job.total_chunks > 0) && (
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full bg-blue-600 transition-all" style={{ width: `${progress}%` }} />
            </div>
          )}
          <p className="mt-2 text-xs leading-5 text-slate-500">
            已生成 {job.suggested_chunks} 条，失败 {job.failed_chunks} 条
            {job.model ? ` · ${job.model}` : ""}
          </p>
        </div>
      )}

      {!job && pending > 0 && (
        <p className="mt-2 text-xs leading-5 text-blue-800">
          当前已有 {pending} 条待确认建议。打开资料预览后，可在对应分片的“AI 治理建议”中填入表单并保存。
        </p>
      )}
    </div>
  );
}

function chunkSuggestionJobStatusLabel(status: ChunkMetadataSuggestionJob["status"]) {
  const labels = {
    queued: "排队中",
    generating: "生成中",
    ready: "已完成",
    failed: "失败"
  };
  return labels[status];
}

function chunkSuggestionJobStatusClass(status: ChunkMetadataSuggestionJob["status"]) {
  if (status === "ready") {
    return "bg-emerald-100 text-emerald-700";
  }
  if (status === "failed") {
    return "bg-red-100 text-red-700";
  }
  return "bg-blue-100 text-blue-700";
}

function PendingSuggestionReviewPanel({
  activeKnowledgeBaseName,
  activeCount,
  allCount,
  scope,
  suggestions,
  selectedIds,
  workingId,
  onScopeChange,
  onSelectionChange,
  onApplySelected,
  onRevokeSelected,
  onOpen,
  onRevoke
}: {
  activeKnowledgeBaseName: string;
  activeCount: number;
  allCount: number;
  scope: "active" | "all";
  suggestions: PendingChunkMetadataSuggestion[];
  selectedIds: string[];
  workingId: string | null;
  onScopeChange: (scope: "active" | "all") => void;
  onSelectionChange: (ids: string[]) => void;
  onApplySelected: () => void;
  onRevokeSelected: () => void;
  onOpen: (item: PendingChunkMetadataSuggestion) => void;
  onRevoke: (item: PendingChunkMetadataSuggestion) => void;
}) {
  const hasSuggestions = allCount > 0;
  const scopeLabel = scope === "active" ? activeKnowledgeBaseName : "全部知识库";
  const selectedSet = new Set(selectedIds);
  const visibleIds = suggestions.map((item) => item.chunk_id);
  const selectedVisibleCount = visibleIds.filter((chunkId) => selectedSet.has(chunkId)).length;
  const allVisibleSelected = visibleIds.length > 0 && selectedVisibleCount === visibleIds.length;
  const busy = Boolean(workingId);

  function toggleItem(chunkId: string, checked: boolean) {
    if (checked) {
      onSelectionChange([...new Set([...selectedIds, chunkId])]);
      return;
    }

    onSelectionChange(selectedIds.filter((item) => item !== chunkId));
  }

  function toggleVisible(checked: boolean) {
    if (checked) {
      onSelectionChange([...new Set([...selectedIds, ...visibleIds])]);
      return;
    }

    const visibleSet = new Set(visibleIds);
    onSelectionChange(selectedIds.filter((chunkId) => !visibleSet.has(chunkId)));
  }

  return (
    <div className="mt-3 rounded-lg border border-indigo-100 bg-white px-3 py-3 shadow-sm shadow-slate-100">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0">
          <p className="inline-flex items-center gap-2 text-sm font-semibold text-indigo-900">
            <Sparkles size={15} />
            待确认治理建议
          </p>
          <p className="mt-1 text-xs leading-5 text-slate-600">
            集中复核全库队列生成的摘要、关键词和同义词建议；打开分片后再保存，才会写入正式检索字段。
          </p>
        </div>
        <div className="inline-flex w-full rounded-lg border border-line bg-slate-50 p-1 sm:w-auto">
          <button
            type="button"
            aria-pressed={scope === "active"}
            onClick={() => onScopeChange("active")}
            className={`min-h-10 flex-1 rounded-md px-3 text-xs font-semibold transition sm:flex-none ${scope === "active" ? "bg-white text-brand shadow-sm" : "text-slate-500 hover:text-slate-800"}`}
          >
            当前知识库 {activeCount}
          </button>
          <button
            type="button"
            aria-pressed={scope === "all"}
            onClick={() => onScopeChange("all")}
            className={`min-h-10 flex-1 rounded-md px-3 text-xs font-semibold transition sm:flex-none ${scope === "all" ? "bg-white text-brand shadow-sm" : "text-slate-500 hover:text-slate-800"}`}
          >
            全部 {allCount}
          </button>
        </div>
      </div>

      {!hasSuggestions ? (
        <div className="mt-3 rounded-lg border border-dashed border-line bg-slate-50 px-3 py-4 text-sm text-slate-500">
          暂无待确认治理建议。可以先启动上方全库队列，或在资料预览里生成本页建议。
        </div>
      ) : suggestions.length === 0 ? (
        <div className="mt-3 rounded-lg border border-dashed border-line bg-slate-50 px-3 py-4 text-sm text-slate-500">
          {scopeLabel} 暂无待确认建议，可切换到全部知识库查看。
        </div>
      ) : (
        <>
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            <DocumentMetric label="当前显示" value={suggestions.length} tone={suggestions.length > 0 ? "warn" : "good"} />
            <DocumentMetric label="当前知识库" value={activeCount} tone={activeCount > 0 ? "warn" : "good"} />
            <DocumentMetric label="全部待确认" value={allCount} tone={allCount > 0 ? "warn" : "good"} />
          </div>

          <div className="mt-3 rounded-lg border border-indigo-100 bg-indigo-50/70 px-3 py-3">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
              <label className="flex min-h-11 items-center gap-2 text-sm font-semibold text-indigo-900">
                <input
                  type="checkbox"
                  checked={allVisibleSelected}
                  onChange={(event) => toggleVisible(event.target.checked)}
                  className="h-4 w-4 rounded border-indigo-200 text-brand focus:ring-brand"
                />
                全选当前显示
                <span className="text-xs font-medium text-indigo-700">已选 {selectedIds.length} 条</span>
              </label>
              <div className="grid gap-2 sm:grid-cols-3 xl:flex xl:justify-end">
                <button
                  type="button"
                  onClick={() => onSelectionChange([])}
                  disabled={selectedIds.length === 0 || busy}
                  className="ui-button-secondary h-11 px-3 text-xs disabled:cursor-not-allowed disabled:opacity-50 xl:h-10"
                >
                  清空选择
                </button>
                <button
                  type="button"
                  onClick={onRevokeSelected}
                  disabled={selectedIds.length === 0 || busy}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-red-100 bg-white px-3 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 xl:h-10"
                >
                  {workingId === "batch" ? <Loader2 className="animate-spin" size={14} /> : <Trash2 size={14} />}
                  批量撤销
                </button>
                <button
                  type="button"
                  onClick={onApplySelected}
                  disabled={selectedIds.length === 0 || busy}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-indigo-700 px-3 text-xs font-semibold text-white hover:bg-indigo-800 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 xl:h-10"
                >
                  {workingId === "apply" ? <Loader2 className="animate-spin" size={14} /> : <CheckCircle2 size={14} />}
                  批量保存
                </button>
              </div>
            </div>
            {selectedIds.length > 0 && (
              <p className="mt-2 text-xs leading-5 text-indigo-700">
                批量保存会把所选建议写入正式摘要、关键词和同义词；撤销只清除待确认建议。
              </p>
            )}
          </div>

          <div className="mt-3 space-y-2 lg:hidden">
            {suggestions.map((item) => (
              <div key={item.chunk_id} className="rounded-lg border border-line bg-slate-50 px-3 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 gap-3">
                    <input
                      type="checkbox"
                      checked={selectedSet.has(item.chunk_id)}
                      onChange={(event) => toggleItem(item.chunk_id, event.target.checked)}
                      aria-label={`选择 ${item.document_title} 第 ${item.chunk_index + 1} 片`}
                      className="mt-1 h-4 w-4 shrink-0 rounded border-slate-300 text-brand focus:ring-brand"
                    />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold leading-5 text-ink">{item.document_title}</p>
                      <p className="mt-1 text-xs leading-5 text-slate-500">
                        {item.knowledge_base_name} · 第 {item.chunk_index + 1} 片 · {item.token_estimate} tokens
                      </p>
                    </div>
                  </div>
                  <span className="shrink-0 rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-semibold text-indigo-700">
                    待确认
                  </span>
                </div>
                <p className="mt-2 text-xs leading-5 text-slate-700">{item.summary}</p>
                <PendingSuggestionTags item={item} />
                <p className="mt-2 text-xs leading-5 text-slate-500">
                  {item.model ?? "AI 建议"}
                  {item.generated_at ? ` · ${formatPendingSuggestionTime(item.generated_at)}` : ""}
                </p>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => onOpen(item)}
                    className="ui-button-secondary h-11 px-3 text-xs"
                  >
                    <Eye size={14} />
                    打开定位
                  </button>
                  <button
                    type="button"
                    onClick={() => onRevoke(item)}
                    disabled={busy}
                    className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-red-100 bg-white px-3 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {workingId === item.chunk_id ? <Loader2 className="animate-spin" size={14} /> : <Trash2 size={14} />}
                    撤销
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-3 hidden overflow-x-auto rounded-lg border border-line lg:block">
            <table className="min-w-full divide-y divide-line bg-white text-left text-sm">
              <thead className="bg-slate-50 text-xs font-semibold text-slate-500">
                <tr>
                  <th className="w-11 px-3 py-2">
                    <input
                      type="checkbox"
                      checked={allVisibleSelected}
                      onChange={(event) => toggleVisible(event.target.checked)}
                      aria-label="全选当前显示的治理建议"
                      className="h-4 w-4 rounded border-slate-300 text-brand focus:ring-brand"
                    />
                  </th>
                  <th className="px-3 py-2">资料 / 分片</th>
                  <th className="px-3 py-2">AI 建议摘要</th>
                  <th className="px-3 py-2">关键词</th>
                  <th className="px-3 py-2">生成信息</th>
                  <th className="px-3 py-2 text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {suggestions.map((item) => (
                  <tr key={item.chunk_id} className="align-top hover:bg-slate-50">
                    <td className="px-3 py-3">
                      <input
                        type="checkbox"
                        checked={selectedSet.has(item.chunk_id)}
                        onChange={(event) => toggleItem(item.chunk_id, event.target.checked)}
                        aria-label={`选择 ${item.document_title} 第 ${item.chunk_index + 1} 片`}
                        className="h-4 w-4 rounded border-slate-300 text-brand focus:ring-brand"
                      />
                    </td>
                    <td className="max-w-xs px-3 py-3">
                      <p className="font-medium leading-5 text-ink">{item.document_title}</p>
                      <p className="mt-1 text-xs leading-5 text-slate-500">
                        {item.knowledge_base_name} · 第 {item.chunk_index + 1} 片 · {item.token_estimate} tokens
                      </p>
                      {item.content_preview && (
                        <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">{item.content_preview}</p>
                      )}
                    </td>
                    <td className="max-w-xl px-3 py-3 text-xs leading-5 text-slate-700">{item.summary}</td>
                    <td className="max-w-sm px-3 py-3">
                      <PendingSuggestionTags item={item} compact />
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-xs leading-5 text-slate-500">
                      <p>{item.model ?? "AI 建议"}</p>
                      {item.generated_at && <p>{formatPendingSuggestionTime(item.generated_at)}</p>}
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => onOpen(item)}
                          className="ui-button-secondary h-9 px-3 text-xs"
                        >
                          <Eye size={14} />
                          打开定位
                        </button>
                        <button
                          type="button"
                          onClick={() => onRevoke(item)}
                          disabled={busy}
                          className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-red-100 bg-white px-3 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {workingId === item.chunk_id ? <Loader2 className="animate-spin" size={14} /> : <Trash2 size={14} />}
                          撤销
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function PendingSuggestionTags({
  item,
  compact = false
}: {
  item: PendingChunkMetadataSuggestion;
  compact?: boolean;
}) {
  const keywords = item.keywords.slice(0, compact ? 5 : 8);
  const synonyms = item.synonyms.slice(0, compact ? 3 : 6);

  return (
    <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
      {keywords.map((keyword) => (
        <span key={`${item.chunk_id}:keyword:${keyword}`} className="rounded-full bg-indigo-50 px-2 py-0.5 text-indigo-700 ring-1 ring-indigo-100">
          {keyword}
        </span>
      ))}
      {synonyms.map((synonym) => (
        <span key={`${item.chunk_id}:synonym:${synonym}`} className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600 ring-1 ring-slate-200">
          {synonym}
        </span>
      ))}
      {item.keywords.length + item.synonyms.length > keywords.length + synonyms.length && (
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-500">
          +{item.keywords.length + item.synonyms.length - keywords.length - synonyms.length}
        </span>
      )}
    </div>
  );
}

function formatRetestQueueNotice(value: unknown) {
  const queue = value && typeof value === "object" ? value as GovernanceRetestQueueResult : null;

  if (!queue) {
    return "";
  }

  if (queue.queued_task_count > 0) {
    return ` 已自动排队 ${queue.queued_task_count} 条关联 QA 整改复测。`;
  }

  if (queue.skipped_reason) {
    return ` ${queue.skipped_reason}。`;
  }

  return "";
}

function GovernanceAuditPanel({
  activeKnowledgeBaseName,
  activeCount,
  allCount,
  audits,
  onOpen
}: {
  activeKnowledgeBaseName: string;
  activeCount: number;
  allCount: number;
  audits: GovernanceAuditRecord[];
  onOpen: (item: GovernanceAuditRecord) => void;
}) {
  return (
    <div className="mt-3 rounded-lg border border-slate-200 bg-white px-3 py-3 shadow-sm shadow-slate-100">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0">
          <p className="inline-flex items-center gap-2 text-sm font-semibold text-slate-900">
            <Shield size={15} />
            知识治理审计
          </p>
          <p className="mt-1 text-xs leading-5 text-slate-600">
            记录治理建议保存、撤销、手动编辑、拆分和合并，便于追溯谁在什么时候改了哪些检索字段。
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center">
          <span className="rounded-lg border border-line bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600">
            当前 {activeCount}
          </span>
          <span className="rounded-lg border border-line bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600">
            全部 {allCount}
          </span>
        </div>
      </div>

      {audits.length === 0 ? (
        <div className="mt-3 rounded-lg border border-dashed border-line bg-slate-50 px-3 py-4 text-sm text-slate-500">
          {allCount > 0 ? `${activeKnowledgeBaseName} 暂无治理审计记录。` : "暂无治理审计记录。后续保存、撤销或编辑分片治理信息后会自动出现。"}
        </div>
      ) : (
        <>
          <div className="mt-3 space-y-2 lg:hidden">
            {audits.map((item) => {
              const changes = governanceAuditChangeSummary(item);
              return (
                <div key={item.id} className="rounded-lg border border-line bg-slate-50 px-3 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold leading-5 text-ink">{item.document_title}</p>
                      <p className="mt-1 text-xs leading-5 text-slate-500">
                        {item.knowledge_base_name} · 第 {item.chunk_index + 1} 片
                      </p>
                    </div>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${governanceAuditBadgeClass(item.action)}`}>
                      {governanceAuditActionLabel(item.action)}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {changes.map((change) => (
                      <span key={`${item.id}:${change}`} className="rounded-full bg-white px-2 py-0.5 text-xs font-medium text-slate-600 ring-1 ring-slate-200">
                        {change}
                      </span>
                    ))}
                  </div>
                  <p className="mt-2 text-xs leading-5 text-slate-500">
                    {governanceAuditActor(item)} · {formatPendingSuggestionTime(item.created_at)}
                  </p>
                  <button
                    type="button"
                    onClick={() => onOpen(item)}
                    className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-line bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    <Eye size={14} />
                    打开定位
                  </button>
                </div>
              );
            })}
          </div>

          <div className="mt-3 hidden overflow-x-auto rounded-lg border border-line lg:block">
            <table className="min-w-full divide-y divide-line bg-white text-left text-sm">
              <thead className="bg-slate-50 text-xs font-semibold text-slate-500">
                <tr>
                  <th className="px-3 py-2">动作</th>
                  <th className="px-3 py-2">资料 / 分片</th>
                  <th className="px-3 py-2">变更摘要</th>
                  <th className="px-3 py-2">操作人</th>
                  <th className="px-3 py-2">时间</th>
                  <th className="px-3 py-2 text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {audits.map((item) => (
                  <tr key={item.id} className="align-top hover:bg-slate-50">
                    <td className="whitespace-nowrap px-3 py-3">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${governanceAuditBadgeClass(item.action)}`}>
                        {governanceAuditActionLabel(item.action)}
                      </span>
                    </td>
                    <td className="max-w-sm px-3 py-3">
                      <p className="font-medium leading-5 text-ink">{item.document_title}</p>
                      <p className="mt-1 text-xs leading-5 text-slate-500">
                        {item.knowledge_base_name} · 第 {item.chunk_index + 1} 片 · {item.token_estimate} tokens
                      </p>
                    </td>
                    <td className="max-w-xl px-3 py-3">
                      <div className="flex flex-wrap gap-1.5">
                        {governanceAuditChangeSummary(item).map((change) => (
                          <span key={`${item.id}:desktop:${change}`} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 ring-1 ring-slate-200">
                            {change}
                          </span>
                        ))}
                      </div>
                      {item.note && <p className="mt-1 text-xs leading-5 text-slate-500">{item.note}</p>}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-xs leading-5 text-slate-500">
                      {governanceAuditActor(item)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-xs leading-5 text-slate-500">
                      <span className="inline-flex items-center gap-1">
                        <Clock size={13} />
                        {formatPendingSuggestionTime(item.created_at)}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex justify-end">
                        <button
                          type="button"
                          onClick={() => onOpen(item)}
                          className="ui-button-secondary h-9 px-3 text-xs"
                        >
                          <Eye size={14} />
                          定位
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function governanceAuditActionLabel(action: GovernanceAuditRecord["action"]) {
  if (action === "pending_suggestion_apply") {
    return "保存建议";
  }
  if (action === "pending_suggestion_revoke") {
    return "撤销建议";
  }
  if (action === "metadata_update") {
    return "手动治理";
  }
  if (action === "split") {
    return "拆分";
  }
  return "合并";
}

function governanceAuditBadgeClass(action: GovernanceAuditRecord["action"]) {
  if (action === "pending_suggestion_apply") {
    return "bg-emerald-100 text-emerald-700";
  }
  if (action === "pending_suggestion_revoke") {
    return "bg-amber-100 text-amber-700";
  }
  if (action === "metadata_update") {
    return "bg-blue-100 text-blue-700";
  }
  if (action === "split") {
    return "bg-indigo-100 text-indigo-700";
  }
  return "bg-slate-200 text-slate-700";
}

function governanceAuditActor(item: GovernanceAuditRecord) {
  return item.actor_name || item.actor_email || item.actor_id || "未知用户";
}

function governanceAuditChangeSummary(item: GovernanceAuditRecord) {
  const before = item.before;
  const after = item.after;
  const changes: string[] = [];

  if (before && after) {
    if ((before.summary ?? "") !== (after.summary ?? "")) {
      changes.push(after.summary ? "摘要已更新" : "摘要已清空");
    }
    if (!sameList(before.keywords, after.keywords)) {
      changes.push(`关键词 ${before.keywords.length}→${after.keywords.length}`);
    }
    if (!sameList(before.synonyms, after.synonyms)) {
      changes.push(`同义词 ${before.synonyms.length}→${after.synonyms.length}`);
    }
    if (before.pending_suggestion && !after.pending_suggestion) {
      changes.push("待确认已清理");
    }
    if (before.content_length !== after.content_length) {
      changes.push(`正文 ${before.content_length ?? 0}→${after.content_length ?? 0} 字`);
    }
  }

  if (item.action === "split") {
    changes.push("分片结构已拆分");
  }
  if (item.action === "merge") {
    changes.push("相邻分片已合并");
  }
  if (changes.length === 0 && item.suggestion) {
    changes.push(`AI 建议 ${item.suggestion.keywords.length} 关键词`);
  }

  return changes.length > 0 ? [...new Set(changes)].slice(0, 5) : ["记录已保存"];
}

function sameList(left: string[] = [], right: string[] = []) {
  return left.join("\n") === right.join("\n");
}

function formatPendingSuggestionTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString("zh-CN");
}

function buildDocumentQualityOverview(
  documents: DocumentRecord[],
  diagnostics: Record<string, DocumentProcessingDiagnostic>
) {
  const readyDocuments = documents.filter((document) => document.status === "ready");
  let totalChunks = 0;
  let scoreTotal = 0;
  let emptyChunks = 0;
  let shortChunks = 0;
  let longChunks = 0;
  let noisyChunks = 0;

  const issueRows = readyDocuments
    .map((document) => {
      const diagnostic = diagnostics[document.id] ?? emptyDocumentDiagnostic();
      const issueCount = diagnostic.empty_chunks + diagnostic.short_chunks + diagnostic.long_chunks + diagnostic.noisy_chunks;

      totalChunks += diagnostic.chunk_count;
      scoreTotal += diagnostic.quality_score;
      emptyChunks += diagnostic.empty_chunks;
      shortChunks += diagnostic.short_chunks;
      longChunks += diagnostic.long_chunks;
      noisyChunks += diagnostic.noisy_chunks;

      return { document, diagnostic, issueCount };
    })
    .filter(({ diagnostic, issueCount }) => diagnostic.quality_warnings.length > 0 || issueCount > 0 || diagnostic.quality_score < 80)
    .sort((a, b) => a.diagnostic.quality_score - b.diagnostic.quality_score || b.issueCount - a.issueCount);

  return {
    readyDocuments: readyDocuments.length,
    totalChunks,
    averageScore: readyDocuments.length > 0 ? Math.round(scoreTotal / readyDocuments.length) : 0,
    emptyChunks,
    shortChunks,
    longChunks,
    noisyChunks,
    issueDocuments: issueRows.length,
    issueRows
  };
}

function emptyDocumentDiagnostic(): DocumentProcessingDiagnostic {
  return {
    chunk_count: 0,
    total_tokens: 0,
    average_tokens: 0,
    min_tokens: 0,
    max_tokens: 0,
    empty_chunks: 0,
    short_chunks: 0,
    long_chunks: 0,
    noisy_chunks: 0,
    quality_score: 35,
    quality_warnings: ["已就绪但没有可检索分片"],
    parser_summary: null,
    parsers: [],
    page_count: 0,
    ocr_used: false,
    ocr_applicable: false,
    can_reprocess: false,
    last_error: null,
    last_version_note: null,
    last_processed_at: null,
    processing_age_ms: null,
    is_stale_processing: false
  };
}

function qualityScoreClass(score: number) {
  if (score >= 90) {
    return "bg-emerald-100 text-emerald-700";
  }

  if (score >= 70) {
    return "bg-amber-100 text-amber-700";
  }

  return "bg-red-100 text-red-700";
}

function DocumentVersionComparePanel({
  compare,
  loading,
  onPageChange,
  onClose
}: {
  compare: DocumentVersionCompare;
  loading: boolean;
  onPageChange: (offset: number) => void;
  onClose: () => void;
}) {
  const offset = compare.diff_offset ?? 0;
  const limit = compare.diff_limit ?? compare.items.length;
  const start = compare.total_items > 0 ? offset + 1 : 0;
  const end = Math.min(compare.total_items, offset + compare.items.length);
  const changedTotal = compare.summary.changed + compare.summary.added + compare.summary.removed;
  const tokenDelta = compare.summary.current_tokens - compare.summary.version_tokens;

  return (
    <div className="mt-5 overflow-hidden rounded-lg border border-cyan/20 bg-white">
      <div className="flex flex-col gap-3 border-b border-line bg-cyan/10 px-4 py-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h3 className="text-sm font-semibold text-ink">版本对比</h3>
          <p className="mt-1 text-xs leading-5 text-slate-600">
            当前资料 vs v{compare.version.version}「{compare.version.title}」
            {compare.showing_only_changes ? ` · 仅显示变更 ${start}-${end}` : ` · 显示分片 ${start}-${end}`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => onPageChange(Math.max(0, offset - limit))}
            disabled={loading || !compare.has_previous}
            className="ui-button-secondary h-11 px-3 text-xs disabled:cursor-not-allowed disabled:opacity-50 sm:h-8"
          >
            <ChevronLeft size={14} />
            上一批
          </button>
          <button
            type="button"
            onClick={() => onPageChange(offset + limit)}
            disabled={loading || !compare.has_next}
            className="ui-button-secondary h-11 px-3 text-xs disabled:cursor-not-allowed disabled:opacity-50 sm:h-8"
          >
            {loading ? <Loader2 className="animate-spin" size={14} /> : <ChevronRight size={14} />}
            下一批
          </button>
          <button
            type="button"
            onClick={onClose}
            className="ui-button-secondary h-11 px-3 text-xs sm:h-8"
          >
            关闭对比
          </button>
        </div>
      </div>

      <div className="grid gap-0 border-b border-line md:grid-cols-4">
        <DocumentMetric label="历史分片" value={compare.summary.version_chunks} />
        <DocumentMetric label="当前分片" value={compare.summary.current_chunks} />
        <DocumentMetric label="变更分片" value={changedTotal} />
        <DocumentMetric label="Token 差异" value={tokenDelta >= 0 ? `+${tokenDelta}` : tokenDelta} />
      </div>

      <div className="flex flex-wrap gap-2 border-b border-line bg-slate-50 px-4 py-3 text-xs">
        <CompareSummaryPill label="未变化" value={compare.summary.same} status="same" />
        <CompareSummaryPill label="已变更" value={compare.summary.changed} status="changed" />
        <CompareSummaryPill label="新增" value={compare.summary.added} status="added" />
        <CompareSummaryPill label="删除" value={compare.summary.removed} status="removed" />
      </div>

      {!compare.snapshot_available && (
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs leading-5 text-amber-800">
          该历史版本没有正文快照，只能查看版本元信息，无法进行内容级对比。后续重新识别、上传和回滚产生的版本会自动保存快照。
        </div>
      )}

      {compare.total_items === 0 ? (
        <div className="px-4 py-8 text-center text-sm text-slate-500">
          当前版本和历史版本没有可展示的分片差异。
        </div>
      ) : (
        <div className="divide-y divide-line">
          {compare.items.map((item) => (
            <VersionCompareItem key={`${item.chunk_index}-${item.status}`} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}

function CompareSummaryPill({
  label,
  value,
  status
}: {
  label: string;
  value: number;
  status: DocumentVersionCompare["items"][number]["status"];
}) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 font-medium ${compareStatusClass(status)}`}>
      {label}
      <span className="tabular-nums">{value}</span>
    </span>
  );
}

function VersionCompareItem({ item }: { item: DocumentVersionCompare["items"][number] }) {
  const beforeContent = item.before?.content ?? "";
  const afterContent = item.after?.content ?? "";
  const diff = useMemo(
    () => buildTextDiff(beforeContent, afterContent),
    [afterContent, beforeContent]
  );
  const beforeMeta = item.before?.metadata ? chunkPreviewMeta(item.before.metadata) : "";
  const afterMeta = item.after?.metadata ? chunkPreviewMeta(item.after.metadata) : "";
  const beforeTokens = item.before?.token_estimate ?? 0;
  const afterTokens = item.after?.token_estimate ?? 0;
  const tokenDelta = afterTokens - beforeTokens;

  return (
    <article className={`px-3 py-4 sm:px-4 ${compareItemFrameClass(item.status)}`}>
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
          <span className="font-semibold text-brand">#{item.chunk_index + 1}</span>
          <span className={`rounded-full px-2 py-0.5 ${compareStatusClass(item.status)}`}>
            {compareStatusLabel(item.status)}
          </span>
          {item.status === "changed" && (
            <span className="rounded-full bg-white px-2 py-0.5 text-slate-600 ring-1 ring-line">
              相似度 {Math.round(diff.similarity * 100)}%
            </span>
          )}
          <span className="rounded-full bg-white px-2 py-0.5 text-slate-600 ring-1 ring-line">
            Token {tokenDelta >= 0 ? `+${tokenDelta}` : tokenDelta}
          </span>
        </div>
        <div className="flex flex-wrap gap-2 text-xs text-slate-500">
          {beforeMeta && <span>历史：{beforeMeta}</span>}
          {afterMeta && <span>当前：{afterMeta}</span>}
        </div>
      </div>
      <div className="grid gap-3 xl:grid-cols-2">
        <CompareChunkBlock
          title="历史版本"
          chunk={item.before}
          emptyText="历史版本无此分片"
          parts={diff.before}
          side="before"
          status={item.status}
        />
        <CompareChunkBlock
          title="当前内容"
          chunk={item.after}
          emptyText="当前资料无此分片"
          parts={diff.after}
          side="after"
          status={item.status}
        />
      </div>
    </article>
  );
}

function CompareChunkBlock({
  title,
  chunk,
  emptyText,
  parts,
  side,
  status
}: {
  title: string;
  chunk: CompareChunkPayload | null;
  emptyText: string;
  parts: CompareTextPart[];
  side: "before" | "after";
  status: DocumentVersionCompare["items"][number]["status"];
}) {
  return (
    <div className={`min-w-0 rounded-lg border p-3 ${compareBlockClass(side, status)}`}>
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
        <span className="font-semibold text-slate-700">{title}</span>
        {chunk && <span>{chunk.token_estimate} tokens</span>}
      </div>
      {chunk ? (
        <p className="max-h-80 overflow-auto whitespace-pre-wrap break-words text-sm leading-6 text-slate-700">
          {parts.length > 0 ? parts.map((part, index) => (
            <span key={`${part.kind}-${index}`} className={compareDiffPartClass(part.kind)}>
              {part.value}
            </span>
          )) : chunk.content}
        </p>
      ) : (
        <p className="text-sm text-slate-400">{emptyText}</p>
      )}
    </div>
  );
}

function DocumentPreviewPanel({
  preview,
  loading,
  targetChunkId,
  chunkWorkingId,
  chunkSuggestionWorking,
  chunkMetadataSuggestions,
  onPageChange,
  onSaveChunkGovernance,
  onGenerateChunkMetadataSuggestions,
  onSplitChunk,
  onMergeChunk,
  onClose
}: {
  preview: DocumentPreview;
  loading: boolean;
  targetChunkId: string | null;
  chunkWorkingId: string | null;
  chunkSuggestionWorking: boolean;
  chunkMetadataSuggestions: Record<string, ChunkMetadataSuggestion>;
  onPageChange: (offset: number) => void;
  onSaveChunkGovernance: (chunk: DocumentPreview["chunks"][number], input: ChunkGovernanceInput) => void;
  onGenerateChunkMetadataSuggestions: (chunks: DocumentPreview["chunks"]) => void;
  onSplitChunk: (chunk: DocumentPreview["chunks"][number], parts: string[]) => void;
  onMergeChunk: (chunk: DocumentPreview["chunks"][number], direction: "previous" | "next") => void;
  onClose: () => void;
}) {
  const groups = useMemo(() => groupDocumentPreviewChunks(preview.chunks), [preview.chunks]);
  const [selectedGroupKey, setSelectedGroupKey] = useState(groups[0]?.key ?? "");
  const targetChunkRef = useRef<HTMLDivElement | null>(null);
  const targetGroup = targetChunkId ? groups.find((group) => group.chunks.some((chunk) => chunk.id === targetChunkId)) : null;
  const selectedGroup = groups.find((group) => group.key === selectedGroupKey) ?? groups[0];
  const selectedGroupSuggestionTargets = selectedGroup?.chunks.filter(needsChunkMetadataSuggestion) ?? [];
  const previewOffset = preview.preview_offset ?? 0;
  const previewLimit = preview.preview_limit ?? preview.chunks.length;
  const previewStart = preview.total_chunks > 0 ? previewOffset + 1 : 0;
  const previewEnd = Math.min(preview.total_chunks, previewOffset + preview.chunks.length);
  const canPreviewSourceImage = canPreviewDocumentSourceImage(preview.document);
  const sourceImagePage = canPreviewSourceImage ? selectedGroup?.page ?? 1 : null;
  const parserSummary = useMemo(() => {
    const labels = Array.from(
      new Set(groups.map((group) => group.parser).filter((parser): parser is string => Boolean(parser)).map((parser) => parserLabel(parser)))
    );
    return labels.join("、") || "未知解析器";
  }, [groups]);
  const selectedChunkItems = selectedGroup?.chunks.map((chunk) => {
    const isTargetChunk = targetChunkId === chunk.id;
    const suggestion = chunkMetadataSuggestions[chunk.id] ?? pendingSuggestionFromChunk(chunk);

    return (
      <div
        key={chunk.id}
        ref={isTargetChunk ? targetChunkRef : undefined}
        className={`scroll-mt-24 px-4 py-3 ${isTargetChunk ? "bg-cyan/10 ring-2 ring-inset ring-cyan/30" : ""}`}
      >
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
          <span className="font-semibold text-brand">#{chunk.chunk_index + 1}</span>
          {isTargetChunk && (
            <span className="rounded-full bg-brand px-2 py-0.5 font-semibold text-white">QA 定位</span>
          )}
          <span>{chunk.token_estimate} tokens</span>
          {chunkPreviewMeta(chunk.metadata) && <span>{chunkPreviewMeta(chunk.metadata)}</span>}
          {chunk.metadata.summary && (
            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-700">已补摘要</span>
          )}
          {(chunk.metadata.synonyms?.length ?? 0) > 0 && (
            <span className="rounded-full bg-cyan/10 px-2 py-0.5 text-brand">同义词 {chunk.metadata.synonyms?.length}</span>
          )}
        </div>
        <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-slate-700">{chunk.content}</p>
        <ChunkGovernanceEditor
          chunk={chunk}
          suggestion={suggestion}
          workingId={chunkWorkingId}
          canMergePrevious={chunk.chunk_index > 0}
          canMergeNext={chunk.chunk_index < preview.total_chunks - 1}
          contentTruncated={chunk.content.endsWith("...")}
          onSave={(input) => onSaveChunkGovernance(chunk, input)}
          onSplit={(parts) => onSplitChunk(chunk, parts)}
          onMerge={(direction) => onMergeChunk(chunk, direction)}
        />
      </div>
    );
  }) ?? [];

  useEffect(() => {
    setSelectedGroupKey(targetGroup?.key ?? groups[0]?.key ?? "");
  }, [groups, targetGroup?.key]);

  useEffect(() => {
    if (!targetChunkId) {
      return;
    }

    window.setTimeout(() => {
      targetChunkRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 120);
  }, [selectedGroupKey, targetChunkId]);

  return (
    <div className="mt-5 overflow-hidden rounded-lg border border-line">
      <div className="flex flex-col gap-3 border-b border-line bg-slate-50 px-4 py-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h3 className="text-sm font-semibold text-ink">识别结果预览</h3>
          <p className="mt-1 text-xs text-slate-500">
            {preview.document.title} · 共 {preview.total_chunks} 个知识分片 · 当前 {previewStart}-{previewEnd} · {groups.length} 个页面/段落
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => onPageChange(Math.max(0, previewOffset - previewLimit))}
            disabled={loading || !preview.has_previous}
            className="ui-button-secondary h-11 px-3 text-xs disabled:cursor-not-allowed disabled:opacity-50 sm:h-8"
          >
            <ChevronLeft size={14} />
            上一批
          </button>
          <button
            type="button"
            onClick={() => onPageChange(previewOffset + previewLimit)}
            disabled={loading || !preview.has_next}
            className="ui-button-secondary h-11 px-3 text-xs disabled:cursor-not-allowed disabled:opacity-50 sm:h-8"
          >
            {loading ? <Loader2 className="animate-spin" size={14} /> : <ChevronRight size={14} />}
            下一批
          </button>
          <button
            type="button"
            onClick={onClose}
            className="ui-button-secondary h-11 px-3 text-xs sm:h-8"
          >
            关闭预览
          </button>
        </div>
      </div>

      <div className="grid gap-0 border-b border-line bg-white md:grid-cols-3">
        <DocumentMetric label="预览分片" value={preview.chunks.length} />
        <DocumentMetric label="页面/段落" value={groups.length} />
        <div className="ui-card-muted px-3 py-2">
          <p className="text-xs font-medium text-slate-500">解析方式</p>
          <p className="mt-1 line-clamp-1 text-sm font-semibold text-ink" title={parserSummary}>{parserSummary}</p>
        </div>
      </div>

      {preview.truncated && (
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs leading-5 text-amber-800">
          当前显示第 {previewStart}-{previewEnd} 个分片，资料总分片数为 {preview.total_chunks}。可用上一批/下一批检查后续 PPT、PDF 或 OCR 识别内容。
        </div>
      )}

      {targetChunkId && (
        <div className={`border-b px-4 py-2 text-xs leading-5 ${
          preview.target_chunk_found === false
            ? "border-amber-200 bg-amber-50 text-amber-800"
            : "border-cyan/20 bg-cyan/10 text-brand"
        }`}>
          {preview.target_chunk_found === false
            ? "未在当前资料中找到 QA 反查分片，可能已被拆分、合并或重新识别。"
            : "已定位 QA 反查分片，可直接展开下方“分片治理”处理摘要、关键词、拆分或合并。"}
        </div>
      )}

      {groups.length > 0 ? (
        <div className="grid max-h-[620px] min-h-[360px] bg-white 2xl:grid-cols-[230px_minmax(0,1fr)]">
          <div className="border-b border-line bg-slate-50/70 2xl:border-b-0 2xl:border-r">
            <div className="flex gap-2 overflow-x-auto px-3 py-3 2xl:max-h-[620px] 2xl:flex-col 2xl:overflow-y-auto">
              {groups.map((group) => (
                <button
                  key={group.key}
                  type="button"
                  onClick={() => setSelectedGroupKey(group.key)}
                  className={`min-h-11 min-w-40 rounded-lg border px-3 py-2 text-left transition 2xl:min-w-0 ${
                    selectedGroup?.key === group.key
                      ? "border-cyan bg-white text-brand shadow-sm"
                      : "border-line bg-white text-slate-600 hover:border-cyan/40 hover:text-brand"
                  }`}
                >
                  <span className="block truncate text-sm font-semibold">{group.label}</span>
                  <span className="mt-1 block truncate text-xs text-slate-500">{group.helper}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="min-w-0 overflow-y-auto">
            {selectedGroup && (
              <div className="border-b border-line px-4 py-3">
                <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                  <div>
                    <h4 className="text-sm font-semibold text-ink">{selectedGroup.label}</h4>
                    <p className="mt-1 text-xs text-slate-500">{selectedGroup.helper}</p>
                  </div>
                  <div className="flex flex-wrap gap-2 text-xs text-slate-500">
                    <span className="rounded-full bg-slate-100 px-2 py-1">{selectedGroup.chunks.length} 个分片</span>
                    <span className="rounded-full bg-slate-100 px-2 py-1">{selectedGroup.tokenEstimate} tokens</span>
                    <span className="rounded-full bg-slate-100 px-2 py-1">{selectedGroup.characterCount} 字符</span>
                    {selectedGroupSuggestionTargets.length > 0 && (
                      <span className="rounded-full bg-blue-50 px-2 py-1 text-blue-700">{selectedGroupSuggestionTargets.length} 个待补建议</span>
                    )}
                    <button
                      type="button"
                      onClick={() => onGenerateChunkMetadataSuggestions(selectedGroup.chunks)}
                      disabled={chunkSuggestionWorking || selectedGroupSuggestionTargets.length === 0}
                      className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg border border-blue-200 bg-white px-3 text-xs font-semibold text-blue-700 hover:bg-blue-50 disabled:cursor-not-allowed disabled:border-line disabled:text-slate-300 sm:min-h-8"
                    >
                      {chunkSuggestionWorking ? <Loader2 className="animate-spin" size={14} /> : <Sparkles size={14} />}
                      生成本页建议
                    </button>
                  </div>
                </div>
              </div>
            )}
            {sourceImagePage ? (
              <div className="grid bg-slate-50 2xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
                <div className="border-b border-line px-4 py-3 2xl:border-b-0 2xl:border-r">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold text-slate-600">
                        原页图像
                        {selectedGroup?.page ? ` · 第 ${selectedGroup.page} 页` : ""}
                      </p>
                      <p className="mt-1 text-[11px] leading-4 text-slate-500">用于核对 OCR 或 PDF 解析是否漏字、错字、错页。</p>
                    </div>
                    <a
                      href={`/api/documents/${preview.document.id}/pages/${sourceImagePage}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex min-h-10 shrink-0 items-center rounded-lg border border-line bg-white px-3 text-xs font-medium text-brand hover:bg-slate-50"
                    >
                      新窗口
                    </a>
                  </div>
                  <div className="max-h-[560px] overflow-auto rounded-lg border border-line bg-white">
                    <img
                      src={`/api/documents/${preview.document.id}/pages/${sourceImagePage}`}
                      alt={`${preview.document.title} 第 ${sourceImagePage} 页源图`}
                      className="mx-auto h-auto w-full max-w-5xl object-contain"
                      loading="lazy"
                    />
                  </div>
                </div>
                <div className="min-w-0 bg-white">
                  <div className="border-b border-line bg-white px-4 py-3">
                    <p className="text-xs font-semibold text-slate-600">识别文本与分片治理</p>
                    <p className="mt-1 text-[11px] leading-4 text-slate-500">
                      当前页 {selectedGroup?.chunks.length ?? 0} 个分片，合计 {selectedGroup?.tokenEstimate ?? 0} tokens。
                    </p>
                  </div>
                  <div className="max-h-[560px] divide-y divide-line overflow-y-auto">
                    {selectedChunkItems}
                  </div>
                </div>
              </div>
            ) : (
              <div className="divide-y divide-line">
                {selectedChunkItems}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="px-4 py-8 text-center text-sm text-slate-500">
          暂无可预览的识别文本。资料可能尚未解析成功，或未生成本地知识分片。
        </div>
      )}
    </div>
  );
}

function ChunkGovernanceEditor({
  chunk,
  suggestion,
  workingId,
  canMergePrevious,
  canMergeNext,
  contentTruncated,
  onSave,
  onSplit,
  onMerge
}: {
  chunk: DocumentPreview["chunks"][number];
  suggestion?: ChunkMetadataSuggestion;
  workingId: string | null;
  canMergePrevious: boolean;
  canMergeNext: boolean;
  contentTruncated: boolean;
  onSave: (input: ChunkGovernanceInput) => void;
  onSplit: (parts: string[]) => void;
  onMerge: (direction: "previous" | "next") => void;
}) {
  const [summary, setSummary] = useState(chunk.metadata.summary ?? "");
  const [keywordsText, setKeywordsText] = useState((chunk.metadata.keywords ?? []).join("，"));
  const [synonymsText, setSynonymsText] = useState((chunk.metadata.synonyms ?? []).join("，"));
  const [splitText, setSplitText] = useState(chunk.content);
  const splitParts = useMemo(() => splitGovernanceParts(splitText), [splitText]);
  const saving = workingId === `meta:${chunk.id}`;
  const splitting = workingId === `split:${chunk.id}`;
  const mergingPrevious = workingId === `merge:previous:${chunk.id}`;
  const mergingNext = workingId === `merge:next:${chunk.id}`;
  const busy = Boolean(workingId);

  useEffect(() => {
    setSummary(chunk.metadata.summary ?? "");
    setKeywordsText((chunk.metadata.keywords ?? []).join("，"));
    setSynonymsText((chunk.metadata.synonyms ?? []).join("，"));
    setSplitText(chunk.content);
  }, [chunk.id, chunk.content, chunk.metadata.keywords, chunk.metadata.summary, chunk.metadata.synonyms]);

  return (
    <details open={Boolean(suggestion) || undefined} className="mt-3 rounded-lg border border-line bg-slate-50/70">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 text-sm font-semibold text-ink marker:hidden">
        <span>分片治理</span>
        <span className="text-xs font-medium text-slate-500">摘要 / 同义词 / 拆分合并</span>
      </summary>
      <div className="border-t border-line p-3">
        {suggestion && (
          <div className="mb-3 rounded-lg border border-blue-200 bg-blue-50 p-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-800">
                  <Sparkles size={14} />
                  AI 治理建议
                </p>
                <p className="mt-1 text-xs leading-5 text-blue-700">
                  {suggestion.summary}
                </p>
                {(suggestion.model || suggestion.generated_at) && (
                  <p className="mt-1 text-xs leading-5 text-blue-600">
                    {suggestion.model ?? "AI 建议"}
                    {suggestion.generated_at ? ` · ${new Date(suggestion.generated_at).toLocaleString("zh-CN")}` : ""}
                  </p>
                )}
                <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
                  {suggestion.keywords.map((keyword) => (
                    <span key={`keyword:${keyword}`} className="rounded-full bg-white px-2 py-0.5 text-blue-700 ring-1 ring-blue-100">
                      {keyword}
                    </span>
                  ))}
                  {suggestion.synonyms.map((synonym) => (
                    <span key={`synonym:${synonym}`} className="rounded-full bg-white px-2 py-0.5 text-slate-600 ring-1 ring-blue-100">
                      {synonym}
                    </span>
                  ))}
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setSummary(suggestion.summary);
                  setKeywordsText(suggestion.keywords.join("，"));
                  setSynonymsText(suggestion.synonyms.join("，"));
                }}
                className="inline-flex min-h-10 shrink-0 items-center justify-center rounded-lg bg-blue-700 px-3 text-xs font-semibold text-white hover:bg-blue-800"
              >
                填入表单
              </button>
            </div>
          </div>
        )}
        <div className="grid gap-3 lg:grid-cols-2">
          <label className="block lg:col-span-2">
            <span className="mb-1.5 block text-xs font-medium text-slate-600">分片摘要</span>
            <textarea
              value={summary}
              onChange={(event) => setSummary(event.target.value)}
              rows={2}
              className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm leading-6 outline-none focus:border-brand"
              placeholder="用一两句话概括这段内容，帮助后续人工复核和检索召回。"
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-slate-600">关键词</span>
            <input
              value={keywordsText}
              onChange={(event) => setKeywordsText(event.target.value)}
              className="h-11 w-full rounded-lg border border-line bg-white px-3 text-sm outline-none focus:border-brand"
              placeholder="例如：Kass，文档上传，客户维护"
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-slate-600">同义词 / 口语问法</span>
            <input
              value={synonymsText}
              onChange={(event) => setSynonymsText(event.target.value)}
              className="h-11 w-full rounded-lg border border-line bg-white px-3 text-sm outline-none focus:border-brand"
              placeholder="例如：开始云，系统登录，资料更新"
            />
          </label>
        </div>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs leading-5 text-slate-500">
            关键词和同义词会参与本地 RAG 召回；多个词可用逗号或换行分隔。
          </p>
          <button
            type="button"
            onClick={() => onSave({
              summary,
              keywords: splitGovernanceList(keywordsText),
              synonyms: splitGovernanceList(synonymsText)
            })}
            disabled={saving || busy && !saving}
            className="ui-button-primary h-11 px-3 text-xs sm:h-10"
          >
            {saving ? <Loader2 className="animate-spin" size={14} /> : <Save size={14} />}
            保存治理
          </button>
        </div>

        <div className="mt-4 rounded-lg border border-slate-200 bg-white p-3">
          <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-xs font-semibold text-slate-700">手动拆分</p>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                在文本中用单独一行 `---` 分隔片段，提交后会重排分片索引并创建治理前快照。
              </p>
            </div>
            <button
              type="button"
              onClick={() => onSplit(splitParts)}
              disabled={contentTruncated || splitting || (busy && !splitting) || splitParts.length < 2}
              className="ui-button-secondary h-11 px-3 text-xs disabled:cursor-not-allowed disabled:opacity-50 sm:h-10"
            >
              {splitting ? <Loader2 className="animate-spin" size={14} /> : <RefreshCw size={14} />}
              拆分为 {Math.max(splitParts.length, 1)} 片
            </button>
          </div>
          <textarea
            value={splitText}
            onChange={(event) => setSplitText(event.target.value)}
            rows={5}
            disabled={contentTruncated}
            className="mt-3 w-full rounded-lg border border-line bg-white px-3 py-2 text-sm leading-6 outline-none focus:border-brand disabled:bg-slate-100 disabled:text-slate-400"
          />
          {contentTruncated && (
            <p className="mt-2 text-xs leading-5 text-amber-700">
              当前预览内容已截断。为了避免误删后半段内容，请先缩小预览范围或重新加载完整分片后再拆分。
            </p>
          )}
        </div>

        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onClick={() => onMerge("previous")}
            disabled={!canMergePrevious || mergingPrevious || (busy && !mergingPrevious)}
            className="ui-button-secondary h-11 px-3 text-xs disabled:cursor-not-allowed disabled:opacity-50 sm:h-10"
          >
            {mergingPrevious ? <Loader2 className="animate-spin" size={14} /> : <ChevronLeft size={14} />}
            合并上一片
          </button>
          <button
            type="button"
            onClick={() => onMerge("next")}
            disabled={!canMergeNext || mergingNext || (busy && !mergingNext)}
            className="ui-button-secondary h-11 px-3 text-xs disabled:cursor-not-allowed disabled:opacity-50 sm:h-10"
          >
            {mergingNext ? <Loader2 className="animate-spin" size={14} /> : <ChevronRight size={14} />}
            合并下一片
          </button>
        </div>
      </div>
    </details>
  );
}

function splitGovernanceList(value: string) {
  return value
    .split(/[,，、\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function needsChunkMetadataSuggestion(chunk: Pick<DocumentChunk, "metadata">) {
  return (!chunk.metadata.summary || (chunk.metadata.keywords ?? []).length === 0 || (chunk.metadata.synonyms ?? []).length === 0)
    && !chunk.metadata.pending_suggestion;
}

function pendingSuggestionFromChunk(chunk: Pick<DocumentChunk, "id" | "metadata">): ChunkMetadataSuggestion | undefined {
  const pending = chunk.metadata.pending_suggestion;
  if (!pending?.summary) {
    return undefined;
  }

  return {
    chunk_id: chunk.id,
    summary: pending.summary,
    keywords: pending.keywords ?? [],
    synonyms: pending.synonyms ?? [],
    model: pending.model,
    generated_at: pending.generated_at,
    job_id: pending.job_id
  };
}

function cleanChunkMetadataSuggestions(value: unknown): ChunkMetadataSuggestion[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => cleanChunkMetadataSuggestion(item))
    .filter((item): item is ChunkMetadataSuggestion => Boolean(item));
}

function cleanChunkMetadataSuggestion(value: unknown): ChunkMetadataSuggestion | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const item = value as Record<string, unknown>;
  const chunkId = typeof item.chunk_id === "string" ? item.chunk_id.trim() : "";
  const summary = typeof item.summary === "string" ? item.summary.trim() : "";
  const keywords = cleanSuggestionList(item.keywords);
  const synonyms = cleanSuggestionList(item.synonyms);

  if (!chunkId || !summary) {
    return null;
  }

  return {
    chunk_id: chunkId,
    summary,
    keywords,
    synonyms
  };
}

function cleanSuggestionList(value: unknown) {
  const rawItems = Array.isArray(value) ? value : [];
  const seen = new Set<string>();
  const result: string[] = [];

  for (const rawItem of rawItems) {
    const item = String(rawItem ?? "").replace(/\s+/g, " ").trim();
    const key = item.toLowerCase();

    if (!item || seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(item);
  }

  return result.slice(0, 12);
}

function splitGovernanceParts(value: string) {
  return value
    .split(/\n\s*-{3,}\s*\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function groupDocumentPreviewChunks(chunks: DocumentPreview["chunks"]): DocumentPreviewGroup[] {
  const groups = new Map<string, DocumentPreviewGroup>();

  for (const chunk of [...chunks].sort((a, b) => a.chunk_index - b.chunk_index)) {
    const metadata = chunk.metadata ?? {};
    const page = Number(metadata.page);
    const parser = metadata.parser ?? null;
    let key = "full";
    let label = "全文预览";
    let helper = parser ? parserLabel(parser) : "识别文本";

    if (Number.isFinite(page) && page > 0) {
      key = `page:${page}`;
      label = `第 ${page} 页`;
      helper = parser ? parserLabel(parser) : "分页文本";
    } else if (metadata.sheet) {
      key = `sheet:${metadata.sheet}:${metadata.cell_range ?? ""}`;
      label = `工作表：${metadata.sheet}`;
      helper = metadata.cell_range ?? (parser ? parserLabel(parser) : "表格内容");
    } else if (metadata.section) {
      key = `section:${metadata.section}`;
      label = metadata.section;
      helper = parser ? parserLabel(parser) : "章节文本";
    } else if (parser) {
      key = `parser:${parser}`;
      label = parserLabel(parser);
    }

    const current = groups.get(key);
    if (current) {
      current.chunks.push(chunk);
      current.tokenEstimate += chunk.token_estimate;
      current.characterCount += chunk.content.length;
      continue;
    }

    groups.set(key, {
      key,
      label,
      helper,
      parser,
      page: Number.isFinite(page) && page > 0 ? page : null,
      chunks: [chunk],
      tokenEstimate: chunk.token_estimate,
      characterCount: chunk.content.length
    });
  }

  return Array.from(groups.values());
}

function parserLabel(parser: string) {
  const labels: Record<string, string> = {
    pdf_text: "PDF 文本",
    pdf_ocr: "PDF OCR",
    ocr: "OCR",
    pptx: "PPTX",
    excel: "Excel",
    docx: "DOCX",
    text: "文本"
  };

  return labels[parser] ?? parser;
}

function DocumentFailureReason({
  document,
  diagnostic,
  versions
}: {
  document: DocumentRecord;
  diagnostic?: DocumentProcessingDiagnostic;
  versions: DocumentVersion[];
}) {
  const failedVersion = versions
    .filter((version) => version.document_id === document.id && version.status === "failed")
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];
  const reason = diagnostic?.last_error ?? failedVersion?.change_note;

  return (
    <div className="mt-2 max-w-full rounded-lg border border-red-100 bg-red-50 px-2.5 py-2 text-xs leading-5 text-red-700 md:max-w-64">
      <p className="font-medium">失败原因</p>
      <p className="mt-1">{reason || (document.storage_path ? "未记录详细原因，可点击重新识别查看新错误信息。" : "没有保留原文件，请重新上传。")}</p>
      {diagnostic?.ocr_applicable && (
        <p className="mt-1 text-red-600">
          {diagnostic.can_reprocess ? "配置 OCR 后可直接重新识别。" : "未保留原文件，需要重新上传后再识别。"}
        </p>
      )}
    </div>
  );
}

function DocumentStaleProcessingWarning({
  diagnostic
}: {
  diagnostic: DocumentProcessingDiagnostic;
}) {
  return (
    <div className="mt-2 max-w-full rounded-lg border border-amber-100 bg-amber-50 px-2.5 py-2 text-xs leading-5 text-amber-800 md:max-w-64">
      <p className="font-medium">处理时间较久</p>
      <p className="mt-1">
        已处理 {formatDurationFromMs(diagnostic.processing_age_ms)}。如果后台任务曾重启或 OCR/TTS 服务超时，可点击“重新入队”重新识别。
      </p>
    </div>
  );
}

function DocumentProcessingSummary({
  document,
  diagnostic,
  processingJob,
  ocrStatus
}: {
  document: DocumentRecord;
  diagnostic?: DocumentProcessingDiagnostic;
  processingJob?: DocumentProcessingJobSnapshot;
  ocrStatus: OcrStatus | null;
}) {
  const chips: string[] = [];
  const activeJob = processingJob && processingJob.stage !== "ready" && processingJob.stage !== "failed"
    ? processingJob
    : null;

  if (diagnostic?.chunk_count) {
    chips.push(`${diagnostic.chunk_count} 个分片`);
  }

  if (diagnostic?.parser_summary) {
    chips.push(diagnostic.parser_summary);
  }

  if (diagnostic?.page_count) {
    chips.push(`${diagnostic.page_count} 页`);
  }

  if (diagnostic?.is_stale_processing) {
    chips.push(`已处理 ${formatDurationFromMs(diagnostic.processing_age_ms)}`);
  }

  return (
    <div className="mt-1 max-w-56 text-xs leading-5 text-slate-500">
      <p>{documentStatusHint(document, diagnostic, ocrStatus)}</p>
      {activeJob && (
        <DocumentProcessingProgress job={activeJob} />
      )}
      {chips.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1">
          {chips.slice(0, 3).map((chip) => (
            <span key={chip} className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">
              {chip}
            </span>
          ))}
        </div>
      )}
      {diagnostic?.ocr_used && (
        <span className="mt-1 inline-flex rounded-full bg-cyan/10 px-2 py-0.5 text-[11px] font-medium text-brand">
          已走 OCR
        </span>
      )}
    </div>
  );
}

function DocumentProcessingProgress({ job }: { job: DocumentProcessingJobSnapshot }) {
  const hasPageProgress = typeof job.pages_total === "number" && job.pages_total > 0 && typeof job.pages_done === "number";
  const progressPercent = hasPageProgress
    ? Math.min(100, Math.max(0, Math.round(((job.pages_done ?? 0) / (job.pages_total || 1)) * 100)))
    : null;

  return (
    <div className="mt-2 rounded-lg border border-cyan/20 bg-cyan/10 px-2.5 py-2 text-[11px] leading-5 text-brand">
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold">{documentProcessingStageLabel(job.stage)}</span>
        {hasPageProgress && (
          <span>{job.pages_done}/{job.pages_total} 页</span>
        )}
      </div>
      <p className="mt-1 text-brand/80">{job.message}</p>
      {progressPercent !== null && (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white">
          <div className="h-full rounded-full bg-cyan" style={{ width: `${progressPercent}%` }} />
        </div>
      )}
    </div>
  );
}

function documentProcessingStageLabel(stage: DocumentProcessingJobSnapshot["stage"]) {
  const labels: Record<DocumentProcessingJobSnapshot["stage"], string> = {
    queued: "排队中",
    reading_source: "读取原文件",
    pdf_text: "PDF 文本解析",
    pdf_render: "PDF 转图片",
    ocr: "OCR 识别",
    chunking: "生成分片",
    saving: "保存入库",
    ready: "已完成",
    failed: "失败"
  };

  return labels[stage] ?? stage;
}

function DocumentMetric({
  label,
  value,
  tone
}: {
  label: string;
  value: number | string;
  tone?: "good" | "warn" | "bad";
}) {
  const toneClass =
    tone === "good"
      ? "text-emerald-700"
      : tone === "warn"
        ? "text-amber-700"
        : tone === "bad"
          ? "text-red-700"
          : "text-ink";

  return (
    <div className="ui-card-muted px-3 py-2">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className={`mt-1 text-xl font-semibold ${toneClass}`}>{value}</p>
    </div>
  );
}

function DocumentGovernancePanel({
  document,
  versions,
  permissionTemplates,
  users,
  departments,
  positions,
  saving,
  onSave,
  onWorkflow
}: {
  document: DocumentRecord;
  versions: DocumentVersion[];
  permissionTemplates: DocumentPermissionTemplate[];
  users: UserProfile[];
  departments: string[];
  positions: string[];
  saving: boolean;
  onSave: (input: {
    security_level: DocumentSecurityLevel;
    publish_status?: DocumentPublishStatus;
    acl_departments: string[];
    acl_positions: string[];
    acl_roles: Array<"admin" | "employee">;
    acl_users: string[];
  }) => void;
  onWorkflow: (
    action: "submit_review" | "approve_review" | "publish" | "archive" | "restore_draft",
    input: {
      security_level: DocumentSecurityLevel;
      acl_departments: string[];
      acl_positions: string[];
      acl_roles: Array<"admin" | "employee">;
      acl_users: string[];
      version_id?: string;
    }
  ) => void;
}) {
  const [open, setOpen] = useState(false);
  const [securityLevel, setSecurityLevel] = useState<DocumentSecurityLevel>(document.security_level);
  const [aclDepartments, setAclDepartments] = useState<string[]>(document.acl_departments);
  const [aclPositions, setAclPositions] = useState<string[]>(document.acl_positions);
  const [aclRoles, setAclRoles] = useState<Array<"admin" | "employee">>(document.acl_roles);
  const [aclUsers, setAclUsers] = useState<string[]>(document.acl_users);
  const [templateId, setTemplateId] = useState("");
  const [selectedVersionId, setSelectedVersionId] = useState("");

  useEffect(() => {
    setSecurityLevel(document.security_level);
    setAclDepartments(document.acl_departments);
    setAclPositions(document.acl_positions);
    setAclRoles(document.acl_roles);
    setAclUsers(document.acl_users);
    setTemplateId("");
    setSelectedVersionId([...versions].sort((a, b) => b.version - a.version)[0]?.id ?? "");
  }, [document, versions]);

  function toggleValue(value: string, values: string[], setter: (next: string[]) => void) {
    setter(values.includes(value) ? values.filter((item) => item !== value) : [...values, value]);
  }

  function applyTemplate() {
    const template = permissionTemplates.find((item) => item.id === templateId);
    if (!template) return;
    setSecurityLevel(template.security_level);
    setAclDepartments(template.acl_departments);
    setAclPositions(template.acl_positions);
    setAclRoles(template.acl_roles);
    setAclUsers(template.acl_users);
  }

  function governanceInput() {
    return {
      security_level: securityLevel,
      acl_departments: aclDepartments,
      acl_positions: aclPositions,
      acl_roles: aclRoles,
      acl_users: aclUsers
    };
  }

  const workflowActions = workflowActionOptions(document.publish_status);

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="ui-button-secondary h-11 px-3 text-xs sm:h-8"
      >
        {open ? "收起治理" : "权限治理"}
      </button>
      {open && (
        <div className="mt-3 w-full max-w-[420px] space-y-3 ui-card-muted p-3">
          <div>
            <span className="text-xs font-medium text-slate-600">权限模板</span>
            <div className="mt-1 flex gap-2">
              <select value={templateId} onChange={(event) => setTemplateId(event.target.value)} className="ui-input h-11 min-w-0 flex-1 px-2 text-xs">
                <option value="">不使用模板</option>
                {permissionTemplates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
              </select>
              <button type="button" onClick={applyTemplate} disabled={!templateId} className="ui-button-secondary min-h-11 shrink-0 px-3 text-xs">应用</button>
            </div>
          </div>
          <label className="block">
            <span className="text-xs font-medium text-slate-600">资料密级</span>
            <select
              value={securityLevel}
              onChange={(event) => setSecurityLevel(event.target.value as DocumentSecurityLevel)}
              className="mt-1 ui-input h-11 w-full px-2 text-xs sm:h-9"
            >
              <option value="public">公开资料</option>
              <option value="internal">内部资料</option>
              <option value="confidential">部门/保密资料</option>
              <option value="restricted">指定人员资料</option>
            </select>
          </label>
          <div>
            <span className="text-xs font-medium text-slate-600">发布状态</span>
            <div className="mt-1 rounded-lg border border-line bg-white px-2 py-2">
              <span className={`inline-flex rounded-full px-2 py-0.5 text-xs ${publishStatusClass(document.publish_status)}`}>
                {publishStatusLabel(document.publish_status)}
              </span>
              {document.published_at && (
                <p className="mt-1 text-[11px] leading-4 text-slate-500">
                  发布时间：{new Date(document.published_at).toLocaleString("zh-CN")}
                </p>
              )}
              {document.published_version && <p className="mt-1 text-[11px] leading-4 text-blue-700">当前线上版本：v{document.published_version}</p>}
            </div>
          </div>
          {(document.publish_status === "draft" || document.publish_status === "rejected") && (
            <label className="block">
              <span className="text-xs font-medium text-slate-600">提交审批版本</span>
              <select value={selectedVersionId} onChange={(event) => setSelectedVersionId(event.target.value)} className="mt-1 ui-input h-11 w-full px-2 text-xs sm:h-9">
                {versions.length === 0 && <option value="">暂无可提交版本</option>}
                {[...versions].sort((a, b) => b.version - a.version).map((version) => (
                  <option key={version.id} value={version.id}>v{version.version} · {version.change_note || version.title}</option>
                ))}
              </select>
              <span className="mt-1 block text-[11px] leading-4 text-slate-500">审核、发布和发布记录都会锁定到此版本。</span>
            </label>
          )}
          <MultiChoiceField
            label="可见部门"
            options={[...new Set([...departments, ...aclDepartments])]}
            selected={aclDepartments}
            onToggle={(value) => toggleValue(value, aclDepartments, setAclDepartments)}
            emptyText="暂无部门，请先在用户管理中完善部门。"
          />
          <MultiChoiceField
            label="可见岗位"
            options={[...new Set([...positions, ...aclPositions])]}
            selected={aclPositions}
            onToggle={(value) => toggleValue(value, aclPositions, setAclPositions)}
            emptyText="暂无岗位，请先在用户管理中完善岗位。"
          />
          <MultiChoiceField
            label="可见系统角色"
            options={["employee", "admin"]}
            optionLabels={{ employee: "员工", admin: "管理员" }}
            selected={aclRoles}
            onToggle={(value) => setAclRoles((current) => current.includes(value as "admin" | "employee")
              ? current.filter((item) => item !== value)
              : [...current, value as "admin" | "employee"])}
            emptyText=""
          />
          <label className="block">
            <span className="text-xs font-medium text-slate-600">指定员工</span>
            <select
              multiple
              value={aclUsers}
              onChange={(event) => setAclUsers(Array.from(event.currentTarget.selectedOptions).map((option) => option.value))}
              className="mt-1 ui-input min-h-28 w-full px-2 py-2 text-xs"
            >
              {users.map((user) => (
                <option key={user.id} value={user.id}>{user.name} · {user.department || "未分部门"} · {user.position || "未设岗位"}</option>
              ))}
            </select>
            <span className="mt-1 block text-[11px] leading-4 text-slate-500">按住 Ctrl 或 Command 可多选。密级仍会先校验员工账号的安全级别。</span>
          </label>
          <button
            type="button"
            onClick={() =>
              onSave({
                ...governanceInput()
              })
            }
            disabled={saving}
            className="ui-button-primary h-11 w-full px-3 text-xs sm:h-9"
          >
            {saving ? <Loader2 className="animate-spin" size={14} /> : <Save size={14} />}
            保存资料治理
          </button>
          {workflowActions.length > 0 && (
            <div className="grid gap-2">
              {workflowActions.map((action) => (
                <button
                  key={action.value}
                  type="button"
                  onClick={() => onWorkflow(action.value, {
                    ...governanceInput(),
                    version_id: action.value === "submit_review" ? selectedVersionId : undefined
                  })}
                  disabled={saving || (action.value === "submit_review" && !selectedVersionId)}
                  className={`h-11 w-full px-3 text-xs sm:h-9 ${
                    action.tone === "primary"
                      ? "ui-button-success"
                      : action.tone === "danger"
                        ? "ui-button-danger"
                        : "ui-button-secondary"
                  }`}
                >
                  {action.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function MultiChoiceField({
  label,
  options,
  selected,
  onToggle,
  emptyText,
  optionLabels = {}
}: {
  label: string;
  options: string[];
  selected: string[];
  onToggle: (value: string) => void;
  emptyText: string;
  optionLabels?: Record<string, string>;
}) {
  return (
    <fieldset>
      <legend className="text-xs font-medium text-slate-600">{label}</legend>
      <div className="mt-1 max-h-32 overflow-y-auto rounded-lg border border-line bg-white p-2">
        {options.length > 0 ? (
          <div className="grid gap-1 sm:grid-cols-2">
            {options.map((option) => (
              <label key={option} className="flex min-h-9 cursor-pointer items-center gap-2 rounded-md px-2 text-xs text-slate-700 hover:bg-slate-50">
                <input type="checkbox" checked={selected.includes(option)} onChange={() => onToggle(option)} className="size-4 accent-blue-600" />
                <span className="min-w-0 break-words">{optionLabels[option] ?? option}</span>
              </label>
            ))}
          </div>
        ) : <p className="px-1 py-2 text-xs text-slate-500">{emptyText}</p>}
      </div>
    </fieldset>
  );
}

function workflowActionOptions(status: DocumentPublishStatus): Array<{
  value: "submit_review" | "approve_review" | "publish" | "archive" | "restore_draft";
  label: string;
  tone: "primary" | "neutral" | "danger";
}> {
  if (status === "draft") {
    return [{ value: "submit_review", label: "提交审核", tone: "primary" }];
  }

  if (status === "pending_review") {
    return [{ value: "approve_review", label: "审核通过", tone: "primary" }];
  }

  if (status === "approved") {
    return [{ value: "publish", label: "正式发布", tone: "primary" }];
  }

  if (status === "published") {
    return [{ value: "archive", label: "归档资料", tone: "danger" }];
  }

  return [{ value: "restore_draft", label: "恢复草稿", tone: "neutral" }];
}

function securityLevelLabel(level: DocumentSecurityLevel) {
  const labels: Record<DocumentSecurityLevel, string> = {
    public: "公开",
    internal: "内部",
    confidential: "保密",
    restricted: "指定人员"
  };

  return labels[level];
}

function publishStatusLabel(status: DocumentPublishStatus) {
  const labels: Record<DocumentPublishStatus, string> = {
    draft: "草稿",
    pending_review: "待审核",
    approved: "已通过待发布",
    rejected: "已驳回",
    published: "已发布",
    archived: "已归档"
  };

  return labels[status];
}

function publishStatusClass(status: DocumentPublishStatus) {
  const classes: Record<DocumentPublishStatus, string> = {
    draft: "bg-slate-100 text-slate-600",
    pending_review: "bg-amber-100 text-amber-700",
    approved: "bg-cyan-100 text-cyan-800",
    rejected: "bg-rose-100 text-rose-700",
    published: "bg-emerald-100 text-emerald-700",
    archived: "bg-zinc-100 text-zinc-500"
  };

  return classes[status];
}

function noticeTone(message: string) {
  if (/(失败|错误|不存在|无法|超时|不可访问|未配置|不能为空)/.test(message)) {
    return "error" as const;
  }

  if (/(确认|请先|没有符合|没有待刷新|选中|暂无|未绑定)/.test(message)) {
    return "warning" as const;
  }

  if (/(已|成功|完成|创建|保存|删除|发布|归档|回滚|上传|提交)/.test(message)) {
    return "success" as const;
  }

  return "info" as const;
}

function noticeTitle(tone: ReturnType<typeof noticeTone>) {
  if (tone === "success") {
    return "操作完成";
  }

  if (tone === "error") {
    return "操作失败";
  }

  if (tone === "warning") {
    return "需要确认";
  }

  return "提示";
}

function compareStatusLabel(status: DocumentVersionCompare["items"][number]["status"]) {
  const labels: Record<DocumentVersionCompare["items"][number]["status"], string> = {
    same: "未变化",
    changed: "已变更",
    added: "新增",
    removed: "删除"
  };

  return labels[status];
}

function compareStatusClass(status: DocumentVersionCompare["items"][number]["status"]) {
  const classes: Record<DocumentVersionCompare["items"][number]["status"], string> = {
    same: "bg-slate-100 text-slate-600",
    changed: "bg-amber-100 text-amber-700",
    added: "bg-emerald-100 text-emerald-700",
    removed: "bg-red-100 text-red-700"
  };

  return classes[status];
}

function compareItemFrameClass(status: DocumentVersionCompare["items"][number]["status"]) {
  const classes: Record<DocumentVersionCompare["items"][number]["status"], string> = {
    same: "bg-white",
    changed: "bg-amber-50/50",
    added: "bg-emerald-50/50",
    removed: "bg-red-50/50"
  };

  return classes[status];
}

function compareBlockClass(side: "before" | "after", status: DocumentVersionCompare["items"][number]["status"]) {
  if (status === "removed" && side === "before") {
    return "border-red-200 bg-red-50";
  }

  if (status === "added" && side === "after") {
    return "border-emerald-200 bg-emerald-50";
  }

  if (status === "changed" && side === "before") {
    return "border-amber-200 bg-amber-50";
  }

  if (status === "changed" && side === "after") {
    return "border-emerald-200 bg-emerald-50/70";
  }

  return "border-line bg-slate-50";
}

function compareDiffPartClass(kind: CompareTextPart["kind"]) {
  const classes: Record<CompareTextPart["kind"], string> = {
    same: "",
    added: "rounded bg-emerald-200/70 px-0.5 text-emerald-950",
    removed: "rounded bg-red-200/70 px-0.5 text-red-950 line-through decoration-red-500"
  };

  return classes[kind];
}

function buildTextDiff(before: string, after: string) {
  if (!before && !after) {
    return { before: [], after: [], similarity: 1 };
  }

  if (!before) {
    return {
      before: [],
      after: after ? [{ value: after, kind: "added" as const }] : [],
      similarity: 0
    };
  }

  if (!after) {
    return {
      before: before ? [{ value: before, kind: "removed" as const }] : [],
      after: [],
      similarity: 0
    };
  }

  const beforeUnits = splitCompareUnits(before);
  const afterUnits = splitCompareUnits(after);
  const matches = longestCommonSubsequencePairs(beforeUnits, afterUnits);
  const beforeParts = buildDiffParts(beforeUnits, matches.map(([beforeIndex]) => beforeIndex), "removed");
  const afterParts = buildDiffParts(afterUnits, matches.map(([, afterIndex]) => afterIndex), "added");
  const sameCharacters = matches.reduce((sum, [beforeIndex]) => sum + beforeUnits[beforeIndex].length, 0);
  const similarity = sameCharacters / Math.max(before.length, after.length, 1);

  return { before: beforeParts, after: afterParts, similarity };
}

function splitCompareUnits(value: string) {
  const normalized = value.replace(/\r\n/g, "\n");
  const sentenceUnits = normalized.match(/[\s]+|[^。！？；;.!?\n]+[。！？；;.!?]?|\n/g) ?? [normalized];
  const units: string[] = [];

  for (const unit of sentenceUnits) {
    if (unit.length <= 56 || /^\s+$/.test(unit)) {
      units.push(unit);
      continue;
    }

    for (let index = 0; index < unit.length; index += 32) {
      units.push(unit.slice(index, index + 32));
    }
  }

  return units.filter((unit) => unit.length > 0);
}

function longestCommonSubsequencePairs(before: string[], after: string[]) {
  const rows = before.length + 1;
  const columns = after.length + 1;
  const table = Array.from({ length: rows }, () => Array<number>(columns).fill(0));

  for (let row = before.length - 1; row >= 0; row -= 1) {
    for (let column = after.length - 1; column >= 0; column -= 1) {
      table[row][column] = before[row] === after[column]
        ? table[row + 1][column + 1] + 1
        : Math.max(table[row + 1][column], table[row][column + 1]);
    }
  }

  const pairs: Array<[number, number]> = [];
  let row = 0;
  let column = 0;

  while (row < before.length && column < after.length) {
    if (before[row] === after[column]) {
      pairs.push([row, column]);
      row += 1;
      column += 1;
    } else if (table[row + 1][column] >= table[row][column + 1]) {
      row += 1;
    } else {
      column += 1;
    }
  }

  return pairs;
}

function buildDiffParts(units: string[], sameIndexes: number[], changedKind: "added" | "removed") {
  const sameIndexSet = new Set(sameIndexes);
  const parts: CompareTextPart[] = [];

  for (let index = 0; index < units.length; index += 1) {
    const kind: CompareTextPart["kind"] = sameIndexSet.has(index) ? "same" : changedKind;
    const previous = parts[parts.length - 1];

    if (previous?.kind === kind) {
      previous.value += units[index];
    } else {
      parts.push({ value: units[index], kind });
    }
  }

  return parts;
}

function chunkPreviewMeta(metadata: DocumentChunk["metadata"]) {
  const parts: string[] = [];

  if (metadata.page) {
    parts.push(`第 ${metadata.page} 页`);
  }

  if (metadata.section) {
    parts.push(metadata.section);
  }

  if (metadata.sheet) {
    parts.push(`工作表：${metadata.sheet}`);
  }

  if (metadata.cell_range) {
    parts.push(metadata.cell_range);
  }

  if (metadata.parser) {
    parts.push(`解析器：${metadata.parser}`);
  }

  return parts.join(" · ");
}

function waitForPreviewRetry(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function canPreviewDocumentSourceImage(document: DocumentRecord) {
  const lowerName = document.file_name.toLowerCase();
  return document.file_type === "application/pdf" ||
    document.file_type.startsWith("image/") ||
    /\.(pdf|png|jpe?g|webp|bmp|tiff?)$/i.test(lowerName);
}

function documentStatusHint(
  document: DocumentRecord,
  diagnostic?: DocumentProcessingDiagnostic,
  ocrStatus?: OcrStatus | null
) {
  if (document.status === "ready") {
    if (document.publish_status !== "published") {
      return "已解析完成，发布后才会进入员工检索。";
    }

    return "已可被员工端问答检索。";
  }

  if (document.status === "processing" || document.status === "uploading") {
    if (diagnostic?.is_stale_processing) {
      return "后台处理已超时，可能被中断，可重新入队。";
    }

    return "正在后台解析/OCR 并生成知识分片，页面会自动刷新状态。";
  }

  if (document.status === "failed") {
    if (diagnostic?.ocr_applicable && ocrStatus?.local_text && !ocrStatus.configured) {
      return "处理失败，可能需要先配置 OCR 后重新识别。";
    }

    if (diagnostic && !diagnostic.can_reprocess) {
      return "处理失败，未保留原文件，请重新上传。";
    }

    return "处理失败，可尝试重新识别/OCR；若未保留原文件请重新上传。";
  }

  return "等待处理。";
}
