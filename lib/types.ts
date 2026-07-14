export type UserRole = "admin" | "employee";
export type WorkStatus = "pending" | "processing" | "resolved" | "ignored";
export type QaTestStatus = "untested" | "passed" | "failed";
export type DocumentSecurityLevel = "public" | "internal" | "confidential" | "restricted";
export type DocumentPublishStatus = "draft" | "pending_review" | "approved" | "rejected" | "published" | "archived";
export type DocumentReviewerType =
  | "knowledge_base_manager"
  | "department_head"
  | "safety_reviewer"
  | "quality_reviewer";
export type DocumentApprovalRequestStatus = "pending" | "approved" | "rejected" | "withdrawn" | "published" | "archived";
export type DocumentApprovalAction =
  | "submitted"
  | "withdrawn"
  | "approved"
  | "rejected"
  | "published"
  | "archived"
  | "restored_to_draft"
  | "content_edit_started"
  | "release_rollback_requested"
  | "version_rolled_back"
  | "acl_updated";
export type ServiceTicketPriority = "low" | "normal" | "high" | "urgent";
export type SecurityEventCategory = "sensitive_input" | "sensitive_output" | "prompt_injection" | "abnormal_access";
export type SecuritySeverity = "low" | "medium" | "high" | "critical";
export type NotificationCategory = "approval" | "ticket" | "security" | "qa" | "system";
export type NotificationSeverity = "info" | "success" | "warning" | "critical";
export type DigitalHumanJobStatus = "queued" | "generating" | "ready" | "failed";
export type TrainingPublishStatus = "draft" | "published" | "archived";
export type ConversationArchiveFilter = "active" | "archived" | "all";
export type ModelUsageSource = "chat" | "qa" | "training_tts" | "training_video";
export type DocumentChunkGovernanceAuditAction =
  | "pending_suggestion_apply"
  | "pending_suggestion_revoke"
  | "metadata_update"
  | "split"
  | "merge";

export type DocumentChunkGovernanceAuditState = {
  summary: string | null;
  keywords: string[];
  synonyms: string[];
  token_estimate?: number;
  content_length?: number;
  content_preview?: string;
  chunk_index?: number;
  pending_suggestion?: boolean;
  related_chunk_ids?: string[];
};

export type DocumentChunkGovernanceSuggestionSnapshot = {
  summary: string;
  keywords: string[];
  synonyms: string[];
  model?: string | null;
  generated_at?: string | null;
  job_id?: string | null;
};

export type DocumentChunkGovernanceAudit = {
  id: string;
  action: DocumentChunkGovernanceAuditAction;
  actor_id: string;
  actor_name?: string | null;
  actor_email?: string | null;
  created_at: string;
  note?: string | null;
  before?: DocumentChunkGovernanceAuditState;
  after?: DocumentChunkGovernanceAuditState;
  suggestion?: DocumentChunkGovernanceSuggestionSnapshot;
};

export type UserProfile = {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  department: string;
  position: string;
  security_clearance: DocumentSecurityLevel;
  status: "active" | "disabled";
  auth_provider?: string | null;
  external_subject?: string | null;
  created_at: string;
};

export type AppNotification = {
  id: string;
  user_id: string;
  category: NotificationCategory;
  severity: NotificationSeverity;
  title: string;
  body: string;
  href: string | null;
  source_type: string;
  source_id: string | null;
  dedupe_key: string | null;
  metadata: Record<string, unknown>;
  read_at: string | null;
  created_at: string;
};

export type KnowledgeBase = {
  id: string;
  name: string;
  description: string | null;
  openai_vector_store_id: string | null;
  visibility: "all" | "department" | "position" | "admin_only";
  departments: string[];
  positions: string[];
  created_by: string | null;
  created_at: string;
};

export type KnowledgeBaseScope = Pick<
  KnowledgeBase,
  "id" | "name" | "description" | "visibility" | "departments"
> & {
  positions: string[];
  total_documents: number;
  ready_documents: number;
  searchable: boolean;
};

