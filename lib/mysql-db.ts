import { cookies } from "next/headers";
import { sessionCookieName, verifySessionToken } from "@/lib/auth-session";
import { createId, demoUser } from "@/lib/mock-store";
import { mysqlBatchQuery, mysqlExecute, mysqlQuery, mysqlTransaction, parseJson, toIsoString } from "@/lib/mysql";
import { hashPassword } from "@/lib/password";
import { createConversationTitleFromMessage, isDefaultConversationTitle } from "@/lib/conversation-title";
import { calculateTicketDueAt, isTicketClosedStatus, resolveTicketResolvedAt } from "@/lib/service-ticket-rules";
import { gradeTrainingExam, prepareExamQuestions } from "@/lib/training-quiz";
import type {
  AppNotification,
  Conversation,
  ConversationArchiveFilter,
  ConversationMessageStats,
  Citation,
  DeployOperationStats,
  DocumentApprovalEvent,
  DocumentApprovalRequest,
  DocumentChunk,
  DocumentChunkDiagnosticStats,
  DocumentChunkGovernanceAuditSource,
  DocumentChunkMetadata,
  DocumentChunkPendingSuggestionSource,
  DocumentRecord,
  DocumentPermissionTemplate,
  DocumentPublishStatus,
  DocumentReviewerAssignment,
  DocumentSecurityLevel,
  DocumentVersion,
  DocumentVersionChunk,
  Feedback,
  KnowledgeBase,
  KnowledgeTask,
  Message,
  ModelUsageEvent,
  QaTestCase,
  SecurityEvent,
  SecurityEventCategory,
  SecuritySeverity,
  ServiceTicket,
  ServiceTicketComment,
  ServiceTicketPriority,
  TrainingJob,
  TrainingAuditEvent,
  TrainingProgress,
  TrainingQuizAttempt,
  TrainingQuizQuestion,
  TrainingExamSession,
  TrainingCertificate,
  TrainingVideoJob,
  UserProfile,
  WorkflowReadinessStats
} from "@/lib/types";

type Row = Record<string, any>;

function userFromRow(row: Row): UserProfile {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    department: row.department ?? "",
    position: row.position ?? "",
    security_clearance: normalizeDocumentSecurityLevel(row.security_clearance),
    status: row.status ?? "active",
    auth_provider: row.auth_provider ?? null,
    external_subject: row.external_subject ?? null,
    created_at: toIsoString(row.created_at)
  };
}

function knowledgeBaseFromRow(row: Row): KnowledgeBase {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    openai_vector_store_id: row.openai_vector_store_id,
    visibility: row.visibility,
    departments: parseJson<string[]>(row.departments, []),
    positions: parseJson<string[]>(row.positions, []),
    created_by: row.created_by,
    created_at: toIsoString(row.created_at)
  };
}

function documentFromRow(row: Row): DocumentRecord {
  return {
    id: row.id,
    knowledge_base_id: row.knowledge_base_id,
    title: row.title,
    file_name: row.file_name,
    file_type: row.file_type,
    storage_path: row.storage_path,
    openai_file_id: row.openai_file_id,
    status: row.status,
    department: row.department,
    tags: parseJson<string[]>(row.tags, []),
    security_level: normalizeDocumentSecurityLevel(row.security_level),
    publish_status: normalizeDocumentPublishStatus(row.publish_status),
    acl_departments: parseJson<string[]>(row.acl_departments, []),
    acl_positions: parseJson<string[]>(row.acl_positions, []),
    acl_roles: parseJson<DocumentRecord["acl_roles"]>(row.acl_roles, []),
    acl_users: parseJson<string[]>(row.acl_users, []),
    approved_by: row.approved_by ?? null,
    approved_at: row.approved_at ? toIsoString(row.approved_at) : null,
    published_by: row.published_by ?? null,
    published_at: row.published_at ? toIsoString(row.published_at) : null,
    published_version_id: row.published_version_id ?? null,
    published_version: row.published_version === null || row.published_version === undefined ? null : Number(row.published_version),
    created_by: row.created_by,
    created_at: toIsoString(row.created_at),
    updated_at: toIsoString(row.updated_at ?? row.created_at)
  };
}

function normalizeDocumentSecurityLevel(value: unknown): DocumentSecurityLevel {
  if (value === "public" || value === "confidential" || value === "restricted") {
    return value;
  }

  return "internal";
}

function normalizeDocumentPublishStatus(value: unknown): DocumentPublishStatus {
  if (
    value === "draft" ||
    value === "pending_review" ||
    value === "approved" ||
    value === "rejected" ||
    value === "archived"
  ) {
    return value;
  }

  return "published";
}

function documentReviewerAssignmentFromRow(row: Row): DocumentReviewerAssignment {
  return {
    id: row.id,
    user_id: row.user_id,
    reviewer_type: row.reviewer_type,
    knowledge_base_ids: parseJson<string[]>(row.knowledge_base_ids, []),
    departments: parseJson<string[]>(row.departments, []),
    security_levels: parseJson<DocumentSecurityLevel[]>(row.security_levels, []),
    can_review: Boolean(row.can_review),
    can_publish: Boolean(row.can_publish),
    active: Boolean(row.active),
    created_by: row.created_by ?? null,
    created_at: toIsoString(row.created_at),
    updated_at: toIsoString(row.updated_at)
  };
}

function documentApprovalRequestFromRow(row: Row): DocumentApprovalRequest {
  return {
    id: row.id,
    document_id: row.document_id,
    document_version_id: row.document_version_id ?? null,
    status: row.status,
    submitted_by: row.submitted_by,
    submitted_at: toIsoString(row.submitted_at),
    reviewed_by: row.reviewed_by ?? null,
    reviewed_at: row.reviewed_at ? toIsoString(row.reviewed_at) : null,
    review_comment: row.review_comment ?? null,
    published_by: row.published_by ?? null,
    published_at: row.published_at ? toIsoString(row.published_at) : null,
    withdrawn_by: row.withdrawn_by ?? null,
    withdrawn_at: row.withdrawn_at ? toIsoString(row.withdrawn_at) : null,
    created_at: toIsoString(row.created_at),
    updated_at: toIsoString(row.updated_at)
  };
}

function documentApprovalEventFromRow(row: Row): DocumentApprovalEvent {
  return {
    id: row.id,
    request_id: row.request_id ?? null,
    document_id: row.document_id,
    action: row.action,
    actor_id: row.actor_id,
    actor_name: row.actor_name,
    actor_role: row.actor_role,
    comment: row.comment ?? null,
    from_status: row.from_status ? normalizeDocumentPublishStatus(row.from_status) : null,
    to_status: row.to_status ? normalizeDocumentPublishStatus(row.to_status) : null,
    metadata: parseJson<Record<string, unknown>>(row.metadata, {}),
    created_at: toIsoString(row.created_at)
  };
}

function documentPermissionTemplateFromRow(row: Row): DocumentPermissionTemplate {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? null,
    security_level: normalizeDocumentSecurityLevel(row.security_level),
    acl_departments: parseJson<string[]>(row.acl_departments, []),
    acl_positions: parseJson<string[]>(row.acl_positions, []),
    acl_roles: parseJson<DocumentPermissionTemplate["acl_roles"]>(row.acl_roles, []),
    acl_users: parseJson<string[]>(row.acl_users, []),
    created_by: row.created_by ?? null,
    created_at: toIsoString(row.created_at),
    updated_at: toIsoString(row.updated_at)
  };
}

function documentVersionFromRow(row: Row): DocumentVersion {
  return {
    id: row.id,
    document_id: row.document_id,
    knowledge_base_id: row.knowledge_base_id,
    version: Number(row.version ?? 1),
    title: row.title,
    file_name: row.file_name,
    file_type: row.file_type,
    status: row.status,
    change_note: row.change_note,
    created_by: row.created_by,
    created_at: toIsoString(row.created_at)
  };
}

function chunkFromRow(row: Row): DocumentChunk {
  return {
    id: row.id,
    document_id: row.document_id,
    knowledge_base_id: row.knowledge_base_id,
    chunk_index: Number(row.chunk_index),
    content: row.content,
    token_estimate: Number(row.token_estimate ?? 0),
    metadata: parseJson<DocumentChunk["metadata"]>(row.metadata, {}),
    created_at: toIsoString(row.created_at)
  };
}

function chunkMetadataFromRow(row: Row): DocumentChunkMetadata {
  return {
    document_id: row.document_id,
    knowledge_base_id: row.knowledge_base_id,
    metadata: parseJson<DocumentChunk["metadata"]>(row.metadata, {})
  };
}

function chunkGovernanceAuditSourceFromRow(row: Row): DocumentChunkGovernanceAuditSource {
  return {
    id: row.id,
    document_id: row.document_id,
    knowledge_base_id: row.knowledge_base_id,
    chunk_index: Number(row.chunk_index),
    token_estimate: Number(row.token_estimate ?? 0),
    metadata: parseJson<DocumentChunk["metadata"]>(row.metadata, {}),
    content_preview: String(row.content_preview ?? "").replace(/\s+/g, " ").trim(),
    document_title: row.document_title ?? "未知资料",
    file_name: row.file_name ?? "",
    knowledge_base_name: row.knowledge_base_name ?? "未知知识库"
  };
}

function chunkDiagnosticStatsFromRow(row: Row): DocumentChunkDiagnosticStats {
  const parsers = typeof row.parsers === "string"
    ? row.parsers.split(",").map((parser) => parser.trim()).filter(Boolean)
    : [];

  return {
    document_id: row.document_id,
    knowledge_base_id: row.knowledge_base_id ?? null,
    chunk_count: Number(row.chunk_count ?? 0),
    page_count: Number(row.page_count ?? 0),
    parsers,
    total_tokens: Number(row.total_tokens ?? 0),
    average_tokens: Number(row.average_tokens ?? 0),
    min_tokens: Number(row.min_tokens ?? 0),
    max_tokens: Number(row.max_tokens ?? 0),
    empty_chunks: Number(row.empty_chunks ?? 0),
    short_chunks: Number(row.short_chunks ?? 0),
    long_chunks: Number(row.long_chunks ?? 0),
    noisy_chunks: Number(row.noisy_chunks ?? 0)
  };
}

function buildInClause(column: string, values: string[], prefix: string) {
  const params: Record<string, string> = {};
  const placeholders = values.map((value, index) => {
    const key = `${prefix}${index}`;
    params[key] = value;
    return `:${key}`;
  });

  return {
    clause: `${column} in (${placeholders.join(", ")})`,
    params
  };
}

function documentVersionChunkFromRow(row: Row): DocumentVersionChunk {
  return {
    id: row.id,
    document_version_id: row.document_version_id,
    document_id: row.document_id,
    knowledge_base_id: row.knowledge_base_id,
    chunk_index: Number(row.chunk_index),
    content: row.content,
    token_estimate: Number(row.token_estimate ?? 0),
    metadata: parseJson<DocumentChunk["metadata"]>(row.metadata, {}),
    created_at: toIsoString(row.created_at)
  };
}

function conversationFromRow(row: Row): Conversation {
  return {
    id: row.id,
    user_id: row.user_id,
    title: row.title,
    archived_at: row.archived_at ? toIsoString(row.archived_at) : null,
    pinned_at: row.pinned_at ? toIsoString(row.pinned_at) : null,
    deleted_at: row.deleted_at ? toIsoString(row.deleted_at) : null,
    created_at: toIsoString(row.created_at),
    updated_at: toIsoString(row.updated_at)
  };
}

function messageFromRow(row: Row): Message {
  return {
    id: row.id,
    conversation_id: row.conversation_id,
    role: row.role,
    content: row.content,
    citations: parseJson<Message["citations"]>(row.citations, []),
    model: row.model,
    created_at: toIsoString(row.created_at)
  };
}

function messageSummaryFromRow(row: Row): Message {
  const citationCount = Number(row.citation_count ?? 0);
  const citations: Message["citations"] = [];

  for (let index = 0; index < Math.min(citationCount, 3); index += 1) {
    const prefix = `citation_${index}_`;
    const fileId = row[`${prefix}file_id`];
    const fileName = row[`${prefix}file_name`];
    const page = row[`${prefix}page`];
    const section = row[`${prefix}section`];
    const score = row[`${prefix}score`];
    const scoreReason = row[`${prefix}score_reason`];

    citations.push({
      index: Number(row[`${prefix}index`] ?? index + 1),
      file_id: fileId ? String(fileId) : undefined,
      file_name: fileName ? String(fileName) : undefined,
      page: page === null || page === undefined ? undefined : Number(page),
      section: section ? String(section) : undefined,
      sheet: row[`${prefix}sheet`] ? String(row[`${prefix}sheet`]) : undefined,
      cell_range: row[`${prefix}cell_range`] ? String(row[`${prefix}cell_range`]) : undefined,
      score: score === null || score === undefined ? undefined : Number(score),
      score_reason: scoreReason ? String(scoreReason) : undefined
    });
  }

  return {
    id: row.id,
    conversation_id: row.conversation_id,
    role: row.role,
    content: row.content,
    citations,
    model: row.model,
    created_at: toIsoString(row.created_at)
  };
}

function modelUsageEventFromRow(row: Row): ModelUsageEvent {
  return {
    id: row.id,
    source: row.source,
    source_id: row.source_id ?? null,
    conversation_id: row.conversation_id ?? null,
    user_id: row.user_id ?? null,
    provider: row.provider ?? null,
    model: row.model ?? null,
    input_tokens: Number(row.input_tokens ?? 0),
    output_tokens: Number(row.output_tokens ?? 0),
    total_tokens: Number(row.total_tokens ?? 0),
    estimated: row.estimated === true || row.estimated === 1 || row.estimated === "1",
    cost_usd: row.cost_usd === null || row.cost_usd === undefined ? null : Number(row.cost_usd),
    metadata: parseJson<Record<string, unknown>>(row.metadata, {}),
    created_at: toIsoString(row.created_at)
  };
}

function feedbackFromRow(row: Row): Feedback {
  return {
    id: row.id,
    message_id: row.message_id,
    user_id: row.user_id,
    rating: row.rating,
    comment: row.comment,
    status: row.status,
    resolution_note: row.resolution_note,
    needs_knowledge_update: Boolean(row.needs_knowledge_update),
    created_at: toIsoString(row.created_at)
  };
}

function taskFromRow(row: Row): KnowledgeTask {
  return {
    id: row.id,
    source: row.source,
    source_id: row.source_id,
    conversation_id: row.conversation_id,
    question: row.question,
    answer: row.answer,
    status: row.status,
    note: row.note,
    created_by: row.created_by,
    created_at: toIsoString(row.created_at),
    updated_at: toIsoString(row.updated_at)
  };
}

function normalizeTicketPriority(value: unknown): ServiceTicketPriority {
  if (value === "low" || value === "high" || value === "urgent") {
    return value;
  }

  return "normal";
}

function serviceTicketFromRow(row: Row): ServiceTicket {
  return {
    id: row.id,
    conversation_id: row.conversation_id,
    message_id: row.message_id ?? null,
    user_id: row.user_id,
    title: row.title,
    description: row.description,
    status: row.status ?? "pending",
    priority: normalizeTicketPriority(row.priority),
    assignee_id: row.assignee_id ?? null,
    resolution_note: row.resolution_note ?? null,
    due_at: row.due_at ? toIsoString(row.due_at) : null,
    resolved_at: row.resolved_at ? toIsoString(row.resolved_at) : null,
    created_at: toIsoString(row.created_at),
    updated_at: toIsoString(row.updated_at ?? row.created_at)
  };
}

function serviceTicketCommentFromRow(row: Row): ServiceTicketComment {
  return {
    id: row.id,
    ticket_id: row.ticket_id,
    author_id: row.author_id,
    author_role: row.author_role === "admin" ? "admin" : "employee",
    body: row.body,
    is_internal: row.is_internal === true || row.is_internal === 1 || row.is_internal === "1",
    created_at: toIsoString(row.created_at)
  };
}

function normalizeSecurityEventCategory(value: unknown): SecurityEventCategory {
  if (value === "sensitive_output" || value === "prompt_injection" || value === "abnormal_access") {
    return value;
  }

  return "sensitive_input";
}

function normalizeSecuritySeverity(value: unknown): SecuritySeverity {
  if (value === "low" || value === "high" || value === "critical") {
    return value;
  }

  return "medium";
}

function securityEventFromRow(row: Row): SecurityEvent {
  return {
    id: row.id,
    category: normalizeSecurityEventCategory(row.category),
    severity: normalizeSecuritySeverity(row.severity),
    user_id: row.user_id ?? null,
    conversation_id: row.conversation_id ?? null,
    message_id: row.message_id ?? null,
    title: row.title,
    detail: row.detail,
    raw_excerpt: row.raw_excerpt ?? null,
    masked_excerpt: row.masked_excerpt ?? null,
    metadata: parseJson<Record<string, unknown>>(row.metadata, {}),
    status: row.status ?? "pending",
    created_at: toIsoString(row.created_at),
    resolved_at: row.resolved_at ? toIsoString(row.resolved_at) : null
  };
}

function notificationFromRow(row: Row): AppNotification {
  return {
    id: row.id,
    user_id: row.user_id,
    category: row.category,
    severity: row.severity,
    title: row.title,
    body: row.body,
    href: row.href ?? null,
    source_type: row.source_type,
    source_id: row.source_id ?? null,
    dedupe_key: row.dedupe_key ?? null,
    metadata: parseJson<Record<string, unknown>>(row.metadata, {}),
    read_at: row.read_at ? toIsoString(row.read_at) : null,
    created_at: toIsoString(row.created_at)
  };
}

function trainingFromRow(row: Row): TrainingJob {
  return {
    id: row.id,
    title: row.title,
    description: row.description ?? "",
    instructor: row.instructor ?? "",
    cover_url: row.cover_url ?? null,
    visible_departments: parseJson<string[]>(row.visible_departments, []),
    mandatory: Boolean(row.mandatory),
    due_at: row.due_at ? toIsoString(row.due_at) : null,
    quiz_enabled: row.quiz_enabled === undefined ? false : Boolean(row.quiz_enabled),
    quiz_pass_score: Number(row.quiz_pass_score ?? 80),
    quiz_max_attempts: Number(row.quiz_max_attempts ?? 3),
    quiz_time_limit_minutes: Number(row.quiz_time_limit_minutes ?? 30),
    certificate_enabled: row.certificate_enabled === undefined ? true : Boolean(row.certificate_enabled),
    ppt_file_name: row.ppt_file_name,
    ppt_storage_path: row.ppt_storage_path,
    script_json: parseJson<TrainingJob["script_json"]>(row.script_json, []),
    audio_paths: parseJson<string[]>(row.audio_paths, []),
    status: row.status,
    publish_status: row.publish_status ?? "published",
    published_by: row.published_by ?? null,
    published_at: row.published_at ? toIsoString(row.published_at) : null,
    created_by: row.created_by,
    created_at: toIsoString(row.created_at)
  };
}

function trainingProgressFromRow(row: Row): TrainingProgress {
  return {
    id: row.id,
    training_job_id: row.training_job_id,
    user_id: row.user_id,
    completed_pages: parseJson<number[]>(row.completed_pages, []),
    current_page: Number(row.current_page ?? 0),
    progress_percent: Number(row.progress_percent ?? 0),
    page_learning_seconds: parseJson<Record<string, number>>(row.page_learning_seconds, {}),
    total_learning_seconds: Number(row.total_learning_seconds ?? 0),
    playback_position_seconds: Number(row.playback_position_seconds ?? 0),
    last_active_at: row.last_active_at ? toIsoString(row.last_active_at) : null,
    completed_at: row.completed_at ? toIsoString(row.completed_at) : null,
    created_at: toIsoString(row.created_at),
    updated_at: toIsoString(row.updated_at ?? row.created_at)
  };
}

function trainingQuizAttemptFromRow(row: Row): TrainingQuizAttempt {
  return {
    id: row.id,
    training_job_id: row.training_job_id,
    user_id: row.user_id,
    session_id: row.session_id ?? null,
    answers: parseJson<Record<string, string | string[]>>(row.answers, {}),
    result_detail: parseJson<TrainingQuizAttempt["result_detail"]>(row.result_detail, []),
    score: Number(row.score ?? 0),
    passed: Boolean(row.passed),
    attempt_number: Number(row.attempt_number ?? 1),
    duration_seconds: Number(row.duration_seconds ?? 0),
    started_at: toIsoString(row.started_at ?? row.created_at),
    submitted_at: toIsoString(row.submitted_at ?? row.created_at),
    created_at: toIsoString(row.created_at)
  };
}

function trainingQuizQuestionFromRow(row: Row): TrainingQuizQuestion {
  return {
    id: row.id,
    training_job_id: row.training_job_id,
    type: row.type,
    prompt: row.prompt,
    options: parseJson<string[]>(row.options, []),
    correct_answers: parseJson<string[]>(row.correct_answers, []),
    explanation: row.explanation ?? "",
    score_weight: Number(row.score_weight ?? 1),
    order_index: Number(row.order_index ?? 0),
    status: row.status ?? "draft",
    created_by: row.created_by ?? null,
    created_at: toIsoString(row.created_at),
    updated_at: toIsoString(row.updated_at ?? row.created_at)
  };
}

function trainingExamSessionFromRow(row: Row): TrainingExamSession {
  return {
    id: row.id,
    training_job_id: row.training_job_id,
    user_id: row.user_id,
    question_snapshot: parseJson<TrainingQuizQuestion[]>(row.question_snapshot, []),
    status: row.status,
    started_at: toIsoString(row.started_at),
    expires_at: toIsoString(row.expires_at),
    submitted_at: row.submitted_at ? toIsoString(row.submitted_at) : null,
    created_at: toIsoString(row.created_at)
  };
}

function trainingCertificateFromRow(row: Row): TrainingCertificate {
  return {
    id: row.id,
    certificate_no: row.certificate_no,
    training_job_id: row.training_job_id,
    user_id: row.user_id,
    quiz_attempt_id: row.quiz_attempt_id,
    issued_at: toIsoString(row.issued_at),
    revoked_at: row.revoked_at ? toIsoString(row.revoked_at) : null,
    revoked_by: row.revoked_by ?? null,
    revoke_reason: row.revoke_reason ?? null,
    created_at: toIsoString(row.created_at)
  };
}

function trainingVideoJobFromRow(row: Row): TrainingVideoJob {
  return {
    id: row.id,
    training_job_id: row.training_job_id,
    provider: row.provider,
    provider_job_id: row.provider_job_id ?? null,
    status: row.status ?? "queued",
    video_url: row.video_url ?? null,
    cover_url: row.cover_url ?? null,
    error_message: row.error_message ?? null,
    avatar_id: row.avatar_id ?? null,
    voice_id: row.voice_id ?? null,
    script_summary: row.script_summary ?? null,
    metadata: parseJson<Record<string, unknown>>(row.metadata, {}),
    created_by: row.created_by ?? null,
    created_at: toIsoString(row.created_at),
    updated_at: toIsoString(row.updated_at ?? row.created_at)
  };
}

function qaTestCaseFromRow(row: Row): QaTestCase {
  return {
    id: row.id,
    question: row.question,
    expected_answer: row.expected_answer,
    knowledge_base_ids: parseJson<string[]>(row.knowledge_base_ids, []),
    answer: row.answer,
    citations: parseJson<QaTestCase["citations"]>(row.citations, []),
    citation_count: row.citation_count === undefined ? undefined : Number(row.citation_count ?? 0),
    model: row.model,
    status: row.status,
    reviewer_note: row.reviewer_note,
    latency_ms: row.latency_ms === null || row.latency_ms === undefined ? null : Number(row.latency_ms),
    created_by: row.created_by,
    created_at: toIsoString(row.created_at),
    updated_at: toIsoString(row.updated_at)
  };
}

function qaTestCaseSummaryFromRow(row: Row): QaTestCase {
  const citationCount = Number(row.citation_count ?? 0);
  const citations: QaTestCase["citations"] = [];

  for (let index = 0; index < Math.min(citationCount, 3); index += 1) {
    const prefix = `citation_${index}_`;
    const fileId = row[`${prefix}file_id`];
    const fileName = row[`${prefix}file_name`];
    const quote = row[`${prefix}quote`];
    const page = row[`${prefix}page`];
    const section = row[`${prefix}section`];
    const score = row[`${prefix}score`];
    const scoreReason = row[`${prefix}score_reason`];
    const matchSignals = parseJson<Citation["match_signals"]>(row[`${prefix}match_signals`], undefined);
    const matchSignalTerms = parseJson<Citation["match_signal_terms"]>(row[`${prefix}match_signal_terms`], undefined);
    const dominantMatchSignal = row[`${prefix}dominant_match_signal`];

    if (!fileId && !fileName && !quote && !page && !section && !score && !scoreReason && !matchSignals) {
      continue;
    }

    citations.push({
      index: Number(row[`${prefix}index`] ?? index + 1),
      file_id: fileId ? String(fileId) : undefined,
      file_name: fileName ? String(fileName) : undefined,
      chunk_id: row[`${prefix}chunk_id`] ? String(row[`${prefix}chunk_id`]) : undefined,
      chunk_index: row[`${prefix}chunk_index`] === null || row[`${prefix}chunk_index`] === undefined
        ? undefined
        : Number(row[`${prefix}chunk_index`]),
      quote: quote ? String(quote) : undefined,
      page: page === null || page === undefined ? undefined : Number(page),
      section: section ? String(section) : undefined,
      sheet: row[`${prefix}sheet`] ? String(row[`${prefix}sheet`]) : undefined,
      cell_range: row[`${prefix}cell_range`] ? String(row[`${prefix}cell_range`]) : undefined,
      score: score === null || score === undefined ? undefined : Number(score),
      score_reason: scoreReason ? String(scoreReason) : undefined,
      match_signals: matchSignals,
      match_signal_terms: matchSignalTerms,
      dominant_match_signal: dominantMatchSignal
        ? String(dominantMatchSignal) as Citation["dominant_match_signal"]
        : undefined
    });
  }

  return {
    id: row.id,
    question: row.question,
    expected_answer: row.expected_answer,
    knowledge_base_ids: parseJson<string[]>(row.knowledge_base_ids, []),
    answer: row.answer,
    citations,
    citation_count: citationCount,
    model: row.model,
    status: row.status,
    reviewer_note: row.reviewer_note,
    latency_ms: row.latency_ms === null || row.latency_ms === undefined ? null : Number(row.latency_ms),
    created_by: row.created_by,
    created_at: toIsoString(row.created_at),
    updated_at: toIsoString(row.updated_at)
  };
}

export async function listOperationsDashboardData() {
  const results = await mysqlBatchQuery([
    { sql: "select * from users order by created_at desc" },
    { sql: "select * from conversations order by updated_at desc" },
    { sql: `select id, conversation_id, role, model, created_at,
        coalesce(json_length(citations), 0) as citation_count
        from messages order by created_at asc` },
    { sql: "select * from feedback order by created_at desc" },
    { sql: "select * from knowledge_tasks order by updated_at desc" },
    { sql: "select id, status, created_by, created_at, updated_at from qa_test_cases order by updated_at desc" },
    { sql: "select * from document_approval_requests order by updated_at desc" },
    { sql: "select * from documents order by created_at desc" },
    { sql: "select * from training_jobs order by created_at desc" },
    { sql: "select * from training_progress order by updated_at desc" },
    { sql: "select * from training_quiz_attempts order by created_at desc" },
    { sql: "select * from service_tickets order by updated_at desc" },
    { sql: "select * from service_ticket_comments order by created_at asc limit 1000" }
  ]) as Row[][];
  const [users, conversations, messages, feedback, tasks, qaTests, approvals, documents, trainingJobs, trainingProgress, quizAttempts, tickets, ticketComments] = results;

  return {
    users: users.map(userFromRow),
    conversations: conversations.map(conversationFromRow),
    messages: messages.map(messageSummaryFromRow),
    feedback: feedback.map(feedbackFromRow),
    tasks: tasks.map(taskFromRow),
    qaTests: qaTests.map((row) => ({
      id: String(row.id),
      status: row.status as QaTestCase["status"],
      created_by: row.created_by ? String(row.created_by) : null,
      created_at: toIsoString(row.created_at),
      updated_at: toIsoString(row.updated_at)
    })),
    approvals: approvals.map(documentApprovalRequestFromRow),
    documents: documents.map(documentFromRow),
    trainingJobs: trainingJobs.map(trainingFromRow),
    trainingProgress: trainingProgress.map(trainingProgressFromRow),
    quizAttempts: quizAttempts.map(trainingQuizAttemptFromRow),
    tickets: tickets.map(serviceTicketFromRow),
    ticketComments: ticketComments.map(serviceTicketCommentFromRow)
  };
}

async function currentSessionUserId() {
  const cookieStore = await cookies();
  const session = await verifySessionToken(cookieStore.get(sessionCookieName)?.value);
  return session?.userId ?? null;
}

export async function getCurrentUser(userId?: string): Promise<UserProfile> {
  const resolvedUserId = userId ?? await currentSessionUserId();

  if (!resolvedUserId) {
    throw new Error("请先登录");
  }

  const user = await getUserProfile(resolvedUserId);

  if (!user) {
    throw new Error("请先登录");
  }

  if (user.status === "disabled") {
    throw new Error("账号已被禁用");
  }

  return user;
}

export async function listUsers() {
  const rows = await mysqlQuery<Row[]>("select * from users order by created_at desc");
  return rows.map(userFromRow);
}

export async function getUserProfile(id: string) {
  const rows = await mysqlQuery<Row[]>("select * from users where id = :id limit 1", { id });
  return rows[0] ? userFromRow(rows[0]) : null;
}

export async function getUserAuthByEmail(email: string) {
  const rows = await mysqlQuery<Row[]>("select * from users where lower(email) = lower(:email) limit 1", { email });
  const row = rows[0];
  if (!row) {
    return null;
  }

  return {
    user: userFromRow(row),
    password_hash: row.password_hash as string | null
  };
}

export async function createUser(input: {
  email: string;
  password: string;
  name: string;
  department: string;
  position?: string;
  security_clearance?: DocumentSecurityLevel;
  role: UserProfile["role"];
  status?: UserProfile["status"];
}) {
  const existing = await getUserAuthByEmail(input.email);
  if (existing) {
    throw new Error("该邮箱已存在");
  }

  const record: UserProfile = {
    id: createId("user"),
    email: input.email.toLowerCase(),
    name: input.name,
    role: input.role,
    department: input.department,
    position: input.position ?? "",
    security_clearance: input.security_clearance ?? "internal",
    status: input.status ?? "active",
    created_at: new Date().toISOString()
  };
  const passwordHash = await hashPassword(input.password);

  await mysqlExecute(
    `insert into users
      (id, email, name, role, department, position, security_clearance, password_hash, status, created_at)
      values (:id, :email, :name, :role, :department, :position, :security_clearance, :password_hash, :status, :created_at)`,
    {
      ...record,
      password_hash: passwordHash
    }
  );

  return record;
}