export type DocumentRecord = {
  id: string;
  knowledge_base_id: string;
  title: string;
  file_name: string;
  file_type: string;
  storage_path: string | null;
  openai_file_id: string | null;
  status: "uploading" | "processing" | "ready" | "failed";
  department: string | null;
  tags: string[];
  security_level: DocumentSecurityLevel;
  publish_status: DocumentPublishStatus;
  acl_departments: string[];
  acl_positions: string[];
  acl_roles: UserRole[];
  acl_users: string[];
  approved_by: string | null;
  approved_at: string | null;
  published_by: string | null;
  published_at: string | null;
  published_version_id: string | null;
  published_version: number | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type DocumentReviewerAssignment = {
  id: string;
  user_id: string;
  reviewer_type: DocumentReviewerType;
  knowledge_base_ids: string[];
  departments: string[];
  security_levels: DocumentSecurityLevel[];
  can_review: boolean;
  can_publish: boolean;
  active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type DocumentApprovalRequest = {
  id: string;
  document_id: string;
  document_version_id: string | null;
  status: DocumentApprovalRequestStatus;
  submitted_by: string;
  submitted_at: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_comment: string | null;
  published_by: string | null;
  published_at: string | null;
  withdrawn_by: string | null;
  withdrawn_at: string | null;
  created_at: string;
  updated_at: string;
};

export type DocumentApprovalEvent = {
  id: string;
  request_id: string | null;
  document_id: string;
  action: DocumentApprovalAction;
  actor_id: string;
  actor_name: string;
  actor_role: UserRole;
  comment: string | null;
  from_status: DocumentPublishStatus | null;
  to_status: DocumentPublishStatus | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

export type DocumentPermissionTemplate = {
  id: string;
  name: string;
  description: string | null;
  security_level: DocumentSecurityLevel;
  acl_departments: string[];
  acl_positions: string[];
  acl_roles: UserRole[];
  acl_users: string[];
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type DocumentVersion = {
  id: string;
  document_id: string | null;
  knowledge_base_id: string;
  version: number;
  title: string;
  file_name: string;
  file_type: string;
  status: "uploading" | "processing" | "ready" | "failed";
  change_note: string | null;
  created_by: string | null;
  created_at: string;
};

export type DocumentChunk = {
  id: string;
  document_id: string;
  knowledge_base_id: string;
  chunk_index: number;
  content: string;
  token_estimate: number;
  metadata: {
    title?: string;
    file_name?: string;
    page?: number;
    section?: string;
    sheet?: string;
    cell_range?: string;
    parser?: string;
    source?: string;
    summary?: string;
    keywords?: string[];
    synonyms?: string[];
    pending_suggestion?: {
      summary: string;
      keywords: string[];
      synonyms: string[];
      model?: string | null;
      generated_at?: string;
      job_id?: string | null;
    };
    governance_updated_at?: string;
    governance_updated_by?: string;
    governance_action?: string;
    governance_audit?: DocumentChunkGovernanceAudit[];
    split_from_chunk_id?: string;
    merged_from_chunk_ids?: string[];
  };
  created_at: string;
};

export type DocumentChunkMetadata = Pick<DocumentChunk, "document_id" | "knowledge_base_id" | "metadata">;

export type DocumentChunkGovernanceAuditSource = Pick<
  DocumentChunk,
  "id" | "document_id" | "knowledge_base_id" | "chunk_index" | "token_estimate" | "metadata"
> & {
  content_preview: string;
  document_title: string;
  file_name: string;
  knowledge_base_name: string;
};

export type DocumentChunkPendingSuggestionSource = DocumentChunkGovernanceAuditSource;

export type DocumentChunkDiagnosticStats = {
  document_id: string;
  knowledge_base_id: string | null;
  chunk_count: number;
  page_count: number;
  parsers: string[];
  total_tokens: number;
  average_tokens: number;
  min_tokens: number;
  max_tokens: number;
  empty_chunks: number;
  short_chunks: number;
  long_chunks: number;
  noisy_chunks: number;
};

export type DocumentVersionChunk = {
  id: string;
  document_version_id: string;
  document_id: string | null;
  knowledge_base_id: string;
  chunk_index: number;
  content: string;
  token_estimate: number;
  metadata: DocumentChunk["metadata"];
  created_at: string;
};

export type Conversation = {
  id: string;
  user_id: string;
  title: string;
  archived_at: string | null;
  pinned_at: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
};

export type CitationMatchSignalKey =
  | "content"
  | "title"
  | "file_name"
  | "section"
  | "sheet"
  | "summary"
  | "keywords"
  | "synonyms"
  | "semantic"
  | "proximity"
  | "structural"
  | "recency";

export type CitationDominantMatchSignal = "content" | "summary" | "keywords" | "synonyms" | "metadata" | "semantic" | "mixed";

export type Citation = {
  file_id?: string;
  file_name?: string;
  chunk_id?: string;
  chunk_index?: number;
  quote?: string;
  url?: string;
  index?: number;
  page?: number;
  section?: string;
  sheet?: string;
  cell_range?: string;
  score?: number;
  matched_terms?: string[];
  score_reason?: string;
  match_signals?: Partial<Record<CitationMatchSignalKey, number>>;
  match_signal_terms?: Partial<Record<Extract<CitationMatchSignalKey, "content" | "title" | "file_name" | "section" | "sheet" | "summary" | "keywords" | "synonyms">, string[]>>;
  dominant_match_signal?: CitationDominantMatchSignal;
};

export type Message = {
  id: string;
  conversation_id: string;
  role: "user" | "assistant";
  content: string;
  citations: Citation[];
  model: string | null;
  created_at: string;
};

export type ConversationMessageStats = {
  conversation_id: string;
  message_count: number;
  last_message_at: string | null;
  unreferenced_assistant_count: number;
};

export type WorkflowReadinessStats = {
  knowledge_base_count: number;
  vector_store_count: number;
  ready_document_count: number;
  processing_document_count: number;
  conversation_count: number;
  ready_training_count: number;
};

export type DeployOperationStats = {
  open_knowledge_tasks: number;
  total_security_events: number;
  open_security_events: number;
  total_service_tickets: number;
  open_service_tickets: number;
  overdue_service_tickets: number;
  training_learners: number;
  completed_training_learners: number;
};

export type DocumentProcessingStage =
  | "queued"
  | "reading_source"
  | "pdf_text"
  | "pdf_render"
  | "ocr"
  | "chunking"
  | "saving"
  | "ready"
  | "failed";

export type DocumentProcessingJobSnapshot = {
  document_id: string;
  reason: "upload" | "reprocess";
  stage: DocumentProcessingStage;
  message: string;
  pages_total: number | null;
  pages_done: number | null;
  chunks_created: number | null;
  error: string | null;
  started_at: string;
  updated_at: string;
  finished_at: string | null;
};

export type ModelUsageEvent = {
  id: string;
  source: ModelUsageSource;
  source_id: string | null;
  conversation_id: string | null;
  user_id: string | null;
  provider: string | null;
  model: string | null;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  estimated: boolean;
  cost_usd: number | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

export type Feedback = {
  id: string;
  message_id: string;
  user_id: string;
  rating: "like" | "dislike";
  comment: string | null;
  status: WorkStatus;
  resolution_note: string | null;
  needs_knowledge_update: boolean;
  created_at: string;
};

export type KnowledgeTask = {
  id: string;
  source: "feedback" | "no_citation" | "manual";
  source_id: string | null;
  conversation_id: string;
  question: string;
  answer: string;
  status: WorkStatus;
  note: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type ServiceTicket = {
  id: string;
  conversation_id: string;
  message_id: string | null;
  user_id: string;
  title: string;
  description: string;
  status: WorkStatus;
  priority: ServiceTicketPriority;
  assignee_id: string | null;
  resolution_note: string | null;
  due_at: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ServiceTicketComment = {
  id: string;
  ticket_id: string;
  author_id: string;
  author_role: UserRole;
  body: string;
  is_internal: boolean;
  created_at: string;
};

export type SecurityEvent = {
  id: string;
  category: SecurityEventCategory;
  severity: SecuritySeverity;
  user_id: string | null;
  conversation_id: string | null;
  message_id: string | null;
  title: string;
  detail: string;
  raw_excerpt: string | null;
  masked_excerpt: string | null;
  metadata: Record<string, unknown>;
  status: WorkStatus;
  created_at: string;
  resolved_at: string | null;
};

export type TrainingJob = {
  id: string;
  title: string;
  description: string;
  instructor: string;
  cover_url: string | null;
  visible_departments: string[];
  mandatory: boolean;
  due_at: string | null;
  quiz_enabled: boolean;
  quiz_pass_score: number;
  quiz_max_attempts: number;
  quiz_time_limit_minutes: number;
  certificate_enabled: boolean;
  ppt_file_name: string;
  ppt_storage_path: string | null;
  script_json: Array<{
    page: number;
    title: string;
    bullets: string[];
    notes: string;
    script: string;
    image_path?: string | null;
  }>;
  audio_paths: string[];
  status: "draft" | "generating" | "ready" | "failed";
  publish_status: TrainingPublishStatus;
  published_by: string | null;
  published_at: string | null;
  created_by: string | null;
  created_at: string;
};

export type TrainingVideoJob = {
  id: string;
  training_job_id: string;
  provider: string;
  provider_job_id: string | null;
  status: DigitalHumanJobStatus;
  video_url: string | null;
  cover_url: string | null;
  error_message: string | null;
  avatar_id: string | null;
  voice_id: string | null;
  script_summary: string | null;
  metadata: Record<string, unknown>;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type TrainingProgress = {
  id: string;
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
  created_at: string;
  updated_at: string;
};

export type TrainingAuditEvent = {
  id: string;
  training_job_id: string;
  actor_id: string;
  action: "created" | "updated" | "published" | "unpublished" | "archived" | "audio_regenerated" | "quiz_updated" | "reminders_sent" | "certificate_revoked";
  detail: string;
  metadata: Record<string, unknown>;
  created_at: string;
};

export type TrainingQuizAttempt = {
  id: string;
  training_job_id: string;
  user_id: string;
  session_id: string | null;
  answers: Record<string, string | string[]>;
  result_detail: Array<{
    question_id: string;
    correct: boolean;
    selected_answers: string[];
    correct_answers: string[];
    explanation: string;
  }>;
  score: number;
  passed: boolean;
  attempt_number: number;
  duration_seconds: number;
  started_at: string;
  submitted_at: string;
  created_at: string;
};

export type TrainingQuestionType = "single" | "multiple" | "true_false";

export type TrainingQuizQuestion = {
  id: string;
  training_job_id: string;
  type: TrainingQuestionType;
  prompt: string;
  options: string[];
  correct_answers: string[];
  explanation: string;
  score_weight: number;
  order_index: number;
  status: "draft" | "published";
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type TrainingExamSession = {
  id: string;
  training_job_id: string;
  user_id: string;
  question_snapshot: TrainingQuizQuestion[];
  status: "in_progress" | "submitted" | "expired";
  started_at: string;
  expires_at: string;
  submitted_at: string | null;
  created_at: string;
};

export type TrainingCertificate = {
  id: string;
  certificate_no: string;
  training_job_id: string;
  user_id: string;
  quiz_attempt_id: string;
  issued_at: string;
  revoked_at: string | null;
  revoked_by: string | null;
  revoke_reason: string | null;
  created_at: string;
};

export type QaTestCase = {
  id: string;
  question: string;
  expected_answer: string | null;
  knowledge_base_ids: string[];
  answer: string | null;
  citations: Citation[];
  citation_count?: number;
  model: string | null;
  status: QaTestStatus;
  reviewer_note: string | null;
  latency_ms: number | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};