export async function upsertExternalUser(input: {
  email: string;
  name: string;
  department: string;
  position?: string;
  provider: string;
  subject: string;
}) {
  const email = input.email.toLowerCase();
  const bySubject = await mysqlQuery<Row[]>(
    "select * from users where auth_provider = :provider and external_subject = :subject limit 1",
    {
      provider: input.provider,
      subject: input.subject
    }
  );
  const existingBySubject = bySubject[0] ? userFromRow(bySubject[0]) : null;

  if (existingBySubject) {
    await mysqlExecute(
      `update users set
        email = :email,
        name = coalesce(nullif(:name, ''), name),
        department = coalesce(nullif(:department, ''), department),
        position = coalesce(nullif(:position, ''), position)
        where id = :id`,
      {
        id: existingBySubject.id,
        email,
        name: input.name,
        department: input.department,
        position: input.position ?? ""
      }
    );
    const updated = await getUserProfile(existingBySubject.id);
    if (!updated) {
      throw new Error("用户不存在");
    }
    return updated;
  }

  const existingByEmail = await getUserAuthByEmail(email);
  if (existingByEmail) {
    await mysqlExecute(
      `update users set
        name = coalesce(nullif(:name, ''), name),
        department = coalesce(nullif(:department, ''), department),
        position = coalesce(nullif(:position, ''), position),
        auth_provider = :provider,
        external_subject = :subject
        where id = :id`,
      {
        id: existingByEmail.user.id,
        name: input.name,
        department: input.department,
        position: input.position ?? "",
        provider: input.provider,
        subject: input.subject
      }
    );
    const updated = await getUserProfile(existingByEmail.user.id);
    if (!updated) {
      throw new Error("用户不存在");
    }
    return updated;
  }

  const record: UserProfile = {
    id: createId("user"),
    email,
    name: input.name || email.split("@")[0],
    role: "employee",
    department: input.department,
    position: input.position ?? "",
    security_clearance: "internal",
    status: "active",
    auth_provider: input.provider,
    external_subject: input.subject,
    created_at: new Date().toISOString()
  };

  await mysqlExecute(
    `insert into users
      (id, email, name, role, department, position, security_clearance, password_hash, status, auth_provider, external_subject, created_at)
      values (:id, :email, :name, :role, :department, :position, :security_clearance, null, :status, :auth_provider, :external_subject, :created_at)`,
    record
  );

  return record;
}

export async function updateUserPassword(id: string, password: string) {
  const passwordHash = await hashPassword(password);
  await mysqlExecute("update users set password_hash = :passwordHash where id = :id", { id, passwordHash });
}

export async function markUserLoggedIn(id: string) {
  await mysqlExecute("update users set last_login_at = :lastLoginAt where id = :id", {
    id,
    lastLoginAt: new Date().toISOString()
  });
}

export async function updateUserProfile(
  id: string,
  input: Partial<Pick<UserProfile, "name" | "role" | "department" | "position" | "security_clearance" | "status">>
) {
  await mysqlExecute(
    "update users set name = coalesce(:name, name), role = coalesce(:role, role), department = coalesce(:department, department), position = coalesce(:position, position), security_clearance = coalesce(:security_clearance, security_clearance), status = coalesce(:status, status) where id = :id",
    {
      id,
      name: input.name ?? null,
      role: input.role ?? null,
      department: input.department ?? null,
      position: input.position ?? null,
      security_clearance: input.security_clearance ?? null,
      status: input.status ?? null
    }
  );
  const user = await getUserProfile(id);
  if (!user) {
    throw new Error("用户不存在");
  }
  return user;
}

export async function listKnowledgeBases() {
  const rows = await mysqlQuery<Row[]>("select * from knowledge_bases order by created_at desc");
  return rows.map(knowledgeBaseFromRow);
}

export async function getKnowledgeBase(id: string) {
  const rows = await mysqlQuery<Row[]>("select * from knowledge_bases where id = :id limit 1", { id });
  return rows[0] ? knowledgeBaseFromRow(rows[0]) : null;
}

export async function createKnowledgeBase(
  input: Pick<KnowledgeBase, "name" | "description" | "openai_vector_store_id" | "visibility" | "departments" | "positions">
) {
  const user = await getCurrentUser();
  const record: KnowledgeBase = {
    id: createId("kb"),
    created_by: user.id,
    created_at: new Date().toISOString(),
    ...input
  };
  await mysqlExecute(
    `insert into knowledge_bases
      (id, name, description, openai_vector_store_id, visibility, departments, positions, created_by, created_at)
      values (:id, :name, :description, :openai_vector_store_id, :visibility, :departments, :positions, :created_by, :created_at)`,
    {
      ...record,
      departments: JSON.stringify(record.departments),
      positions: JSON.stringify(record.positions)
    }
  );
  return record;
}

export async function updateKnowledgeBase(
  id: string,
  input: Partial<Pick<KnowledgeBase, "name" | "description" | "openai_vector_store_id" | "visibility" | "departments" | "positions">>
) {
  const existing = await getKnowledgeBase(id);
  if (!existing) {
    throw new Error("知识库不存在");
  }
  const next = { ...existing, ...input };
  await mysqlExecute(
    `update knowledge_bases set
      name = :name,
      description = :description,
      openai_vector_store_id = :openai_vector_store_id,
      visibility = :visibility,
      departments = :departments,
      positions = :positions
      where id = :id`,
    {
      id,
      name: next.name,
      description: next.description,
      openai_vector_store_id: next.openai_vector_store_id,
      visibility: next.visibility,
      departments: JSON.stringify(next.departments),
      positions: JSON.stringify(next.positions)
    }
  );
  return next;
}

export async function deleteKnowledgeBase(id: string) {
  await mysqlExecute(
    "delete from document_approval_events where document_id in (select id from documents where knowledge_base_id = :id)",
    { id }
  );
  await mysqlExecute(
    "delete from document_approval_requests where document_id in (select id from documents where knowledge_base_id = :id)",
    { id }
  );
  await Promise.all([
    mysqlExecute("delete from document_chunks where knowledge_base_id = :id", { id }),
    mysqlExecute("delete from document_version_chunks where knowledge_base_id = :id", { id })
  ]);
  await Promise.all([
    mysqlExecute("delete from document_versions where knowledge_base_id = :id", { id }),
    mysqlExecute("delete from documents where knowledge_base_id = :id", { id })
  ]);
  await mysqlExecute("delete from knowledge_bases where id = :id", { id });
}

export async function listDocuments() {
  const rows = await mysqlQuery<Row[]>("select * from documents order by created_at desc");
  return rows.map(documentFromRow);
}

export async function getWorkflowReadinessStats(): Promise<WorkflowReadinessStats> {
  const rows = await mysqlQuery<Row[]>(
    `select
        (select count(*) from knowledge_bases) as knowledge_base_count,
        (select count(*) from knowledge_bases where openai_vector_store_id is not null and openai_vector_store_id <> '') as vector_store_count,
        (select count(*) from documents where status = 'ready') as ready_document_count,
        (select count(*) from documents where status in ('processing', 'uploading')) as processing_document_count,
        (select count(*) from conversations) as conversation_count,
        (select count(*) from training_jobs where status = 'ready') as ready_training_count`
  );
  const row = rows[0] ?? {};

  return {
    knowledge_base_count: Number(row.knowledge_base_count ?? 0),
    vector_store_count: Number(row.vector_store_count ?? 0),
    ready_document_count: Number(row.ready_document_count ?? 0),
    processing_document_count: Number(row.processing_document_count ?? 0),
    conversation_count: Number(row.conversation_count ?? 0),
    ready_training_count: Number(row.ready_training_count ?? 0)
  };
}

export async function listDocumentsByKnowledgeBase(knowledgeBaseId: string) {
  const rows = await mysqlQuery<Row[]>(
    "select * from documents where knowledge_base_id = :knowledgeBaseId order by created_at desc",
    { knowledgeBaseId }
  );
  return rows.map(documentFromRow);
}

export async function getDocument(id: string) {
  const rows = await mysqlQuery<Row[]>("select * from documents where id = :id limit 1", { id });
  return rows[0] ? documentFromRow(rows[0]) : null;
}

export async function deleteDocument(id: string) {
  await mysqlExecute("delete from document_approval_events where document_id = :id", { id });
  await mysqlExecute("delete from document_approval_requests where document_id = :id", { id });
  await Promise.all([
    mysqlExecute("delete from document_chunks where document_id = :id", { id }),
    mysqlExecute("delete from document_version_chunks where document_id = :id", { id }),
    mysqlExecute("delete from document_versions where document_id = :id", { id })
  ]);
  await mysqlExecute("delete from documents where id = :id", { id });
}

export async function createDocument(input: Omit<DocumentRecord, "id" | "created_at" | "updated_at" | "security_level" | "publish_status" | "acl_departments" | "acl_positions" | "acl_roles" | "acl_users" | "approved_by" | "approved_at" | "published_by" | "published_at" | "published_version_id" | "published_version"> & Partial<Pick<DocumentRecord, "security_level" | "publish_status" | "acl_departments" | "acl_positions" | "acl_roles" | "acl_users" | "approved_by" | "approved_at" | "published_by" | "published_at" | "published_version_id" | "published_version">>) {
  const now = new Date().toISOString();
  const record: DocumentRecord = {
    id: createId("doc"),
    security_level: "internal",
    publish_status: "published",
    acl_departments: [],
    acl_positions: [],
    acl_roles: [],
    acl_users: [],
    approved_by: null,
    approved_at: null,
    published_by: null,
    published_at: null,
    published_version_id: null,
    published_version: null,
    ...input,
    created_at: now,
    updated_at: now
  };
  await mysqlExecute(
    `insert into documents
      (id, knowledge_base_id, title, file_name, file_type, storage_path, openai_file_id, status, department, tags, security_level, publish_status, acl_departments, acl_positions, acl_roles, acl_users, approved_by, approved_at, published_by, published_at, published_version_id, published_version, created_by, created_at, updated_at)
      values (:id, :knowledge_base_id, :title, :file_name, :file_type, :storage_path, :openai_file_id, :status, :department, :tags, :security_level, :publish_status, :acl_departments, :acl_positions, :acl_roles, :acl_users, :approved_by, :approved_at, :published_by, :published_at, :published_version_id, :published_version, :created_by, :created_at, :updated_at)`,
    {
      ...record,
      tags: JSON.stringify(record.tags),
      acl_departments: JSON.stringify(record.acl_departments),
      acl_positions: JSON.stringify(record.acl_positions),
      acl_roles: JSON.stringify(record.acl_roles),
      acl_users: JSON.stringify(record.acl_users)
    }
  );
  return record;
}

export async function listDocumentVersions() {
  const rows = await mysqlQuery<Row[]>("select * from document_versions order by created_at desc");
  return rows.map(documentVersionFromRow);
}

export async function listDocumentVersionChunks(versionId?: string) {
  const rows = versionId
    ? await mysqlQuery<Row[]>(
        "select * from document_version_chunks where document_version_id = :versionId order by chunk_index asc",
        { versionId }
      )
    : await mysqlQuery<Row[]>("select * from document_version_chunks order by chunk_index asc");

  return rows.map(documentVersionChunkFromRow);
}

export async function createDocumentVersion(
  input: Omit<DocumentVersion, "id" | "version" | "created_at"> & {
    version?: number;
    snapshot_chunks?: Array<Pick<DocumentChunk, "chunk_index" | "content" | "token_estimate" | "metadata">>;
  }
) {
  const { snapshot_chunks: snapshotChunks, version: inputVersion, ...versionInput } = input;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const version = inputVersion ?? await nextDocumentVersion(input.document_id, input.knowledge_base_id);
    const record: DocumentVersion = {
      id: createId("docver"),
      version,
      created_at: new Date().toISOString(),
      ...versionInput
    };

    try {
      await mysqlExecute(
        `insert into document_versions
          (id, document_id, knowledge_base_id, version, title, file_name, file_type, status, change_note, created_by, created_at)
          values (:id, :document_id, :knowledge_base_id, :version, :title, :file_name, :file_type, :status, :change_note, :created_by, :created_at)`,
        record
      );

      if (snapshotChunks?.length) {
        await createDocumentVersionChunkSnapshots(record, snapshotChunks);
      }
      return record;
    } catch (error) {
      if (!isDuplicateEntryError(error)) throw error;
      const existing = await findDocumentVersion(input.document_id, input.knowledge_base_id, version);
      if (inputVersion !== undefined && existing) return existing;
      if (attempt === 3) {
        if (existing) return existing;
        throw error;
      }
    }
  }

  throw new Error("创建资料版本失败");
}

async function findDocumentVersion(documentId: string | null, knowledgeBaseId: string, version: number) {
  const rows = documentId
    ? await mysqlQuery<Row[]>(
        "select * from document_versions where document_id = :documentId and version = :version limit 1",
        { documentId, version }
      )
    : await mysqlQuery<Row[]>(
        "select * from document_versions where document_id is null and knowledge_base_id = :knowledgeBaseId and version = :version limit 1",
        { knowledgeBaseId, version }
      );
  return rows[0] ? documentVersionFromRow(rows[0]) : null;
}

function isDuplicateEntryError(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error && String(error.code) === "ER_DUP_ENTRY");
}

async function createDocumentVersionChunkSnapshots(
  version: DocumentVersion,
  chunks: Array<Pick<DocumentChunk, "chunk_index" | "content" | "token_estimate" | "metadata">>
) {
  for (const chunk of chunks) {
    const record: DocumentVersionChunk = {
      id: createId("docverchunk"),
      document_version_id: version.id,
      document_id: version.document_id,
      knowledge_base_id: version.knowledge_base_id,
      chunk_index: chunk.chunk_index,
      content: chunk.content,
      token_estimate: chunk.token_estimate,
      metadata: chunk.metadata,
      created_at: new Date().toISOString()
    };
    await mysqlExecute(
      `insert into document_version_chunks
        (id, document_version_id, document_id, knowledge_base_id, chunk_index, content, token_estimate, metadata, created_at)
        values (:id, :document_version_id, :document_id, :knowledge_base_id, :chunk_index, :content, :token_estimate, :metadata, :created_at)`,
      {
        ...record,
        metadata: JSON.stringify(record.metadata)
      }
    );
  }
}

export async function restoreDocumentVersionChunks(versionId: string, documentId: string, knowledgeBaseId: string) {
  const rows = await mysqlQuery<Row[]>(
    "select * from document_version_chunks where document_version_id = :versionId order by chunk_index asc",
    { versionId }
  );
  const snapshots = rows.map(documentVersionChunkFromRow);

  if (snapshots.length === 0) {
    return 0;
  }

  await mysqlExecute("delete from document_chunks where document_id = :documentId", { documentId });

  for (const snapshot of snapshots) {
    const record: DocumentChunk = {
      id: createId("chunk"),
      document_id: documentId,
      knowledge_base_id: knowledgeBaseId,
      chunk_index: snapshot.chunk_index,
      content: snapshot.content,
      token_estimate: snapshot.token_estimate,
      metadata: snapshot.metadata,
      created_at: new Date().toISOString()
    };
    await mysqlExecute(
      `insert into document_chunks
        (id, document_id, knowledge_base_id, chunk_index, content, token_estimate, metadata, created_at)
        values (:id, :document_id, :knowledge_base_id, :chunk_index, :content, :token_estimate, :metadata, :created_at)`,
      {
        ...record,
        metadata: JSON.stringify(record.metadata)
      }
    );
  }

  return snapshots.length;
}

async function nextDocumentVersion(documentId: string | null, knowledgeBaseId: string) {
  if (documentId) {
    const rows = await mysqlQuery<Row[]>(
      "select coalesce(max(version), 0) as max_version from document_versions where document_id = :documentId",
      { documentId }
    );
    return Number(rows[0]?.max_version ?? 0) + 1;
  }

  const rows = await mysqlQuery<Row[]>(
    "select coalesce(max(version), 0) as max_version from document_versions where knowledge_base_id = :knowledgeBaseId",
    { knowledgeBaseId }
  );
  return Number(rows[0]?.max_version ?? 0) + 1;
}

export async function updateDocument(
  id: string,
  input: Partial<Pick<DocumentRecord, "status" | "openai_file_id" | "storage_path" | "title" | "file_name" | "file_type" | "department" | "tags" | "security_level" | "publish_status" | "acl_departments" | "acl_positions" | "acl_roles" | "acl_users" | "approved_by" | "approved_at" | "published_by" | "published_at" | "published_version_id" | "published_version">>
) {
  const existing = await getDocument(id);
  if (!existing) {
    throw new Error("文档不存在");
  }
  const next = { ...existing, ...input };
  await mysqlExecute(
    `update documents set
      title = :title,
      file_name = :file_name,
      file_type = :file_type,
      storage_path = :storage_path,
      openai_file_id = :openai_file_id,
      status = :status,
      department = :department,
      tags = :tags,
      security_level = :security_level,
      publish_status = :publish_status,
      acl_departments = :acl_departments,
      acl_positions = :acl_positions,
      acl_roles = :acl_roles,
      acl_users = :acl_users,
      approved_by = :approved_by,
      approved_at = :approved_at,
      published_by = :published_by,
      published_at = :published_at,
      published_version_id = :published_version_id,
      published_version = :published_version,
      updated_at = :updated_at
      where id = :id`,
    {
      id,
      title: next.title,
      file_name: next.file_name,
      file_type: next.file_type,
      storage_path: next.storage_path,
      openai_file_id: next.openai_file_id,
      status: next.status,
      department: next.department,
      tags: JSON.stringify(next.tags),
      security_level: next.security_level,
      publish_status: next.publish_status,
      acl_departments: JSON.stringify(next.acl_departments),
      acl_positions: JSON.stringify(next.acl_positions),
      acl_roles: JSON.stringify(next.acl_roles),
      acl_users: JSON.stringify(next.acl_users),
      approved_by: next.approved_by,
      approved_at: next.approved_at,
      published_by: next.published_by,
      published_at: next.published_at,
      published_version_id: next.published_version_id,
      published_version: next.published_version,
      updated_at: new Date().toISOString()
    }
  );
  const updatedAt = new Date().toISOString();
  return {
    ...next,
    updated_at: updatedAt
  };
}

export async function listDocumentReviewerAssignments(userId?: string) {
  const rows = userId
    ? await mysqlQuery<Row[]>(
        "select * from document_reviewer_assignments where user_id = :userId order by created_at desc",
        { userId }
      )
    : await mysqlQuery<Row[]>("select * from document_reviewer_assignments order by created_at desc");
  return rows.map(documentReviewerAssignmentFromRow);
}

export async function createDocumentReviewerAssignment(
  input: Omit<DocumentReviewerAssignment, "id" | "created_at" | "updated_at">
) {
  const now = new Date().toISOString();
  const record: DocumentReviewerAssignment = {
    id: createId("reviewer"),
    created_at: now,
    updated_at: now,
    ...input
  };
  await mysqlExecute(
    `insert into document_reviewer_assignments
      (id, user_id, reviewer_type, knowledge_base_ids, departments, security_levels, can_review, can_publish, active, created_by, created_at, updated_at)
      values (:id, :user_id, :reviewer_type, :knowledge_base_ids, :departments, :security_levels, :can_review, :can_publish, :active, :created_by, :created_at, :updated_at)`,
    {
      ...record,
      knowledge_base_ids: JSON.stringify(record.knowledge_base_ids),
      departments: JSON.stringify(record.departments),
      security_levels: JSON.stringify(record.security_levels)
    }
  );
  return record;
}

export async function updateDocumentReviewerAssignment(
  id: string,
  input: Partial<Pick<DocumentReviewerAssignment, "reviewer_type" | "knowledge_base_ids" | "departments" | "security_levels" | "can_review" | "can_publish" | "active">>
) {
  const existing = (await listDocumentReviewerAssignments()).find((item) => item.id === id);
  if (!existing) {
    throw new Error("审批授权不存在");
  }
  const next = { ...existing, ...input, updated_at: new Date().toISOString() };
  await mysqlExecute(
    `update document_reviewer_assignments set
      reviewer_type = :reviewer_type,
      knowledge_base_ids = :knowledge_base_ids,
      departments = :departments,
      security_levels = :security_levels,
      can_review = :can_review,
      can_publish = :can_publish,
      active = :active,
      updated_at = :updated_at
      where id = :id`,
    {
      ...next,
      knowledge_base_ids: JSON.stringify(next.knowledge_base_ids),
      departments: JSON.stringify(next.departments),
      security_levels: JSON.stringify(next.security_levels)
    }
  );
  return next;
}

export async function deleteDocumentReviewerAssignment(id: string) {
  await mysqlExecute("delete from document_reviewer_assignments where id = :id", { id });
}

export async function listDocumentApprovalRequests() {
  const rows = await mysqlQuery<Row[]>("select * from document_approval_requests order by updated_at desc");
  return rows.map(documentApprovalRequestFromRow);
}

export async function getDocumentApprovalRequest(id: string) {
  const rows = await mysqlQuery<Row[]>("select * from document_approval_requests where id = :id limit 1", { id });
  return rows[0] ? documentApprovalRequestFromRow(rows[0]) : null;
}

export async function getActiveDocumentApprovalRequest(documentId: string) {
  const rows = await mysqlQuery<Row[]>(
    `select * from document_approval_requests
      where document_id = :documentId and status in ('pending', 'approved', 'published')
      order by created_at desc limit 1`,
    { documentId }
  );
  return rows[0] ? documentApprovalRequestFromRow(rows[0]) : null;
}

export async function createDocumentApprovalRequest(
  input: Omit<DocumentApprovalRequest, "id" | "created_at" | "updated_at">
) {
  const now = new Date().toISOString();
  const record: DocumentApprovalRequest = {
    id: createId("approval"),
    created_at: now,
    updated_at: now,
    ...input
  };
  await mysqlExecute(
    `insert into document_approval_requests
      (id, document_id, document_version_id, status, active_key, submitted_by, submitted_at, reviewed_by, reviewed_at, review_comment, published_by, published_at, withdrawn_by, withdrawn_at, created_at, updated_at)
      values (:id, :document_id, :document_version_id, :status, :active_key, :submitted_by, :submitted_at, :reviewed_by, :reviewed_at, :review_comment, :published_by, :published_at, :withdrawn_by, :withdrawn_at, :created_at, :updated_at)`,
    { ...record, active_key: record.status === "pending" || record.status === "approved" ? "active" : null }
  );
  return record;
}

export async function updateDocumentApprovalRequest(
  id: string,
  input: Partial<Pick<DocumentApprovalRequest, "status" | "reviewed_by" | "reviewed_at" | "review_comment" | "published_by" | "published_at" | "withdrawn_by" | "withdrawn_at">>
) {
  const existing = await getDocumentApprovalRequest(id);
  if (!existing) {
    throw new Error("审批申请不存在");
  }
  const next = { ...existing, ...input, updated_at: new Date().toISOString() };
  await mysqlExecute(
    `update document_approval_requests set
      status = :status,
      active_key = :active_key,
      reviewed_by = :reviewed_by,
      reviewed_at = :reviewed_at,
      review_comment = :review_comment,
      published_by = :published_by,
      published_at = :published_at,
      withdrawn_by = :withdrawn_by,
      withdrawn_at = :withdrawn_at,
      updated_at = :updated_at
      where id = :id`,
    { ...next, active_key: next.status === "pending" || next.status === "approved" ? "active" : null }
  );
  return next;
}

export async function listDocumentApprovalEvents(documentId?: string) {
  const rows = documentId
    ? await mysqlQuery<Row[]>(
        "select * from document_approval_events where document_id = :documentId order by created_at desc",
        { documentId }
      )
    : await mysqlQuery<Row[]>("select * from document_approval_events order by created_at desc");
  return rows.map(documentApprovalEventFromRow);
}

export async function createDocumentApprovalEvent(input: Omit<DocumentApprovalEvent, "id" | "created_at">) {
  const record: DocumentApprovalEvent = {
    id: createId("approvalevent"),
    created_at: new Date().toISOString(),
    ...input
  };
  await mysqlExecute(
    `insert into document_approval_events
      (id, request_id, document_id, action, actor_id, actor_name, actor_role, comment, from_status, to_status, metadata, created_at)
      values (:id, :request_id, :document_id, :action, :actor_id, :actor_name, :actor_role, :comment, :from_status, :to_status, :metadata, :created_at)`,
    { ...record, metadata: JSON.stringify(record.metadata) }
  );
  return record;
}

export async function listDocumentPermissionTemplates() {
  const rows = await mysqlQuery<Row[]>("select * from document_permission_templates order by created_at desc");
  return rows.map(documentPermissionTemplateFromRow);
}

export async function createDocumentPermissionTemplate(
  input: Omit<DocumentPermissionTemplate, "id" | "created_at" | "updated_at">
) {
  const now = new Date().toISOString();
  const record: DocumentPermissionTemplate = {
    id: createId("acltemplate"),
    created_at: now,
    updated_at: now,
    ...input
  };
  await mysqlExecute(
    `insert into document_permission_templates
      (id, name, description, security_level, acl_departments, acl_positions, acl_roles, acl_users, created_by, created_at, updated_at)
      values (:id, :name, :description, :security_level, :acl_departments, :acl_positions, :acl_roles, :acl_users, :created_by, :created_at, :updated_at)`,
    {
      ...record,
      acl_departments: JSON.stringify(record.acl_departments),
      acl_positions: JSON.stringify(record.acl_positions),
      acl_roles: JSON.stringify(record.acl_roles),
      acl_users: JSON.stringify(record.acl_users)
    }
  );
  return record;
}

export async function updateDocumentPermissionTemplate(
  id: string,
  input: Partial<Pick<DocumentPermissionTemplate, "name" | "description" | "security_level" | "acl_departments" | "acl_positions" | "acl_roles" | "acl_users">>
) {
  const existing = (await listDocumentPermissionTemplates()).find((item) => item.id === id);
  if (!existing) {
    throw new Error("权限模板不存在");
  }
  const next = { ...existing, ...input, updated_at: new Date().toISOString() };
  await mysqlExecute(
    `update document_permission_templates set
      name = :name,
      description = :description,
      security_level = :security_level,
      acl_departments = :acl_departments,
      acl_positions = :acl_positions,
      acl_roles = :acl_roles,
      acl_users = :acl_users,
      updated_at = :updated_at
      where id = :id`,
    {
      ...next,
      acl_departments: JSON.stringify(next.acl_departments),
      acl_positions: JSON.stringify(next.acl_positions),
      acl_roles: JSON.stringify(next.acl_roles),
      acl_users: JSON.stringify(next.acl_users)
    }
  );
  return next;
}

export async function deleteDocumentPermissionTemplate(id: string) {
  await mysqlExecute("delete from document_permission_templates where id = :id", { id });
}

export async function listDocumentChunks(documentId?: string) {
  const rows = documentId
    ? await mysqlQuery<Row[]>(
        "select * from document_chunks where document_id = :documentId order by chunk_index asc, created_at desc",
        { documentId }
      )
    : await mysqlQuery<Row[]>("select * from document_chunks order by created_at desc");
  return rows.map(chunkFromRow);
}

export async function getDocumentChunk(id: string) {
  const rows = await mysqlQuery<Row[]>("select * from document_chunks where id = :id limit 1", { id });
  return rows[0] ? chunkFromRow(rows[0]) : null;
}

export async function updateDocumentChunk(
  id: string,
  input: Partial<Pick<DocumentChunk, "content" | "token_estimate" | "metadata">>
) {
  const existing = await getDocumentChunk(id);
  if (!existing) {
    throw new Error("分片不存在");
  }

  const next: DocumentChunk = {
    ...existing,
    ...input
  };

  await mysqlExecute(
    `update document_chunks set
      content = :content,
      token_estimate = :token_estimate,
      metadata = :metadata
      where id = :id`,
    {
      id,
      content: next.content,
      token_estimate: next.token_estimate,
      metadata: JSON.stringify(next.metadata)
    }
  );

  return next;
}

export async function listDocumentChunksByScope(input: {
  knowledgeBaseIds: string[];
  documentIds?: string[];
}) {
  const knowledgeBaseIds = [...new Set(input.knowledgeBaseIds.filter(Boolean))];
  const documentIds = input.documentIds ? [...new Set(input.documentIds.filter(Boolean))] : null;

  if (knowledgeBaseIds.length === 0 || (documentIds && documentIds.length === 0)) {
    return [];
  }

  const knowledgeBaseClause = buildInClause("knowledge_base_id", knowledgeBaseIds, "kb");
  const whereClauses = [knowledgeBaseClause.clause];
  const params = { ...knowledgeBaseClause.params };

  if (documentIds) {
    const documentClause = buildInClause("document_id", documentIds, "doc");
    whereClauses.push(documentClause.clause);
    Object.assign(params, documentClause.params);
  }

  const rows = await mysqlQuery<Row[]>(
    `select *
      from document_chunks
      where ${whereClauses.join(" and ")}
      order by document_id asc, chunk_index asc, created_at desc`,
    params
  );
  return rows.map(chunkFromRow);
}

export async function listDocumentChunkMetadata() {
  const rows = await mysqlQuery<Row[]>(
    "select document_id, knowledge_base_id, metadata from document_chunks order by created_at desc"
  );
  return rows.map(chunkMetadataFromRow);
}

export async function listDocumentChunkGovernanceAuditSources(input: {
  knowledgeBaseId?: string;
  limit?: number;
} = {}) {
  const limit = Math.min(Math.max(Math.round(input.limit ?? 300), 1), 1000);
  const whereClauses = [
    "json_extract(dc.metadata, '$.governance_audit') is not null",
    "json_length(json_extract(dc.metadata, '$.governance_audit')) > 0"
  ];
  const params: Record<string, unknown> = {};

  if (input.knowledgeBaseId) {
    whereClauses.push("dc.knowledge_base_id = :knowledgeBaseId");
    params.knowledgeBaseId = input.knowledgeBaseId;
  }

  const rows = await mysqlQuery<Row[]>(
    `select
        dc.id,
        dc.document_id,
        dc.knowledge_base_id,
        dc.chunk_index,
        dc.token_estimate,
        left(replace(replace(replace(dc.content, '\n', ' '), '\r', ' '), '\t', ' '), 120) as content_preview,
        dc.metadata,
        coalesce(d.title, '未知资料') as document_title,
        coalesce(d.file_name, '') as file_name,
        coalesce(kb.name, '未知知识库') as knowledge_base_name
      from document_chunks dc
      left join documents d on d.id = dc.document_id
      left join knowledge_bases kb on kb.id = dc.knowledge_base_id
      where ${whereClauses.join(" and ")}
      order by dc.created_at desc
      limit ${limit}`,
    params
  );
  return rows.map(chunkGovernanceAuditSourceFromRow);
}

export async function listDocumentChunkPendingSuggestionSources(input: {
  knowledgeBaseId?: string;
  limit?: number;
} = {}): Promise<DocumentChunkPendingSuggestionSource[]> {
  const limit = Math.min(Math.max(Math.round(input.limit ?? 300), 1), 1000);
  const whereClauses = ["json_extract(dc.metadata, '$.pending_suggestion') is not null"];
  const params: Record<string, unknown> = {};

  if (input.knowledgeBaseId) {
    whereClauses.push("dc.knowledge_base_id = :knowledgeBaseId");
    params.knowledgeBaseId = input.knowledgeBaseId;
  }

  const rows = await mysqlQuery<Row[]>(
    `select
        dc.id,
        dc.document_id,
        dc.knowledge_base_id,
        dc.chunk_index,
        dc.token_estimate,
        left(replace(replace(replace(dc.content, '\n', ' '), '\r', ' '), '\t', ' '), 180) as content_preview,
        dc.metadata,
        coalesce(d.title, '未知资料') as document_title,
        coalesce(d.file_name, '') as file_name,
        coalesce(kb.name, '未知知识库') as knowledge_base_name
      from document_chunks dc
      left join documents d on d.id = dc.document_id
      left join knowledge_bases kb on kb.id = dc.knowledge_base_id
      where ${whereClauses.join(" and ")}
      order by dc.created_at desc
      limit ${limit}`,
    params
  );
  return rows.map(chunkGovernanceAuditSourceFromRow);
}

export async function listDocumentChunkDiagnosticStats() {
  const rows = await mysqlQuery<Row[]>(
    `select
        document_id,
        min(knowledge_base_id) as knowledge_base_id,
        count(*) as chunk_count,
        coalesce(sum(token_estimate), 0) as total_tokens,
        coalesce(round(avg(token_estimate)), 0) as average_tokens,
        coalesce(min(token_estimate), 0) as min_tokens,
        coalesce(max(token_estimate), 0) as max_tokens,
        sum(case when char_length(trim(content)) = 0 then 1 else 0 end) as empty_chunks,
        sum(case
          when char_length(trim(content)) > 0 and (char_length(trim(content)) < 80 or token_estimate < 30)
          then 1 else 0
        end) as short_chunks,
        sum(case when token_estimate > 1200 or char_length(content) > 6000 then 1 else 0 end) as long_chunks,
        sum(case
          when instr(content, '�') > 0
            or instr(content, '□') > 0
            or (
              json_valid(metadata)
              and lower(coalesce(json_unquote(json_extract(metadata, '$.parser')), '')) like '%ocr%'
              and (token_estimate < 25 or char_length(trim(content)) < 80)
            )
          then 1 else 0
        end) as noisy_chunks,
        count(distinct case
          when json_valid(metadata)
            and cast(json_unquote(json_extract(metadata, '$.page')) as unsigned) > 0
          then cast(json_unquote(json_extract(metadata, '$.page')) as unsigned)
          else null
        end) as page_count,
        group_concat(distinct case
          when json_valid(metadata)
          then nullif(json_unquote(json_extract(metadata, '$.parser')), '')
          else null
        end separator ',') as parsers
      from document_chunks
      group by document_id`
  );
  return rows.map(chunkDiagnosticStatsFromRow);
}

export async function createDocumentChunks(chunks: Array<Omit<DocumentChunk, "id" | "created_at">>) {
  const records: DocumentChunk[] = chunks.map((chunk) => ({
    id: createId("chunk"),
    created_at: new Date().toISOString(),
    ...chunk
  }));

  for (const record of records) {
    await mysqlExecute(
      `insert into document_chunks
        (id, document_id, knowledge_base_id, chunk_index, content, token_estimate, metadata, created_at)
        values (:id, :document_id, :knowledge_base_id, :chunk_index, :content, :token_estimate, :metadata, :created_at)`,
      {
        ...record,
        metadata: JSON.stringify(record.metadata)
      }
    );
  }

  return records;
}

export async function replaceDocumentChunks(documentId: string, chunks: Array<Omit<DocumentChunk, "id" | "created_at">>) {
  await mysqlExecute("delete from document_chunks where document_id = :documentId", { documentId });
  return createDocumentChunks(chunks);
}

function conversationArchiveClause(filter: ConversationArchiveFilter) {
  if (filter === "archived") {
    return "and archived_at is not null";
  }

  if (filter === "all") {
    return "";
  }

  return "and archived_at is null";
}

export async function listConversations(
  userId: string,
  filter: ConversationArchiveFilter = "active",
  searchQuery = ""
) {
  const archiveClause = conversationArchiveClause(filter);
  const orderClause =
    filter === "active"
      ? "order by pinned_at is null asc, pinned_at desc, updated_at desc"
      : "order by updated_at desc";
  const trimmedQuery = searchQuery.trim();
  const searchClause = trimmedQuery
    ? `and (
        conversations.title like :search
        or exists (
          select 1 from messages
          where messages.conversation_id = conversations.id
            and messages.content like :search
        )
      )`
    : "";
  const rows = await mysqlQuery<Row[]>(
    `select * from conversations where user_id = :userId and deleted_at is null ${archiveClause} ${searchClause} ${orderClause}`,
    { userId, search: `%${trimmedQuery}%` }
  );
  return rows.map(conversationFromRow);
}

export async function listAllConversations() {
  const rows = await mysqlQuery<Row[]>("select * from conversations order by updated_at desc");
  return rows.map(conversationFromRow);
}

export async function upsertConversation(title: string, conversationId?: string) {
  const user = await getCurrentUser();
  const now = new Date().toISOString().slice(0, 19).replace("T", " ");
  const normalizedTitle = createConversationTitleFromMessage(title);

  if (conversationId) {
    const rows = await mysqlQuery<Row[]>(
      "select * from conversations where id = :conversationId and user_id = :userId and deleted_at is null limit 1",
      { conversationId, userId: user.id }
    );

    if (rows[0]) {
      const shouldUpdateTitle =
        isDefaultConversationTitle(rows[0].title) && !isDefaultConversationTitle(normalizedTitle);
      await mysqlExecute(
        `update conversations
          set title = :title,
            archived_at = null,
            pinned_at = null,
            deleted_at = null,
            updated_at = :now
          where id = :conversationId`,
        { title: shouldUpdateTitle ? normalizedTitle : rows[0].title, now, conversationId }
      );
      return {
        ...conversationFromRow(rows[0]),
        title: shouldUpdateTitle ? normalizedTitle : rows[0].title,
        archived_at: null,
        pinned_at: null,
        updated_at: new Date(now).toISOString()
      };
    }
  }

  const record: Conversation = {
    id: createId("conv"),
    user_id: user.id,
    title: normalizedTitle,
    archived_at: null,
    pinned_at: null,
    deleted_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
  await mysqlExecute(
    "insert into conversations (id, user_id, title, archived_at, pinned_at, deleted_at, created_at, updated_at) values (:id, :user_id, :title, :archived_at, :pinned_at, :deleted_at, :created_at, :updated_at)",
    {
      id: record.id,
      user_id: record.user_id,
      title: record.title,
      archived_at: record.archived_at,
      pinned_at: record.pinned_at,
      deleted_at: record.deleted_at,
      created_at: now,
      updated_at: now
    }
  );
  return record;
}

export async function archiveConversation(conversationId: string, archived: boolean) {
  const user = await getCurrentUser();
  const now = new Date().toISOString().slice(0, 19).replace("T", " ");
  const archivedAt = archived ? now : null;

  if (archived) {
    await mysqlExecute(
      "update conversations set archived_at = :archivedAt, pinned_at = null, updated_at = :now where id = :conversationId and user_id = :userId and deleted_at is null",
      { archivedAt, now, conversationId, userId: user.id }
    );
  } else {
    await mysqlExecute(
      "update conversations set archived_at = :archivedAt, updated_at = :now where id = :conversationId and user_id = :userId and deleted_at is null",
      { archivedAt, now, conversationId, userId: user.id }
    );
  }

  const rows = await mysqlQuery<Row[]>(
    "select * from conversations where id = :conversationId and user_id = :userId limit 1",
    { conversationId, userId: user.id }
  );

  return rows[0] ? conversationFromRow(rows[0]) : null;
}

export async function pinConversation(conversationId: string, pinned: boolean) {
  const user = await getCurrentUser();
  const pinnedAt = pinned ? new Date().toISOString().slice(0, 19).replace("T", " ") : null;

  await mysqlExecute(
    "update conversations set pinned_at = :pinnedAt where id = :conversationId and user_id = :userId and archived_at is null and deleted_at is null",
    { pinnedAt, conversationId, userId: user.id }
  );

  const rows = await mysqlQuery<Row[]>(
    "select * from conversations where id = :conversationId and user_id = :userId and archived_at is null and deleted_at is null limit 1",
    { conversationId, userId: user.id }
  );

  return rows[0] ? conversationFromRow(rows[0]) : null;
}

export async function renameConversation(conversationId: string, title: string) {
  const user = await getCurrentUser();
  const now = new Date().toISOString().slice(0, 19).replace("T", " ");

  await mysqlExecute(
    "update conversations set title = :title, updated_at = :now where id = :conversationId and user_id = :userId and deleted_at is null",
    { title, now, conversationId, userId: user.id }
  );

  const rows = await mysqlQuery<Row[]>(
    "select * from conversations where id = :conversationId and user_id = :userId and deleted_at is null limit 1",
    { conversationId, userId: user.id }
  );

  return rows[0] ? conversationFromRow(rows[0]) : null;
}

export async function deleteArchivedConversation(conversationId: string) {
  const user = await getCurrentUser();
  const rows = await mysqlQuery<Row[]>(
    "select * from conversations where id = :conversationId and user_id = :userId and archived_at is not null and deleted_at is null limit 1",
    { conversationId, userId: user.id }
  );

  if (!rows[0]) {
    return false;
  }

  const deletedAt = new Date().toISOString();
  await mysqlExecute(
    "update conversations set deleted_at = :deletedAt, pinned_at = null, updated_at = :deletedAt where id = :conversationId and user_id = :userId and deleted_at is null",
    { deletedAt, conversationId, userId: user.id }
  );

  return true;
}

export async function listMessages(conversationId: string) {
  const rows = await mysqlQuery<Row[]>(
    "select * from messages where conversation_id = :conversationId order by created_at asc",
    { conversationId }
  );
  return rows.map(messageFromRow);
}

export async function getOwnedConversation(conversationId: string, userId: string) {
  const rows = await mysqlQuery<Row[]>(
    "select * from conversations where id = :conversationId and user_id = :userId and deleted_at is null limit 1",
    { conversationId, userId }
  );
  return rows[0] ? conversationFromRow(rows[0]) : null;
}

export async function getOwnedMessage(messageId: string, userId: string, conversationId?: string) {
  const rows = await mysqlQuery<Row[]>(
    `select messages.* from messages
      inner join conversations on conversations.id = messages.conversation_id
      where messages.id = :messageId
        and conversations.user_id = :userId
        and conversations.deleted_at is null
        ${conversationId ? "and conversations.id = :conversationId" : ""}
      limit 1`,
    { messageId, userId, conversationId: conversationId ?? null }
  );
  return rows[0] ? messageFromRow(rows[0]) : null;
}

export async function listAllMessages() {
  const rows = await mysqlQuery<Row[]>("select * from messages order by created_at asc");
  return rows.map(messageFromRow);
}

export async function listMessageMetrics() {
  const rows = await mysqlQuery<Row[]>(
    `select id, conversation_id, role, model, created_at,
      coalesce(json_length(citations), 0) as citation_count
      from messages order by created_at asc`
  );
  return rows.map(messageSummaryFromRow);
}

export async function countAllMessages() {
  const rows = await mysqlQuery<Row[]>("select count(*) as count from messages");
  return Number(rows[0]?.count ?? 0);
}

export async function listRecentMessages(limit = 1200) {
  const safeLimit = Math.min(Math.max(Math.trunc(limit) || 1200, 1), 5000);
  const rows = await mysqlQuery<Row[]>(
    `select
        id,
        conversation_id,
        role,
        case when char_length(content) > 1200 then concat(left(content, 1200), '...') else content end as content,
        model,
        created_at,
        coalesce(json_length(citations), 0) as citation_count
      from messages
      order by created_at desc
      limit ${safeLimit}`
  );

  return rows
    .map(messageSummaryFromRow)
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
}

export async function listConversationMessageStats(): Promise<ConversationMessageStats[]> {
  const rows = await mysqlQuery<Row[]>(
    `select
        conversation_id,
        count(*) as message_count,
        max(created_at) as last_message_at,
        sum(case when role = 'assistant' and json_length(citations) = 0 then 1 else 0 end) as unreferenced_assistant_count
      from messages
      group by conversation_id`
  );

  return rows.map((row) => ({
    conversation_id: row.conversation_id,
    message_count: Number(row.message_count ?? 0),
    last_message_at: row.last_message_at ? toIsoString(row.last_message_at) : null,
    unreferenced_assistant_count: Number(row.unreferenced_assistant_count ?? 0)
  }));
}

export async function createMessage(input: Omit<Message, "id" | "created_at">) {
  const record: Message = {
    id: createId("msg"),
    created_at: new Date().toISOString(),
    ...input
  };
  await mysqlExecute(
    `insert into messages (id, conversation_id, role, content, citations, model, created_at)
      values (:id, :conversation_id, :role, :content, :citations, :model, :created_at)`,
    {
      ...record,
      citations: JSON.stringify(record.citations)
    }
  );
  return record;
}

export async function createModelUsageEvent(input: Omit<ModelUsageEvent, "id" | "created_at">) {
  const record: ModelUsageEvent = {
    id: createId("usage"),
    created_at: new Date().toISOString(),
    ...input
  };

  await mysqlExecute(
    `insert into model_usage_events
      (id, source, source_id, conversation_id, user_id, provider, model, input_tokens, output_tokens, total_tokens, estimated, cost_usd, metadata, created_at)
      values (:id, :source, :source_id, :conversation_id, :user_id, :provider, :model, :input_tokens, :output_tokens, :total_tokens, :estimated, :cost_usd, :metadata, :created_at)`,
    {
      ...record,
      estimated: record.estimated ? 1 : 0,
      metadata: JSON.stringify(record.metadata)
    }
  );

  return record;
}

export async function listModelUsageEvents(
  limit = 500,
  filters: {
    source?: ModelUsageEvent["source"];
    sourceId?: string;
  } = {}
) {
  try {
    const where: string[] = [];
    const params: Record<string, unknown> = {
      limit: Math.min(Math.max(Math.round(limit), 1), 2000)
    };

    if (filters.source) {
      where.push("source = :source");
      params.source = filters.source;
    }

    if (filters.sourceId) {
      where.push("source_id = :sourceId");
      params.sourceId = filters.sourceId;
    }

    const rows = await mysqlQuery<Row[]>(
      `select * from model_usage_events
        ${where.length > 0 ? `where ${where.join(" and ")}` : ""}
        order by created_at desc
        limit :limit`,
      params
    );
    return rows.map(modelUsageEventFromRow);
  } catch (error) {
    if (isMissingTableError(error)) {
      return [];
    }

    throw error;
  }
}

function isMissingTableError(error: unknown) {
  if (!error || typeof error !== "object") {
    return false;
  }

  const code = "code" in error ? String(error.code) : "";
  return code === "ER_NO_SUCH_TABLE";
}

export async function listFeedback() {
  const rows = await mysqlQuery<Row[]>("select * from feedback order by created_at desc");
  return rows.map(feedbackFromRow);
}

export async function createFeedback(
  input: Omit<Feedback, "id" | "created_at" | "status" | "resolution_note" | "needs_knowledge_update"> &
    Partial<Pick<Feedback, "status" | "resolution_note" | "needs_knowledge_update">>
) {
  const existingRows = await mysqlQuery<Row[]>(
    "select * from feedback where message_id = :message_id and user_id = :user_id order by created_at desc limit 1",
    { message_id: input.message_id, user_id: input.user_id }
  );
  if (existingRows[0]) {
    await mysqlExecute(
      `update feedback set rating = :rating, comment = :comment, status = 'pending', resolution_note = null,
        needs_knowledge_update = :needs_knowledge_update where id = :id`,
      {
        id: existingRows[0].id,
        rating: input.rating,
        comment: input.comment,
        needs_knowledge_update: input.rating === "dislike"
      }
    );
    const updatedRows = await mysqlQuery<Row[]>("select * from feedback where id = :id limit 1", { id: existingRows[0].id });
    return feedbackFromRow(updatedRows[0]);
  }

  const record: Feedback = {
    id: createId("feedback"),
    created_at: new Date().toISOString(),
    status: "pending",
    resolution_note: null,
    needs_knowledge_update: input.rating === "dislike",
    ...input
  };
  await mysqlExecute(
    `insert into feedback
      (id, message_id, user_id, rating, comment, status, resolution_note, needs_knowledge_update, created_at)
      values (:id, :message_id, :user_id, :rating, :comment, :status, :resolution_note, :needs_knowledge_update, :created_at)`,
    record
  );
  return record;
}

export async function updateFeedback(
  id: string,
  input: Partial<Pick<Feedback, "status" | "resolution_note" | "needs_knowledge_update">>
) {
  await mysqlExecute(
    `update feedback set
      status = coalesce(:status, status),
      resolution_note = :resolution_note,
      needs_knowledge_update = coalesce(:needs_knowledge_update, needs_knowledge_update)
      where id = :id`,
    {
      id,
      status: input.status ?? null,
      resolution_note: input.resolution_note ?? null,
      needs_knowledge_update: input.needs_knowledge_update ?? null
    }
  );
  const rows = await mysqlQuery<Row[]>("select * from feedback where id = :id limit 1", { id });
  if (!rows[0]) {
    throw new Error("反馈不存在");
  }
  return feedbackFromRow(rows[0]);
}

export async function listKnowledgeTasks() {
  const rows = await mysqlQuery<Row[]>("select * from knowledge_tasks order by updated_at desc");
  return rows.map(taskFromRow);
}

export async function createKnowledgeTask(input: Omit<KnowledgeTask, "id" | "created_at" | "updated_at">) {
  const now = new Date().toISOString();
  const record: KnowledgeTask = {
    id: createId("task"),
    created_at: now,
    updated_at: now,
    ...input
  };
  await mysqlExecute(
    `insert into knowledge_tasks
      (id, source, source_id, conversation_id, question, answer, status, note, created_by, created_at, updated_at)
      values (:id, :source, :source_id, :conversation_id, :question, :answer, :status, :note, :created_by, :created_at, :updated_at)`,
    record
  );
  return record;
}

export async function updateKnowledgeTask(id: string, input: Partial<Pick<KnowledgeTask, "status" | "note">>) {
  const now = new Date().toISOString();
  await mysqlExecute(
    "update knowledge_tasks set status = coalesce(:status, status), note = :note, updated_at = :updated_at where id = :id",
    {
      id,
      status: input.status ?? null,
      note: input.note ?? null,
      updated_at: now
    }
  );
  const rows = await mysqlQuery<Row[]>("select * from knowledge_tasks where id = :id limit 1", { id });
  if (!rows[0]) {
    throw new Error("任务不存在");
  }
  return taskFromRow(rows[0]);
}

export async function listServiceTickets() {
  const rows = await mysqlQuery<Row[]>("select * from service_tickets order by updated_at desc");
  return rows.map(serviceTicketFromRow);
}

export async function getServiceTicket(id: string) {
  const rows = await mysqlQuery<Row[]>("select * from service_tickets where id = :id limit 1", { id });
  return rows[0] ? serviceTicketFromRow(rows[0]) : null;
}

export async function listServiceTicketsByUser(userId: string) {
  const rows = await mysqlQuery<Row[]>(
    "select * from service_tickets where user_id = :userId order by updated_at desc",
    { userId }
  );
  return rows.map(serviceTicketFromRow);
}

export async function createServiceTicket(
  input: Omit<ServiceTicket, "id" | "created_at" | "updated_at" | "status" | "priority" | "assignee_id" | "resolution_note" | "due_at" | "resolved_at"> &
    Partial<Pick<ServiceTicket, "status" | "priority" | "assignee_id" | "resolution_note" | "due_at" | "resolved_at">>
) {
  const now = new Date().toISOString();
  const priority = input.priority ?? "normal";
  const status = input.status ?? "pending";
  const record: ServiceTicket = {
    id: createId("ticket"),
    status,
    priority,
    assignee_id: null,
    resolution_note: null,
    due_at: input.due_at ?? (isTicketClosedStatus(status) ? null : calculateTicketDueAt(priority, now)),
    resolved_at: resolveTicketResolvedAt(status, input.resolved_at ?? null, now),
    created_at: now,
    updated_at: now,
    ...input
  };
  await mysqlExecute(
    `insert into service_tickets
      (id, conversation_id, message_id, user_id, title, description, status, priority, assignee_id, resolution_note, due_at, resolved_at, created_at, updated_at)
      values (:id, :conversation_id, :message_id, :user_id, :title, :description, :status, :priority, :assignee_id, :resolution_note, :due_at, :resolved_at, :created_at, :updated_at)`,
    record
  );
  return record;
}

export async function updateServiceTicket(
  id: string,
  input: Partial<Pick<ServiceTicket, "status" | "priority" | "assignee_id" | "resolution_note" | "due_at" | "resolved_at">>
) {
  const now = new Date().toISOString();
  const current = await getServiceTicket(id);
  if (!current) {
    throw new Error("工单不存在");
  }

  const next: ServiceTicket = {
    ...current,
    ...input,
    updated_at: now
  };

  if (input.status || input.resolved_at !== undefined) {
    next.resolved_at = resolveTicketResolvedAt(next.status, input.resolved_at ?? current.resolved_at, now);
  }

  if (input.priority && input.due_at === undefined && !isTicketClosedStatus(next.status)) {
    next.due_at = calculateTicketDueAt(next.priority, now);
  }

  if (isTicketClosedStatus(next.status) && input.due_at === undefined) {
    next.due_at = current.due_at;
  }

  await mysqlExecute(
    `update service_tickets set
      status = :status,
      priority = :priority,
      assignee_id = :assignee_id,
      resolution_note = :resolution_note,
      due_at = :due_at,
      resolved_at = :resolved_at,
      updated_at = :updated_at
      where id = :id`,
    {
      id,
      status: next.status,
      priority: next.priority,
      assignee_id: next.assignee_id,
      resolution_note: next.resolution_note,
      due_at: next.due_at,
      resolved_at: next.resolved_at,
      updated_at: now
    }
  );
  return { ...next, updated_at: now };
}

export async function listServiceTicketComments(ticketId?: string) {
  const rows = await mysqlQuery<Row[]>(
    ticketId
      ? "select * from service_ticket_comments where ticket_id = :ticketId order by created_at asc"
      : "select * from service_ticket_comments order by created_at asc limit 1000",
    ticketId ? { ticketId } : undefined
  );
  return rows.map(serviceTicketCommentFromRow);
}

export async function createServiceTicketComment(
  input: Omit<ServiceTicketComment, "id" | "created_at">
) {
  const record: ServiceTicketComment = {
    id: createId("ticket-comment"),
    created_at: new Date().toISOString(),
    ...input
  };

  await mysqlExecute(
    `insert into service_ticket_comments
      (id, ticket_id, author_id, author_role, body, is_internal, created_at)
      values (:id, :ticket_id, :author_id, :author_role, :body, :is_internal, :created_at)`,
    record
  );

  await mysqlExecute(
    "update service_tickets set updated_at = :updated_at where id = :ticket_id",
    { ticket_id: record.ticket_id, updated_at: record.created_at }
  );

  return record;
}

export async function listSecurityEvents() {
  const rows = await mysqlQuery<Row[]>("select * from security_events order by created_at desc limit 200");
  return rows.map(securityEventFromRow);
}

export async function createSecurityEvent(
  input: Omit<SecurityEvent, "id" | "created_at" | "status" | "resolved_at"> &
    Partial<Pick<SecurityEvent, "status" | "resolved_at">>
) {
  const record: SecurityEvent = {
    id: createId("secevt"),
    status: "pending",
    created_at: new Date().toISOString(),
    resolved_at: null,
    ...input
  };
  await mysqlExecute(
    `insert into security_events
      (id, category, severity, user_id, conversation_id, message_id, title, detail, raw_excerpt, masked_excerpt, metadata, status, created_at, resolved_at)
      values (:id, :category, :severity, :user_id, :conversation_id, :message_id, :title, :detail, :raw_excerpt, :masked_excerpt, :metadata, :status, :created_at, :resolved_at)`,
    {
      ...record,
      metadata: JSON.stringify(record.metadata)
    }
  );
  return record;
}

export async function updateSecurityEvent(
  id: string,
  input: Partial<Pick<SecurityEvent, "status">>
) {
  const resolvedAt = input.status === "resolved" || input.status === "ignored" ? new Date().toISOString() : null;
  await mysqlExecute(
    "update security_events set status = coalesce(:status, status), resolved_at = coalesce(:resolved_at, resolved_at) where id = :id",
    {
      id,
      status: input.status ?? null,
      resolved_at: resolvedAt
    }
  );
  const rows = await mysqlQuery<Row[]>("select * from security_events where id = :id limit 1", { id });
  if (!rows[0]) {
    throw new Error("安全事件不存在");
  }
  return securityEventFromRow(rows[0]);
}

export async function listNotifications(
  userId: string,
  options: { unreadOnly?: boolean; limit?: number } = {}
) {
  const limit = Math.min(Math.max(Number(options.limit ?? 100), 1), 200);
  const rows = await mysqlQuery<Row[]>(
    `select * from notifications
      where user_id = :userId ${options.unreadOnly ? "and read_at is null" : ""}
      order by created_at desc
      limit ${limit}`,
    { userId }
  );
  return rows.map(notificationFromRow);
}

export async function countUnreadNotifications(userId: string) {
  const rows = await mysqlQuery<Row[]>(
    "select count(*) as count from notifications where user_id = :userId and read_at is null",
    { userId }
  );
  return Number(rows[0]?.count ?? 0);
}

export async function createNotification(
  input: Omit<AppNotification, "id" | "read_at" | "created_at"> &
    Partial<Pick<AppNotification, "read_at" | "created_at">>
) {
  const record: AppNotification = {
    id: createId("notification"),
    read_at: null,
    created_at: new Date().toISOString(),
    ...input
  };
  await mysqlExecute(
    `insert into notifications
      (id, user_id, category, severity, title, body, href, source_type, source_id, dedupe_key, metadata, read_at, created_at)
      values (:id, :user_id, :category, :severity, :title, :body, :href, :source_type, :source_id, :dedupe_key, :metadata, :read_at, :created_at)
      on duplicate key update id = id`,
    { ...record, metadata: JSON.stringify(record.metadata) }
  );
  const rows = record.dedupe_key
    ? await mysqlQuery<Row[]>(
        "select * from notifications where user_id = :userId and dedupe_key = :dedupeKey limit 1",
        { userId: record.user_id, dedupeKey: record.dedupe_key }
      )
    : await mysqlQuery<Row[]>("select * from notifications where id = :id limit 1", { id: record.id });
  if (!rows[0]) throw new Error("通知创建失败");
  return notificationFromRow(rows[0]);
}

export async function markNotificationRead(id: string, userId: string, read: boolean) {
  await mysqlExecute(
    "update notifications set read_at = :readAt where id = :id and user_id = :userId",
    { id, userId, readAt: read ? new Date().toISOString() : null }
  );
  const rows = await mysqlQuery<Row[]>(
    "select * from notifications where id = :id and user_id = :userId limit 1",
    { id, userId }
  );
  if (!rows[0]) throw new Error("通知不存在");
  return notificationFromRow(rows[0]);
}

export async function markAllNotificationsRead(userId: string) {
  const result = await mysqlExecute(
    "update notifications set read_at = :readAt where user_id = :userId and read_at is null",
    { userId, readAt: new Date().toISOString() }
  ) as { affectedRows?: number };
  return Number(result.affectedRows ?? 0);
}

export async function listTrainingJobs() {
  const rows = await mysqlQuery<Row[]>("select * from training_jobs order by created_at desc");
  return rows.map(trainingFromRow);
}

export async function getTrainingJob(id: string) {
  const rows = await mysqlQuery<Row[]>("select * from training_jobs where id = :id limit 1", { id });
  return rows[0] ? trainingFromRow(rows[0]) : null;
}

export async function createTrainingJob(input: Omit<TrainingJob, "id" | "created_at">) {
  const record: TrainingJob = {
    id: createId("training"),
    created_at: new Date().toISOString(),
    ...input
  };
  await mysqlExecute(
    `insert into training_jobs
      (id, title, description, instructor, cover_url, visible_departments, mandatory, due_at, quiz_enabled, quiz_pass_score, quiz_max_attempts, quiz_time_limit_minutes, certificate_enabled, ppt_file_name, ppt_storage_path, script_json, audio_paths, status, publish_status, published_by, published_at, created_by, created_at)
      values (:id, :title, :description, :instructor, :cover_url, :visible_departments, :mandatory, :due_at, :quiz_enabled, :quiz_pass_score, :quiz_max_attempts, :quiz_time_limit_minutes, :certificate_enabled, :ppt_file_name, :ppt_storage_path, :script_json, :audio_paths, :status, :publish_status, :published_by, :published_at, :created_by, :created_at)`,
    {
      ...record,
      script_json: JSON.stringify(record.script_json),
      audio_paths: JSON.stringify(record.audio_paths),
      visible_departments: JSON.stringify(record.visible_departments)
    }
  );
  return record;
}

export async function updateTrainingJob(
  id: string,
  input: Partial<Pick<TrainingJob, "script_json" | "audio_paths" | "status" | "title" | "description" | "instructor" | "cover_url" | "visible_departments" | "mandatory" | "due_at" | "quiz_enabled" | "quiz_pass_score" | "quiz_max_attempts" | "quiz_time_limit_minutes" | "certificate_enabled" | "publish_status" | "published_by" | "published_at">>
) {
  const existing = await getTrainingJob(id);
  if (!existing) {
    throw new Error("培训任务不存在");
  }
  const next = { ...existing, ...input };
  await mysqlExecute(
    `update training_jobs set
      title = :title,
      description = :description,
      instructor = :instructor,
      cover_url = :cover_url,
      visible_departments = :visible_departments,
      mandatory = :mandatory,
      due_at = :due_at,
      quiz_enabled = :quiz_enabled,
      quiz_pass_score = :quiz_pass_score,
      quiz_max_attempts = :quiz_max_attempts,
      quiz_time_limit_minutes = :quiz_time_limit_minutes,
      certificate_enabled = :certificate_enabled,
      script_json = :script_json,
      audio_paths = :audio_paths,
      status = :status,
      publish_status = :publish_status,
      published_by = :published_by,
      published_at = :published_at
      where id = :id`,
    {
      id,
      title: next.title,
      description: next.description,
      instructor: next.instructor,
      cover_url: next.cover_url,
      visible_departments: JSON.stringify(next.visible_departments),
      mandatory: next.mandatory,
      due_at: next.due_at,
      quiz_enabled: next.quiz_enabled,
      quiz_pass_score: next.quiz_pass_score,
      quiz_max_attempts: next.quiz_max_attempts,
      quiz_time_limit_minutes: next.quiz_time_limit_minutes,
      certificate_enabled: next.certificate_enabled,
      script_json: JSON.stringify(next.script_json),
      audio_paths: JSON.stringify(next.audio_paths),
      status: next.status,
      publish_status: next.publish_status,
      published_by: next.published_by,
      published_at: next.published_at
    }
  );
  return next;
}

export async function deleteTrainingJob(id: string, options: { skipExistingCheck?: boolean } = {}) {
  if (!options.skipExistingCheck) {
    const existing = await getTrainingJob(id);
    if (!existing) {
      throw new Error("培训任务不存在");
    }
  }

  await Promise.all([
    mysqlExecute("delete from training_certificates where training_job_id = :id", { id }),
    mysqlExecute("delete from training_exam_sessions where training_job_id = :id", { id }),
    mysqlExecute("delete from training_quiz_questions where training_job_id = :id", { id }),
    mysqlExecute("delete from training_quiz_attempts where training_job_id = :id", { id }),
    mysqlExecute("delete from training_progress where training_job_id = :id", { id }),
    mysqlExecute("delete from training_video_jobs where training_job_id = :id", { id })
  ]);
  await mysqlExecute("delete from training_jobs where id = :id", { id });
}

export async function listTrainingVideoJobs(trainingJobId?: string) {
  const rows = trainingJobId
    ? await mysqlQuery<Row[]>(
        "select * from training_video_jobs where training_job_id = :trainingJobId order by created_at desc",
        { trainingJobId }
      )
    : await mysqlQuery<Row[]>("select * from training_video_jobs order by created_at desc");

  return rows.map(trainingVideoJobFromRow);
}

export async function getTrainingVideoJob(id: string) {
  const rows = await mysqlQuery<Row[]>("select * from training_video_jobs where id = :id limit 1", { id });
  return rows[0] ? trainingVideoJobFromRow(rows[0]) : null;
}

export async function createTrainingVideoJob(input: Omit<TrainingVideoJob, "id" | "created_at" | "updated_at">) {
  const now = new Date().toISOString();
  const record: TrainingVideoJob = {
    id: createId("video"),
    created_at: now,
    updated_at: now,
    ...input
  };

  await mysqlExecute(
    `insert into training_video_jobs
      (id, training_job_id, provider, provider_job_id, status, video_url, cover_url, error_message, avatar_id, voice_id, script_summary, metadata, created_by, created_at, updated_at)
      values (:id, :training_job_id, :provider, :provider_job_id, :status, :video_url, :cover_url, :error_message, :avatar_id, :voice_id, :script_summary, :metadata, :created_by, :created_at, :updated_at)`,
    {
      ...record,
      metadata: JSON.stringify(record.metadata)
    }
  );

  return record;
}

export async function updateTrainingVideoJob(
  id: string,
  input: Partial<
    Pick<
      TrainingVideoJob,
      | "provider_job_id"
      | "status"
      | "video_url"
      | "cover_url"
      | "error_message"
      | "avatar_id"
      | "voice_id"
      | "script_summary"
      | "metadata"
    >
  >
) {
  const existing = await getTrainingVideoJob(id);
  if (!existing) {
    throw new Error("数字人视频任务不存在");
  }

  if (existing.status === "ready" && input.status && input.status !== "ready") {
    return existing;
  }

  const next: TrainingVideoJob = {
    ...existing,
    ...input,
    updated_at: new Date().toISOString()
  };

  await mysqlExecute(
    `update training_video_jobs set
      provider_job_id = :provider_job_id,
      status = :status,
      video_url = :video_url,
      cover_url = :cover_url,
      error_message = :error_message,
      avatar_id = :avatar_id,
      voice_id = :voice_id,
      script_summary = :script_summary,
      metadata = :metadata,
      updated_at = :updated_at
      where id = :id`,
    {
      id,
      provider_job_id: next.provider_job_id,
      status: next.status,
      video_url: next.video_url,
      cover_url: next.cover_url,
      error_message: next.error_message,
      avatar_id: next.avatar_id,
      voice_id: next.voice_id,
      script_summary: next.script_summary,
      metadata: JSON.stringify(next.metadata),
      updated_at: next.updated_at
    }
  );

  return next;
}

export async function listTrainingProgress() {
  const rows = await mysqlQuery<Row[]>("select * from training_progress order by updated_at desc");
  return rows.map(trainingProgressFromRow);
}

export async function getDeployOperationStats(): Promise<DeployOperationStats> {
  const rows = await mysqlQuery<Row[]>(
    `select
        (select count(*) from knowledge_tasks where status in ('pending', 'processing')) as open_knowledge_tasks,
        (select count(*) from security_events) as total_security_events,
        (select count(*) from security_events where status in ('pending', 'processing')) as open_security_events,
        (select count(*) from service_tickets) as total_service_tickets,
        (select count(*) from service_tickets where status in ('pending', 'processing')) as open_service_tickets,
        (select count(*) from service_tickets where due_at is not null and status not in ('resolved', 'ignored') and due_at < current_timestamp) as overdue_service_tickets,
        (select count(*) from training_progress) as training_learners,
        (select count(*) from training_progress where progress_percent >= 100) as completed_training_learners`
  );
  const row = rows[0] ?? {};

  return {
    open_knowledge_tasks: Number(row.open_knowledge_tasks ?? 0),
    total_security_events: Number(row.total_security_events ?? 0),
    open_security_events: Number(row.open_security_events ?? 0),
    total_service_tickets: Number(row.total_service_tickets ?? 0),
    open_service_tickets: Number(row.open_service_tickets ?? 0),
    overdue_service_tickets: Number(row.overdue_service_tickets ?? 0),
    training_learners: Number(row.training_learners ?? 0),
    completed_training_learners: Number(row.completed_training_learners ?? 0)
  };
}

export async function getTrainingProgress(trainingJobId: string, userId: string) {
  const rows = await mysqlQuery<Row[]>(
    "select * from training_progress where training_job_id = :trainingJobId and user_id = :userId limit 1",
    { trainingJobId, userId }
  );
  return rows[0] ? trainingProgressFromRow(rows[0]) : null;
}

export async function upsertTrainingProgress(input: {
  training_job_id: string;
  user_id: string;
  completed_pages: number[];
  current_page: number;
  progress_percent: number;
  page_learning_seconds: Record<string, number>;
  total_learning_seconds: number;
  playback_position_seconds: number;
  last_active_at: string | null;
  completed_at: string | null;
}) {
  const existing = await getTrainingProgress(input.training_job_id, input.user_id);
  const now = new Date().toISOString();

  if (!existing) {
    const record: TrainingProgress = {
      id: createId("progress"),
      created_at: now,
      updated_at: now,
      ...input
    };
    await mysqlExecute(
      `insert into training_progress
        (id, training_job_id, user_id, completed_pages, current_page, progress_percent, page_learning_seconds, total_learning_seconds, playback_position_seconds, last_active_at, completed_at, created_at, updated_at)
        values (:id, :training_job_id, :user_id, :completed_pages, :current_page, :progress_percent, :page_learning_seconds, :total_learning_seconds, :playback_position_seconds, :last_active_at, :completed_at, :created_at, :updated_at)`,
      {
        ...record,
        completed_pages: JSON.stringify(record.completed_pages),
        page_learning_seconds: JSON.stringify(record.page_learning_seconds)
      }
    );
    return record;
  }

  await mysqlExecute(
    `update training_progress set
      completed_pages = :completed_pages,
      current_page = :current_page,
      progress_percent = :progress_percent,
      page_learning_seconds = :page_learning_seconds,
      total_learning_seconds = :total_learning_seconds,
      playback_position_seconds = :playback_position_seconds,
      last_active_at = :last_active_at,
      completed_at = :completed_at,
      updated_at = :updated_at
      where id = :id`,
    {
      id: existing.id,
      completed_pages: JSON.stringify(input.completed_pages),
      current_page: input.current_page,
      progress_percent: input.progress_percent,
      page_learning_seconds: JSON.stringify(input.page_learning_seconds),
      total_learning_seconds: input.total_learning_seconds,
      playback_position_seconds: input.playback_position_seconds,
      last_active_at: input.last_active_at,
      completed_at: input.completed_at,
      updated_at: now
    }
  );
  const rows = await mysqlQuery<Row[]>("select * from training_progress where id = :id limit 1", { id: existing.id });
  return trainingProgressFromRow(rows[0]);
}

export async function listTrainingQuizAttempts(trainingJobId: string, userId: string) {
  const rows = await mysqlQuery<Row[]>(
    "select * from training_quiz_attempts where training_job_id = :trainingJobId and user_id = :userId order by created_at desc",
    { trainingJobId, userId }
  );
  return rows.map(trainingQuizAttemptFromRow);
}

export async function listAllTrainingQuizAttempts() {
  const rows = await mysqlQuery<Row[]>("select * from training_quiz_attempts order by created_at desc");
  return rows.map(trainingQuizAttemptFromRow);
}

export async function createTrainingAuditEvent(input: Omit<TrainingAuditEvent, "id" | "created_at">) {
  const record: TrainingAuditEvent = {
    id: createId("training-audit"),
    created_at: new Date().toISOString(),
    ...input
  };
  await mysqlExecute(
    `insert into training_audit_events
      (id, training_job_id, actor_id, action, detail, metadata, created_at)
      values (:id, :training_job_id, :actor_id, :action, :detail, :metadata, :created_at)`,
    { ...record, metadata: JSON.stringify(record.metadata) }
  );
  return record;
}

export async function listTrainingAuditEvents(trainingJobId?: string) {
  const rows = trainingJobId
    ? await mysqlQuery<Row[]>(
        "select * from training_audit_events where training_job_id = :trainingJobId order by created_at desc",
        { trainingJobId }
      )
    : await mysqlQuery<Row[]>("select * from training_audit_events order by created_at desc");
  return rows.map((row): TrainingAuditEvent => ({
    id: row.id,
    training_job_id: row.training_job_id,
    actor_id: row.actor_id,
    action: row.action,
    detail: row.detail,
    metadata: parseJson<Record<string, unknown>>(row.metadata, {}),
    created_at: toIsoString(row.created_at)
  }));
}

export async function createTrainingQuizAttempt(input: Omit<TrainingQuizAttempt, "id" | "created_at">) {
  const record: TrainingQuizAttempt = {
    id: createId("quiz"),
    created_at: new Date().toISOString(),
    ...input
  };
  await mysqlExecute(
    `insert into training_quiz_attempts
      (id, training_job_id, user_id, session_id, answers, result_detail, score, passed, attempt_number, duration_seconds, started_at, submitted_at, created_at)
      values (:id, :training_job_id, :user_id, :session_id, :answers, :result_detail, :score, :passed, :attempt_number, :duration_seconds, :started_at, :submitted_at, :created_at)`,
    {
      ...record,
      answers: JSON.stringify(record.answers),
      result_detail: JSON.stringify(record.result_detail)
    }
  );
  return record;
}

export async function startTrainingExam(input: {
  trainingJobId: string;
  userId: string;
  questions: TrainingQuizQuestion[];
  maxAttempts: number;
  timeLimitMinutes: number;
}) {
  return mysqlTransaction(async (transaction) => {
    await transaction.query<Row[]>("select id from users where id = :userId for update", { userId: input.userId });
    const attemptRows = await transaction.query<Row[]>(
      "select count(*) as count from training_quiz_attempts where training_job_id = :trainingJobId and user_id = :userId",
      { trainingJobId: input.trainingJobId, userId: input.userId }
    );
    if (Number(attemptRows[0]?.count ?? 0) >= input.maxAttempts) {
      throw new Error(`已达到最多 ${input.maxAttempts} 次考试限制`);
    }
    const sessionRows = await transaction.query<Row[]>(
      "select * from training_exam_sessions where training_job_id = :trainingJobId and user_id = :userId and status = 'in_progress' order by created_at desc for update",
      { trainingJobId: input.trainingJobId, userId: input.userId }
    );
    const now = new Date();
    const active = sessionRows.find((row) => new Date(row.expires_at).getTime() > now.getTime());
    if (active) return { session: trainingExamSessionFromRow(active), created: false };
    if (sessionRows.length > 0) {
      await transaction.execute(
        "update training_exam_sessions set status = 'expired', submitted_at = null where training_job_id = :trainingJobId and user_id = :userId and status = 'in_progress'",
        { trainingJobId: input.trainingJobId, userId: input.userId }
      );
    }
    const session: TrainingExamSession = {
      id: createId("training-exam"),
      training_job_id: input.trainingJobId,
      user_id: input.userId,
      question_snapshot: prepareExamQuestions(input.questions),
      status: "in_progress",
      started_at: now.toISOString(),
      expires_at: new Date(now.getTime() + input.timeLimitMinutes * 60_000).toISOString(),
      submitted_at: null,
      created_at: now.toISOString()
    };
    await transaction.execute(
      `insert into training_exam_sessions
        (id, training_job_id, user_id, question_snapshot, status, started_at, expires_at, submitted_at, created_at)
        values (:id, :training_job_id, :user_id, :question_snapshot, :status, :started_at, :expires_at, :submitted_at, :created_at)`,
      { ...session, question_snapshot: JSON.stringify(session.question_snapshot) }
    );
    return { session, created: true };
  });
}

export async function submitTrainingExam(input: {
  trainingJobId: string;
  userId: string;
  sessionId: string;
  answers: Record<string, string | string[]>;
  passScore: number;
  maxAttempts: number;
  certificateEnabled: boolean;
  certificateNo: string;
}) {
  return mysqlTransaction(async (transaction) => {
    await transaction.query<Row[]>("select id from users where id = :userId for update", { userId: input.userId });
    const existingAttempts = await transaction.query<Row[]>(
      "select * from training_quiz_attempts where session_id = :sessionId and user_id = :userId limit 1 for update",
      { sessionId: input.sessionId, userId: input.userId }
    );
    if (existingAttempts[0]) {
      const certificateRows = await transaction.query<Row[]>(
        "select * from training_certificates where training_job_id = :trainingJobId and user_id = :userId limit 1",
        { trainingJobId: input.trainingJobId, userId: input.userId }
      );
      return {
        attempt: trainingQuizAttemptFromRow(existingAttempts[0]),
        certificate: certificateRows[0] ? trainingCertificateFromRow(certificateRows[0]) : null,
        certificateCreated: false
      };
    }
    const sessionRows = await transaction.query<Row[]>(
      "select * from training_exam_sessions where id = :sessionId and training_job_id = :trainingJobId and user_id = :userId limit 1 for update",
      { sessionId: input.sessionId, trainingJobId: input.trainingJobId, userId: input.userId }
    );
    if (!sessionRows[0] || sessionRows[0].status !== "in_progress") throw new Error("考试会话不存在或已提交");
    const session = trainingExamSessionFromRow(sessionRows[0]);
    if (new Date(session.expires_at).getTime() < Date.now()) {
      await transaction.execute("update training_exam_sessions set status = 'expired', submitted_at = null where id = :sessionId", { sessionId: session.id });
      return { attempt: null, certificate: null, certificateCreated: false, error: "考试已超时，请重新开始" };
    }
    const attemptCountRows = await transaction.query<Row[]>(
      "select count(*) as count from training_quiz_attempts where training_job_id = :trainingJobId and user_id = :userId",
      { trainingJobId: input.trainingJobId, userId: input.userId }
    );
    const attemptCount = Number(attemptCountRows[0]?.count ?? 0);
    if (attemptCount >= input.maxAttempts) throw new Error(`已达到最多 ${input.maxAttempts} 次考试限制`);
    const result = gradeTrainingExam(session.question_snapshot, input.answers, input.passScore);
    const submittedAt = new Date();
    const attempt: TrainingQuizAttempt = {
      id: createId("quiz"),
      training_job_id: input.trainingJobId,
      user_id: input.userId,
      session_id: session.id,
      answers: input.answers,
      result_detail: result.result_detail,
      score: result.score,
      passed: result.passed,
      attempt_number: attemptCount + 1,
      duration_seconds: Math.max(0, Math.round((submittedAt.getTime() - new Date(session.started_at).getTime()) / 1000)),
      started_at: session.started_at,
      submitted_at: submittedAt.toISOString(),
      created_at: submittedAt.toISOString()
    };
    await transaction.execute(
      `insert into training_quiz_attempts
        (id, training_job_id, user_id, session_id, answers, result_detail, score, passed, attempt_number, duration_seconds, started_at, submitted_at, created_at)
        values (:id, :training_job_id, :user_id, :session_id, :answers, :result_detail, :score, :passed, :attempt_number, :duration_seconds, :started_at, :submitted_at, :created_at)`,
      { ...attempt, answers: JSON.stringify(attempt.answers), result_detail: JSON.stringify(attempt.result_detail) }
    );
    await transaction.execute(
      "update training_exam_sessions set status = 'submitted', submitted_at = :submittedAt where id = :sessionId and status = 'in_progress'",
      { sessionId: session.id, submittedAt: submittedAt.toISOString() }
    );
    const certificateRows = await transaction.query<Row[]>(
      "select * from training_certificates where training_job_id = :trainingJobId and user_id = :userId limit 1 for update",
      { trainingJobId: input.trainingJobId, userId: input.userId }
    );
    let certificate = certificateRows[0] ? trainingCertificateFromRow(certificateRows[0]) : null;
    let certificateCreated = false;
    if (attempt.passed && input.certificateEnabled && !certificate) {
      certificate = {
        id: createId("training-certificate"),
        certificate_no: input.certificateNo,
        training_job_id: input.trainingJobId,
        user_id: input.userId,
        quiz_attempt_id: attempt.id,
        issued_at: submittedAt.toISOString(),
        revoked_at: null,
        revoked_by: null,
        revoke_reason: null,
        created_at: submittedAt.toISOString()
      };
      await transaction.execute(
        `insert into training_certificates
          (id, certificate_no, training_job_id, user_id, quiz_attempt_id, issued_at, revoked_at, revoked_by, revoke_reason, created_at)
          values (:id, :certificate_no, :training_job_id, :user_id, :quiz_attempt_id, :issued_at, :revoked_at, :revoked_by, :revoke_reason, :created_at)`,
        certificate
      );
      certificateCreated = true;
    }
    return { attempt, certificate, certificateCreated, error: null };
  });
}

export async function listTrainingQuizQuestions(trainingJobId: string, includeDraft = false) {
  const rows = await mysqlQuery<Row[]>(
    `select * from training_quiz_questions where training_job_id = :trainingJobId ${includeDraft ? "" : "and status = 'published'"} order by order_index, created_at`,
    { trainingJobId }
  );
  return rows.map(trainingQuizQuestionFromRow);
}

export async function replaceTrainingQuizQuestions(
  trainingJobId: string,
  questions: Array<Omit<TrainingQuizQuestion, "id" | "training_job_id" | "created_at" | "updated_at">>
) {
  await mysqlExecute("delete from training_quiz_questions where training_job_id = :trainingJobId", { trainingJobId });
  const created: TrainingQuizQuestion[] = [];
  for (const question of questions) {
    const now = new Date().toISOString();
    const record: TrainingQuizQuestion = { id: createId("training-question"), training_job_id: trainingJobId, created_at: now, updated_at: now, ...question };
    await mysqlExecute(
      `insert into training_quiz_questions
        (id, training_job_id, type, prompt, options, correct_answers, explanation, score_weight, order_index, status, created_by, created_at, updated_at)
        values (:id, :training_job_id, :type, :prompt, :options, :correct_answers, :explanation, :score_weight, :order_index, :status, :created_by, :created_at, :updated_at)`,
      { ...record, options: JSON.stringify(record.options), correct_answers: JSON.stringify(record.correct_answers) }
    );
    created.push(record);
  }
  return created;
}

export async function getActiveTrainingExamSession(trainingJobId: string, userId: string) {
  const rows = await mysqlQuery<Row[]>(
    "select * from training_exam_sessions where training_job_id = :trainingJobId and user_id = :userId and status = 'in_progress' order by created_at desc limit 1",
    { trainingJobId, userId }
  );
  return rows[0] ? trainingExamSessionFromRow(rows[0]) : null;
}

export async function createTrainingExamSession(input: Omit<TrainingExamSession, "id" | "created_at">) {
  const record: TrainingExamSession = { id: createId("training-exam"), created_at: new Date().toISOString(), ...input };
  await mysqlExecute(
    `insert into training_exam_sessions
      (id, training_job_id, user_id, question_snapshot, status, started_at, expires_at, submitted_at, created_at)
      values (:id, :training_job_id, :user_id, :question_snapshot, :status, :started_at, :expires_at, :submitted_at, :created_at)`,
    { ...record, question_snapshot: JSON.stringify(record.question_snapshot) }
  );
  return record;
}

export async function updateTrainingExamSession(id: string, input: Pick<TrainingExamSession, "status" | "submitted_at">) {
  await mysqlExecute("update training_exam_sessions set status = :status, submitted_at = :submitted_at where id = :id", { id, ...input });
  const rows = await mysqlQuery<Row[]>("select * from training_exam_sessions where id = :id limit 1", { id });
  if (!rows[0]) throw new Error("考试会话不存在");
  return trainingExamSessionFromRow(rows[0]);
}

export async function getTrainingCertificate(trainingJobId: string, userId: string) {
  const rows = await mysqlQuery<Row[]>("select * from training_certificates where training_job_id = :trainingJobId and user_id = :userId limit 1", { trainingJobId, userId });
  return rows[0] ? trainingCertificateFromRow(rows[0]) : null;
}

export async function listTrainingCertificates(trainingJobId?: string) {
  const rows = trainingJobId
    ? await mysqlQuery<Row[]>("select * from training_certificates where training_job_id = :trainingJobId order by issued_at desc", { trainingJobId })
    : await mysqlQuery<Row[]>("select * from training_certificates order by issued_at desc");
  return rows.map(trainingCertificateFromRow);
}

export async function createTrainingCertificate(input: Omit<TrainingCertificate, "id" | "created_at">) {
  const record: TrainingCertificate = { id: createId("training-certificate"), created_at: new Date().toISOString(), ...input };
  await mysqlExecute(
    `insert into training_certificates
      (id, certificate_no, training_job_id, user_id, quiz_attempt_id, issued_at, revoked_at, revoked_by, revoke_reason, created_at)
      values (:id, :certificate_no, :training_job_id, :user_id, :quiz_attempt_id, :issued_at, :revoked_at, :revoked_by, :revoke_reason, :created_at)
      on duplicate key update quiz_attempt_id = values(quiz_attempt_id)`,
    record
  );
  return (await getTrainingCertificate(input.training_job_id, input.user_id)) ?? record;
}

export async function revokeTrainingCertificate(id: string, revokedBy: string, reason: string) {
  await mysqlExecute("update training_certificates set revoked_at = :revokedAt, revoked_by = :revokedBy, revoke_reason = :reason where id = :id", { id, revokedAt: new Date().toISOString(), revokedBy, reason });
  const rows = await mysqlQuery<Row[]>("select * from training_certificates where id = :id limit 1", { id });
  if (!rows[0]) throw new Error("培训证书不存在");
  return trainingCertificateFromRow(rows[0]);
}

export async function listQaTestMetrics() {
  const rows = await mysqlQuery<Row[]>(
    "select id, status, created_by, created_at, updated_at from qa_test_cases order by updated_at desc"
  );
  return rows.map((row) => ({
    id: String(row.id),
    status: row.status as QaTestCase["status"],
    created_by: row.created_by ? String(row.created_by) : null,
    created_at: toIsoString(row.created_at),
    updated_at: toIsoString(row.updated_at)
  }));
}

export async function listQaTestCases(options: { compactCitations?: boolean } = {}) {
  if (options.compactCitations) {
    const rows = await mysqlQuery<Row[]>(
      `select
        id, question, expected_answer, knowledge_base_ids, answer, model, status, reviewer_note,
        latency_ms, created_by, created_at, updated_at,
        coalesce(json_length(citations), 0) as citation_count,
        json_unquote(json_extract(citations, '$[0].index')) as citation_0_index,
        json_unquote(json_extract(citations, '$[0].file_id')) as citation_0_file_id,
        json_unquote(json_extract(citations, '$[0].file_name')) as citation_0_file_name,
        json_unquote(json_extract(citations, '$[0].chunk_id')) as citation_0_chunk_id,
        json_unquote(json_extract(citations, '$[0].chunk_index')) as citation_0_chunk_index,
        left(json_unquote(json_extract(citations, '$[0].quote')), 220) as citation_0_quote,
        json_unquote(json_extract(citations, '$[0].page')) as citation_0_page,
        json_unquote(json_extract(citations, '$[0].section')) as citation_0_section,
        json_unquote(json_extract(citations, '$[0].sheet')) as citation_0_sheet,
        json_unquote(json_extract(citations, '$[0].cell_range')) as citation_0_cell_range,
        json_unquote(json_extract(citations, '$[0].score')) as citation_0_score,
        left(json_unquote(json_extract(citations, '$[0].score_reason')), 120) as citation_0_score_reason,
        json_extract(citations, '$[0].match_signals') as citation_0_match_signals,
        json_extract(citations, '$[0].match_signal_terms') as citation_0_match_signal_terms,
        json_unquote(json_extract(citations, '$[0].dominant_match_signal')) as citation_0_dominant_match_signal,
        json_unquote(json_extract(citations, '$[1].index')) as citation_1_index,
        json_unquote(json_extract(citations, '$[1].file_id')) as citation_1_file_id,
        json_unquote(json_extract(citations, '$[1].file_name')) as citation_1_file_name,
        json_unquote(json_extract(citations, '$[1].chunk_id')) as citation_1_chunk_id,
        json_unquote(json_extract(citations, '$[1].chunk_index')) as citation_1_chunk_index,
        left(json_unquote(json_extract(citations, '$[1].quote')), 220) as citation_1_quote,
        json_unquote(json_extract(citations, '$[1].page')) as citation_1_page,
        json_unquote(json_extract(citations, '$[1].section')) as citation_1_section,
        json_unquote(json_extract(citations, '$[1].sheet')) as citation_1_sheet,
        json_unquote(json_extract(citations, '$[1].cell_range')) as citation_1_cell_range,
        json_unquote(json_extract(citations, '$[1].score')) as citation_1_score,
        left(json_unquote(json_extract(citations, '$[1].score_reason')), 120) as citation_1_score_reason,
        json_extract(citations, '$[1].match_signals') as citation_1_match_signals,
        json_extract(citations, '$[1].match_signal_terms') as citation_1_match_signal_terms,
        json_unquote(json_extract(citations, '$[1].dominant_match_signal')) as citation_1_dominant_match_signal,
        json_unquote(json_extract(citations, '$[2].index')) as citation_2_index,
        json_unquote(json_extract(citations, '$[2].file_id')) as citation_2_file_id,
        json_unquote(json_extract(citations, '$[2].file_name')) as citation_2_file_name,
        json_unquote(json_extract(citations, '$[2].chunk_id')) as citation_2_chunk_id,
        json_unquote(json_extract(citations, '$[2].chunk_index')) as citation_2_chunk_index,
        left(json_unquote(json_extract(citations, '$[2].quote')), 220) as citation_2_quote,
        json_unquote(json_extract(citations, '$[2].page')) as citation_2_page,
        json_unquote(json_extract(citations, '$[2].section')) as citation_2_section,
        json_unquote(json_extract(citations, '$[2].sheet')) as citation_2_sheet,
        json_unquote(json_extract(citations, '$[2].cell_range')) as citation_2_cell_range,
        json_unquote(json_extract(citations, '$[2].score')) as citation_2_score,
        left(json_unquote(json_extract(citations, '$[2].score_reason')), 120) as citation_2_score_reason,
        json_extract(citations, '$[2].match_signals') as citation_2_match_signals,
        json_extract(citations, '$[2].match_signal_terms') as citation_2_match_signal_terms,
        json_unquote(json_extract(citations, '$[2].dominant_match_signal')) as citation_2_dominant_match_signal
      from qa_test_cases
      order by updated_at desc`
    );
    return rows.map(qaTestCaseSummaryFromRow);
  }

  const rows = await mysqlQuery<Row[]>("select * from qa_test_cases order by updated_at desc");
  return rows.map(qaTestCaseFromRow);
}

export async function getQaTestCase(id: string) {
  const rows = await mysqlQuery<Row[]>("select * from qa_test_cases where id = :id limit 1", { id });
  return rows[0] ? qaTestCaseFromRow(rows[0]) : null;
}

export async function createQaTestCase(input: {
  question: string;
  expected_answer?: string | null;
  knowledge_base_ids: string[];
  created_by: string | null;
}) {
  const now = new Date().toISOString();
  const record: QaTestCase = {
    id: createId("qatest"),
    question: input.question,
    expected_answer: input.expected_answer ?? null,
    knowledge_base_ids: input.knowledge_base_ids,
    answer: null,
    citations: [],
    model: null,
    status: "untested",
    reviewer_note: null,
    latency_ms: null,
    created_by: input.created_by,
    created_at: now,
    updated_at: now
  };

  await mysqlExecute(
    `insert into qa_test_cases
      (id, question, expected_answer, knowledge_base_ids, answer, citations, model, status, reviewer_note, latency_ms, created_by, created_at, updated_at)
      values (:id, :question, :expected_answer, :knowledge_base_ids, :answer, :citations, :model, :status, :reviewer_note, :latency_ms, :created_by, :created_at, :updated_at)`,
    {
      ...record,
      knowledge_base_ids: JSON.stringify(record.knowledge_base_ids),
      citations: JSON.stringify(record.citations)
    }
  );

  return record;
}

export async function updateQaTestCase(
  id: string,
  input: Partial<Pick<QaTestCase, "expected_answer" | "knowledge_base_ids" | "answer" | "citations" | "model" | "status" | "reviewer_note" | "latency_ms">> & {
    question?: string;
  }
) {
  const existing = await getQaTestCase(id);
  if (!existing) {
    throw new Error("测试用例不存在");
  }

  const next: QaTestCase = {
    ...existing,
    ...input,
    updated_at: new Date().toISOString()
  };

  await mysqlExecute(
    `update qa_test_cases set
      question = :question,
      expected_answer = :expected_answer,
      knowledge_base_ids = :knowledge_base_ids,
      answer = :answer,
      citations = :citations,
      model = :model,
      status = :status,
      reviewer_note = :reviewer_note,
      latency_ms = :latency_ms,
      updated_at = :updated_at
      where id = :id`,
    {
      id,
      question: next.question,
      expected_answer: next.expected_answer,
      knowledge_base_ids: JSON.stringify(next.knowledge_base_ids),
      answer: next.answer,
      citations: JSON.stringify(next.citations),
      model: next.model,
      status: next.status,
      reviewer_note: next.reviewer_note,
      latency_ms: next.latency_ms,
      updated_at: next.updated_at
    }
  );

  return next;
}

export async function ensureDefaultAdmin() {
  const email = process.env.INITIAL_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.INITIAL_ADMIN_PASSWORD;

  if (!email || !password) {
    return;
  }

  const rows = await mysqlQuery<Row[]>("select id from users where email = :email limit 1", {
    email
  });
  if (rows.length > 0) {
    return;
  }

  const passwordHash = await hashPassword(password);
  await mysqlExecute(
    `insert into users
      (id, email, name, role, department, password_hash, status, created_at)
      values (:id, :email, :name, :role, :department, :password_hash, :status, :created_at)`,
    {
      ...demoUser,
      id: createId("admin"),
      email,
      name: process.env.INITIAL_ADMIN_NAME?.trim() || "系统管理员",
      password_hash: passwordHash,
      status: "active"
    }
  );
}
