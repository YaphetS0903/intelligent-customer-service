import { env, hasSupabaseAdminConfig, hasSupabaseConfig, isLocalTextRag, isMySqlDatabase } from "@/lib/config";
import { cookies } from "next/headers";
import { sessionCookieName, verifySessionToken } from "@/lib/auth-session";
import { createSupabaseAdminClient, createSupabaseServerClient } from "@/lib/supabase/server";
import { createId, demoUser, memoryStore } from "@/lib/mock-store";
import * as mysqlDb from "@/lib/mysql-db";
import { createConversationTitleFromMessage, isDefaultConversationTitle } from "@/lib/conversation-title";
import { calculateTicketDueAt, isTicketClosedStatus, resolveTicketResolvedAt } from "@/lib/service-ticket-rules";
import type {
  AppNotification,
  Conversation,
  ConversationArchiveFilter,
  ConversationMessageStats,
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
  DocumentReviewerAssignment,
  DocumentVersion,
  DocumentVersionChunk,
  Feedback,
  KnowledgeTask,
  KnowledgeBase,
  KnowledgeBaseScope,
  Message,
  ModelUsageEvent,
  QaTestCase,
  SecurityEvent,
  ServiceTicket,
  ServiceTicketComment,
  ServiceTicketPriority,
  TrainingJob,
  TrainingAuditEvent,
  TrainingProgress,
  TrainingQuizAttempt,
  TrainingVideoJob,
  UserProfile,
  WorkflowReadinessStats
} from "@/lib/types";

export async function getCurrentUser(): Promise<UserProfile> {
  if (isMySqlDatabase()) {
    const cookieStore = await cookies();
    const session = await verifySessionToken(cookieStore.get(sessionCookieName)?.value);

    if (!session) {
      throw new Error("请先登录");
    }

    const defaultAdminFallback = getDefaultMySqlAdminFallback(session.userId);
    if (defaultAdminFallback) {
      return withDefaultAdminFallback(
        mysqlDb.getCurrentUser(session.userId),
        defaultAdminFallback
      );
    }

    return mysqlDb.getCurrentUser(session.userId);
  }

  if (!hasSupabaseConfig()) {
    return demoUser;
  }

  const supabase = await createSupabaseServerClient();
  const admin = createSupabaseAdminClient();

  if (!supabase) {
    return demoUser;
  }

  const {
    data: { user },
    error: authError
  } = await supabase.auth.getUser();

  if (authError || !user?.email) {
    throw new Error("请先登录");
  }

  const roleFromEnv = env.adminEmails.includes(user.email.toLowerCase()) ? "admin" : null;

  if (!admin || !hasSupabaseAdminConfig()) {
    return {
      id: user.id,
      email: user.email,
      name: user.user_metadata?.name ?? user.email.split("@")[0],
      role: roleFromEnv ?? "employee",
      department: user.user_metadata?.department ?? "",
      position: user.user_metadata?.position ?? "",
      security_clearance: "internal",
      status: "active",
      created_at: user.created_at ?? new Date().toISOString()
    };
  }

  const { data: profile, error } = await admin
    .from("users")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (profile) {
    if (roleFromEnv === "admin" && profile.role !== "admin") {
      const { data, error: updateError } = await admin
        .from("users")
        .update({ role: "admin" })
        .eq("id", user.id)
        .select("*")
        .single();

      if (updateError) {
        throw new Error(updateError.message);
      }

      return data;
    }

    return profile;
  }

  const newProfile: UserProfile = {
    id: user.id,
    email: user.email,
    name: user.user_metadata?.name ?? user.email.split("@")[0],
    role: roleFromEnv ?? "employee",
    department: user.user_metadata?.department ?? "",
    position: user.user_metadata?.position ?? "",
    security_clearance: "internal",
    status: "active",
    created_at: new Date().toISOString()
  };

  const { data, error: insertError } = await admin.from("users").insert(newProfile).select("*").single();

  if (insertError) {
    throw new Error(insertError.message);
  }

  return data;
}

function getDefaultMySqlAdminFallback(userId: string): UserProfile | null {
  if (userId !== "admin-tianrui") {
    return null;
  }

  return {
    ...demoUser,
    id: "admin-tianrui",
    email: "admin@tianrui.local",
    name: "系统管理员",
    role: "admin",
    auth_provider: null,
    external_subject: null
  };
}

async function withDefaultAdminFallback(userPromise: Promise<UserProfile>, fallback: UserProfile) {
  let timer: ReturnType<typeof setTimeout> | null = null;

  try {
    return await Promise.race([
      userPromise,
      new Promise<UserProfile>((resolve) => {
        timer = setTimeout(() => {
          console.warn("[auth:mysql] default admin lookup timed out, using signed session fallback");
          resolve(fallback);
        }, 2500);
      })
    ]);
  } catch (error) {
    console.warn("[auth:mysql] default admin lookup failed, using signed session fallback", error);
    return fallback;
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

export async function getCurrentUserOrNull(): Promise<UserProfile | null> {
  try {
    return await getCurrentUser();
  } catch {
    return null;
  }
}

export async function requireAdmin(): Promise<UserProfile> {
  const user = await getCurrentUser();

  if (user.role !== "admin") {
    throw new Error("需要管理员权限");
  }

  return user;
}

export async function listUsers(): Promise<UserProfile[]> {
  if (isMySqlDatabase()) {
    return mysqlDb.listUsers();
  }

  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    return [demoUser];
  }

  const { data, error } = await supabase
    .from("users")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return data ?? [];
}

export async function getUserProfile(id: string): Promise<UserProfile | null> {
  if (isMySqlDatabase()) {
    return mysqlDb.getUserProfile(id);
  }

  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    return demoUser.id === id ? demoUser : null;
  }

  const { data, error } = await supabase
    .from("users")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data;
}

export async function updateUserProfile(
  id: string,
  input: Partial<Pick<UserProfile, "name" | "role" | "department" | "position" | "security_clearance" | "status">>
): Promise<UserProfile> {
  if (isMySqlDatabase()) {
    return mysqlDb.updateUserProfile(id, input);
  }

  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    if (demoUser.id !== id) {
      throw new Error("用户不存在");
    }

    Object.assign(demoUser, input);
    return demoUser;
  }

  const { data, error } = await supabase
    .from("users")
    .update(input)
    .eq("id", id)
    .select("*")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data;
}

export async function createUser(input: {
  email: string;
  password: string;
  name: string;
  department: string;
  position?: string;
  security_clearance?: UserProfile["security_clearance"];
  role: UserProfile["role"];
  status?: UserProfile["status"];
}) {
  if (isMySqlDatabase()) {
    return mysqlDb.createUser(input);
  }

  throw new Error("当前数据库模式暂不支持在此创建账号");
}

export async function updateUserPassword(id: string, password: string) {
  if (isMySqlDatabase()) {
    await mysqlDb.updateUserPassword(id, password);
    return;
  }

  throw new Error("当前数据库模式暂不支持重置密码");
}

export async function upsertExternalUser(input: {
  email: string;
  name: string;
  department: string;
  position?: string;
  provider: string;
  subject: string;
}): Promise<UserProfile> {
  if (isMySqlDatabase()) {
    return mysqlDb.upsertExternalUser(input);
  }

  throw new Error("当前数据库模式暂不支持企业统一登录自动建号");
}

export async function listKnowledgeBases(): Promise<KnowledgeBase[]> {
  if (isMySqlDatabase()) {
    return mysqlDb.listKnowledgeBases();
  }

  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    return memoryStore.knowledgeBases;
  }

  const { data, error } = await supabase
    .from("knowledge_bases")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return data ?? [];
}

export function canAccessKnowledgeBase(user: UserProfile, knowledgeBase: KnowledgeBase) {
  if (user.role === "admin") {
    return true;
  }

  if (knowledgeBase.visibility === "admin_only") {
    return false;
  }

  if (knowledgeBase.visibility === "department") {
    return Boolean(user.department && knowledgeBase.departments.includes(user.department));
  }

  if (knowledgeBase.visibility === "position") {
    return Boolean(user.position && knowledgeBase.positions.includes(user.position));
  }

  return true;
}

export function canAccessDocument(user: UserProfile, document: DocumentRecord) {
  if (user.role === "admin") {
    return true;
  }

  if (document.publish_status !== "published") {
    return false;
  }

  const securityRank = { public: 0, internal: 1, confidential: 2, restricted: 3 } as const;
  if (securityRank[user.security_clearance] < securityRank[document.security_level]) {
    return false;
  }

  const hasExplicitAcl =
    document.acl_users.length > 0 ||
    document.acl_roles.length > 0 ||
    document.acl_positions.length > 0 ||
    document.acl_departments.length > 0;
  if (hasExplicitAcl) {
    return (
      document.acl_users.includes(user.id) ||
      document.acl_roles.includes(user.role) ||
      Boolean(user.position && document.acl_positions.includes(user.position)) ||
      Boolean(user.department && document.acl_departments.includes(user.department))
    );
  }

  if (document.department) {
    return document.department === user.department;
  }

  return document.security_level === "public" || document.security_level === "internal";
}

export async function listAccessibleKnowledgeBases(user: UserProfile): Promise<KnowledgeBase[]> {
  const knowledgeBases = await listKnowledgeBases();
  return knowledgeBases.filter((knowledgeBase) => canAccessKnowledgeBase(user, knowledgeBase));
}

export async function listAccessibleKnowledgeBaseScopes(
  user: UserProfile,
  prefetchedDocuments?: DocumentRecord[]
): Promise<KnowledgeBaseScope[]> {
  const [knowledgeBases, documents, chunkMetadata] = await Promise.all([
    listAccessibleKnowledgeBases(user),
    prefetchedDocuments ? Promise.resolve(prefetchedDocuments) : listDocuments(),
    isLocalTextRag() ? listDocumentChunkMetadata() : Promise.resolve([])
  ]);

  return knowledgeBases.map((knowledgeBase) => {
    const relatedDocuments = documents.filter((document) =>
      document.knowledge_base_id === knowledgeBase.id && canAccessDocument(user, document)
    );
    const readyDocuments = relatedDocuments.filter((document) => document.status === "ready").length;
    const relatedDocumentIds = new Set(relatedDocuments.map((document) => document.id));
    const hasLocalChunks = chunkMetadata.some((chunk) =>
      chunk.knowledge_base_id === knowledgeBase.id && relatedDocumentIds.has(chunk.document_id)
    );

    return {
      id: knowledgeBase.id,
      name: knowledgeBase.name,
      description: knowledgeBase.description,
      visibility: knowledgeBase.visibility,
      departments: knowledgeBase.departments,
      positions: knowledgeBase.positions,
      total_documents: relatedDocuments.length,
      ready_documents: readyDocuments,
      searchable: Boolean((knowledgeBase.openai_vector_store_id || hasLocalChunks) && readyDocuments > 0)
    };
  });
}

export async function getKnowledgeBase(id: string): Promise<KnowledgeBase | null> {
  if (isMySqlDatabase()) {
    return mysqlDb.getKnowledgeBase(id);
  }

  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    return memoryStore.knowledgeBases.find((item) => item.id === id) ?? null;
  }

  const { data, error } = await supabase
    .from("knowledge_bases")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data;
}

export async function createKnowledgeBase(
  input: Pick<KnowledgeBase, "name" | "description" | "openai_vector_store_id" | "visibility" | "departments" | "positions">
): Promise<KnowledgeBase> {
  if (isMySqlDatabase()) {
    return mysqlDb.createKnowledgeBase(input);
  }

  const user = await requireAdmin();
  const record: KnowledgeBase = {
    id: createId("kb"),
    created_by: user.id,
    created_at: new Date().toISOString(),
    ...input
  };

  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    memoryStore.knowledgeBases.unshift(record);
    return record;
  }

  const { data, error } = await supabase.from("knowledge_bases").insert(record).select("*").single();
  if (error) {
    throw new Error(error.message);
  }

  return data;
}

export async function updateKnowledgeBase(
  id: string,
  input: Partial<Pick<KnowledgeBase, "name" | "description" | "openai_vector_store_id" | "visibility" | "departments" | "positions">>
): Promise<KnowledgeBase> {
  if (isMySqlDatabase()) {
    return mysqlDb.updateKnowledgeBase(id, input);
  }

  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    const index = memoryStore.knowledgeBases.findIndex((item) => item.id === id);
    if (index === -1) {
      throw new Error("知识库不存在");
    }

    memoryStore.knowledgeBases[index] = {
      ...memoryStore.knowledgeBases[index],
      ...input
    };

    return memoryStore.knowledgeBases[index];
  }

  const { data, error } = await supabase
    .from("knowledge_bases")
    .update(input)
    .eq("id", id)
    .select("*")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data;
}

export async function deleteKnowledgeBase(id: string): Promise<void> {
  if (isMySqlDatabase()) {
    return mysqlDb.deleteKnowledgeBase(id);
  }

  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    const index = memoryStore.knowledgeBases.findIndex((item) => item.id === id);
    if (index === -1) {
      throw new Error("知识库不存在");
    }

    memoryStore.knowledgeBases.splice(index, 1);
    memoryStore.documents = memoryStore.documents.filter((item) => item.knowledge_base_id !== id);
    memoryStore.documentVersions = memoryStore.documentVersions.filter((item) => item.knowledge_base_id !== id);
    memoryStore.documentChunks = memoryStore.documentChunks.filter((item) => item.knowledge_base_id !== id);
    return;
  }

  const { error } = await supabase.from("knowledge_bases").delete().eq("id", id);

  if (error) {
    throw new Error(error.message);
  }
}

export async function listDocuments(): Promise<DocumentRecord[]> {
  if (isMySqlDatabase()) {
    return mysqlDb.listDocuments();
  }

  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    return memoryStore.documents;
  }

  const { data, error } = await supabase
    .from("documents")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return data ?? [];
}

export async function getWorkflowReadinessStats(): Promise<WorkflowReadinessStats> {
  if (isMySqlDatabase()) {
    return mysqlDb.getWorkflowReadinessStats();
  }

  const [knowledgeBases, documents, conversations, trainingJobs] = await Promise.all([
    listKnowledgeBases(),
    listDocuments(),
    listAllConversations(),
    listTrainingJobs()
  ]);

  return {
    knowledge_base_count: knowledgeBases.length,
    vector_store_count: knowledgeBases.filter((item) => Boolean(item.openai_vector_store_id)).length,
    ready_document_count: documents.filter((item) => item.status === "ready").length,
    processing_document_count: documents.filter((item) => item.status === "processing" || item.status === "uploading").length,
    conversation_count: conversations.length,
    ready_training_count: trainingJobs.filter((item) => item.status === "ready").length
  };
}

export async function listDocumentsByKnowledgeBase(knowledgeBaseId: string): Promise<DocumentRecord[]> {
  if (isMySqlDatabase()) {
    return mysqlDb.listDocumentsByKnowledgeBase(knowledgeBaseId);
  }

  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    return memoryStore.documents.filter((item) => item.knowledge_base_id === knowledgeBaseId);
  }

  const { data, error } = await supabase
    .from("documents")
    .select("*")
    .eq("knowledge_base_id", knowledgeBaseId)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return data ?? [];
}

export async function getDocument(id: string): Promise<DocumentRecord | null> {
  if (isMySqlDatabase()) {
    return mysqlDb.getDocument(id);
  }

  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    return memoryStore.documents.find((item) => item.id === id) ?? null;
  }

  const { data, error } = await supabase
    .from("documents")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data;
}

export async function deleteDocument(id: string): Promise<void> {
  if (isMySqlDatabase()) {
    return mysqlDb.deleteDocument(id);
  }

  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    const index = memoryStore.documents.findIndex((item) => item.id === id);
    if (index === -1) {
      throw new Error("文档不存在");
    }

    memoryStore.documents.splice(index, 1);
    memoryStore.documentVersions = memoryStore.documentVersions.filter((item) => item.document_id !== id);
    memoryStore.documentChunks = memoryStore.documentChunks.filter((item) => item.document_id !== id);
    memoryStore.documentVersionChunks = memoryStore.documentVersionChunks.filter((item) => item.document_id !== id);
    return;
  }

  const { error } = await supabase.from("documents").delete().eq("id", id);

  if (error) {
    throw new Error(error.message);
  }
}

export async function listDocumentChunks(documentId?: string): Promise<DocumentChunk[]> {
  if (isMySqlDatabase()) {
    return mysqlDb.listDocumentChunks(documentId);
  }

  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    return documentId
      ? memoryStore.documentChunks.filter((chunk) => chunk.document_id === documentId)
      : memoryStore.documentChunks;
  }

  let query = supabase
    .from("document_chunks")
    .select("*")
    .order("created_at", { ascending: false });

  if (documentId) {
    query = query.eq("document_id", documentId);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(error.message);
  }

  return data ?? [];
}

export async function getDocumentChunk(id: string): Promise<DocumentChunk | null> {
  if (isMySqlDatabase()) {
    return mysqlDb.getDocumentChunk(id);
  }

  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    return memoryStore.documentChunks.find((chunk) => chunk.id === id) ?? null;
  }

  const { data, error } = await supabase
    .from("document_chunks")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data ?? null;
}

export async function updateDocumentChunk(
  id: string,
  input: Partial<Pick<DocumentChunk, "content" | "token_estimate" | "metadata">>
): Promise<DocumentChunk> {
  if (isMySqlDatabase()) {
    return mysqlDb.updateDocumentChunk(id, input);
  }

  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    const index = memoryStore.documentChunks.findIndex((chunk) => chunk.id === id);
    if (index === -1) {
      throw new Error("分片不存在");
    }

    memoryStore.documentChunks[index] = {
      ...memoryStore.documentChunks[index],
      ...input
    };
    return memoryStore.documentChunks[index];
  }

  const { data, error } = await supabase
    .from("document_chunks")
    .update(input)
    .eq("id", id)
    .select("*")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data;
}

export async function listDocumentChunksByScope(input: {
  knowledgeBaseIds: string[];
  documentIds?: string[];
}): Promise<DocumentChunk[]> {
  const knowledgeBaseIds = [...new Set(input.knowledgeBaseIds.filter(Boolean))];
  const documentIds = input.documentIds ? [...new Set(input.documentIds.filter(Boolean))] : null;

  if (knowledgeBaseIds.length === 0 || (documentIds && documentIds.length === 0)) {
    return [];
  }

  if (isMySqlDatabase()) {
    return mysqlDb.listDocumentChunksByScope({ knowledgeBaseIds, documentIds: documentIds ?? undefined });
  }

  const allowedKnowledgeBases = new Set(knowledgeBaseIds);
  const allowedDocuments = documentIds ? new Set(documentIds) : null;
  const supabase = createSupabaseAdminClient();

  if (!supabase) {
    return memoryStore.documentChunks
      .filter((chunk) =>
        allowedKnowledgeBases.has(chunk.knowledge_base_id) &&
        (!allowedDocuments || allowedDocuments.has(chunk.document_id))
      )
      .sort((a, b) => a.document_id.localeCompare(b.document_id) || a.chunk_index - b.chunk_index);
  }

  let query = supabase
    .from("document_chunks")
    .select("*")
    .in("knowledge_base_id", knowledgeBaseIds)
    .order("document_id", { ascending: true })
    .order("chunk_index", { ascending: true });

  if (documentIds) {
    query = query.in("document_id", documentIds);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(error.message);
  }

  return data ?? [];
}

export async function listDocumentChunkMetadata(): Promise<DocumentChunkMetadata[]> {
  if (isMySqlDatabase()) {
    return mysqlDb.listDocumentChunkMetadata();
  }

  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    return memoryStore.documentChunks.map((chunk) => ({
      document_id: chunk.document_id,
      knowledge_base_id: chunk.knowledge_base_id,
      metadata: chunk.metadata
    }));
  }

  const { data, error } = await supabase
    .from("document_chunks")
    .select("document_id, knowledge_base_id, metadata")
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as DocumentChunkMetadata[];
}

export async function listDocumentChunkGovernanceAuditSources(input: {
  knowledgeBaseId?: string;
  limit?: number;
} = {}): Promise<DocumentChunkGovernanceAuditSource[]> {
  if (isMySqlDatabase()) {
    return mysqlDb.listDocumentChunkGovernanceAuditSources(input);
  }

  const limit = Math.min(Math.max(Math.round(input.limit ?? 300), 1), 1000);
  const chunks = (await listDocumentChunks())
    .filter((chunk) => !input.knowledgeBaseId || chunk.knowledge_base_id === input.knowledgeBaseId)
    .filter((chunk) => Array.isArray(chunk.metadata.governance_audit) && chunk.metadata.governance_audit.length > 0)
    .slice(0, limit);
  const [documents, knowledgeBases] = await Promise.all([listDocuments(), listKnowledgeBases()]);
  const documentMap = new Map(documents.map((document) => [document.id, document]));
  const knowledgeBaseMap = new Map(knowledgeBases.map((knowledgeBase) => [knowledgeBase.id, knowledgeBase]));

  return chunks.map((chunk) => {
    const document = documentMap.get(chunk.document_id);
    const knowledgeBase = knowledgeBaseMap.get(chunk.knowledge_base_id);

    return {
      id: chunk.id,
      document_id: chunk.document_id,
      knowledge_base_id: chunk.knowledge_base_id,
      chunk_index: chunk.chunk_index,
      token_estimate: chunk.token_estimate,
      metadata: chunk.metadata,
      content_preview: chunk.content.replace(/\s+/g, " ").trim().slice(0, 120),
      document_title: document?.title ?? "未知资料",
      file_name: document?.file_name ?? "",
      knowledge_base_name: knowledgeBase?.name ?? "未知知识库"
    };
  });
}

export async function listDocumentChunkPendingSuggestionSources(input: {
  knowledgeBaseId?: string;
  limit?: number;
} = {}): Promise<DocumentChunkPendingSuggestionSource[]> {
  if (isMySqlDatabase()) {
    return mysqlDb.listDocumentChunkPendingSuggestionSources(input);
  }

  const limit = Math.min(Math.max(Math.round(input.limit ?? 300), 1), 1000);
  const chunks = (await listDocumentChunks())
    .filter((chunk) => !input.knowledgeBaseId || chunk.knowledge_base_id === input.knowledgeBaseId)
    .filter((chunk) => Boolean(chunk.metadata.pending_suggestion))
    .slice(0, limit);
  const [documents, knowledgeBases] = await Promise.all([listDocuments(), listKnowledgeBases()]);
  const documentMap = new Map(documents.map((document) => [document.id, document]));
  const knowledgeBaseMap = new Map(knowledgeBases.map((knowledgeBase) => [knowledgeBase.id, knowledgeBase]));

  return chunks.map((chunk) => {
    const document = documentMap.get(chunk.document_id);
    const knowledgeBase = knowledgeBaseMap.get(chunk.knowledge_base_id);

    return {
      id: chunk.id,
      document_id: chunk.document_id,
      knowledge_base_id: chunk.knowledge_base_id,
      chunk_index: chunk.chunk_index,
      token_estimate: chunk.token_estimate,
      metadata: chunk.metadata,
      content_preview: chunk.content.replace(/\s+/g, " ").trim().slice(0, 180),
      document_title: document?.title ?? "未知资料",
      file_name: document?.file_name ?? "",
      knowledge_base_name: knowledgeBase?.name ?? "未知知识库"
    };
  });
}

export async function listDocumentChunkDiagnosticStats(): Promise<DocumentChunkDiagnosticStats[]> {
  if (isMySqlDatabase()) {
    return mysqlDb.listDocumentChunkDiagnosticStats();
  }

  const chunks = await listDocumentChunks();
  const statsByDocument = new Map<
    string,
    {
      knowledge_base_id: string | null;
      chunk_count: number;
      total_tokens: number;
      min_tokens: number;
      max_tokens: number;
      empty_chunks: number;
      short_chunks: number;
      long_chunks: number;
      noisy_chunks: number;
      pages: Set<number>;
      parsers: Set<string>;
    }
  >();

  for (const chunk of chunks) {
    const current = statsByDocument.get(chunk.document_id) ?? {
      knowledge_base_id: chunk.knowledge_base_id ?? null,
      chunk_count: 0,
      total_tokens: 0,
      min_tokens: Number.POSITIVE_INFINITY,
      max_tokens: 0,
      empty_chunks: 0,
      short_chunks: 0,
      long_chunks: 0,
      noisy_chunks: 0,
      pages: new Set<number>(),
      parsers: new Set<string>()
    };
    const page = Number(chunk.metadata?.page);
    const parser = chunk.metadata?.parser;
    const tokenEstimate = Number.isFinite(chunk.token_estimate) ? chunk.token_estimate : 0;
    const trimmedLength = chunk.content.trim().length;

    current.chunk_count += 1;
    current.total_tokens += tokenEstimate;
    current.min_tokens = Math.min(current.min_tokens, tokenEstimate);
    current.max_tokens = Math.max(current.max_tokens, tokenEstimate);
    if (trimmedLength === 0) {
      current.empty_chunks += 1;
    } else if (trimmedLength < 80 || tokenEstimate < 30) {
      current.short_chunks += 1;
    }
    if (tokenEstimate > 1200 || chunk.content.length > 6000) {
      current.long_chunks += 1;
    }
    if (
      chunk.content.includes("�") ||
      chunk.content.includes("□") ||
      (parser?.includes("ocr") && (tokenEstimate < 25 || trimmedLength < 80))
    ) {
      current.noisy_chunks += 1;
    }
    if (Number.isFinite(page) && page > 0) {
      current.pages.add(page);
    }
    if (parser) {
      current.parsers.add(parser);
    }
    statsByDocument.set(chunk.document_id, current);
  }

  return Array.from(statsByDocument.entries()).map(([documentId, stats]) => ({
    document_id: documentId,
    knowledge_base_id: stats.knowledge_base_id,
    chunk_count: stats.chunk_count,
    page_count: stats.pages.size,
    parsers: Array.from(stats.parsers),
    total_tokens: stats.total_tokens,
    average_tokens: stats.chunk_count > 0 ? Math.round(stats.total_tokens / stats.chunk_count) : 0,
    min_tokens: Number.isFinite(stats.min_tokens) ? stats.min_tokens : 0,
    max_tokens: stats.max_tokens,
    empty_chunks: stats.empty_chunks,
    short_chunks: stats.short_chunks,
    long_chunks: stats.long_chunks,
    noisy_chunks: stats.noisy_chunks
  }));
}

export async function createDocumentChunks(
  chunks: Array<Omit<DocumentChunk, "id" | "created_at">>
): Promise<DocumentChunk[]> {
  if (isMySqlDatabase()) {
    return mysqlDb.createDocumentChunks(chunks);
  }

  const records: DocumentChunk[] = chunks.map((chunk) => ({
    id: createId("chunk"),
    created_at: new Date().toISOString(),
    ...chunk
  }));

  if (records.length === 0) {
    return [];
  }

  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    memoryStore.documentChunks.unshift(...records);
    return records;
  }

  const { data, error } = await supabase.from("document_chunks").insert(records).select("*");

  if (error) {
    throw new Error(error.message);
  }

  return data ?? [];
}

export async function replaceDocumentChunks(
  documentId: string,
  chunks: Array<Omit<DocumentChunk, "id" | "created_at">>
): Promise<DocumentChunk[]> {
  if (isMySqlDatabase()) {
    return mysqlDb.replaceDocumentChunks(documentId, chunks);
  }

  const records: DocumentChunk[] = chunks.map((chunk) => ({
    id: createId("chunk"),
    created_at: new Date().toISOString(),
    ...chunk
  }));

  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    memoryStore.documentChunks = memoryStore.documentChunks.filter((item) => item.document_id !== documentId);
    memoryStore.documentChunks.unshift(...records);
    return records;
  }

  const { error: deleteError } = await supabase.from("document_chunks").delete().eq("document_id", documentId);
  if (deleteError) {
    throw new Error(deleteError.message);
  }

  if (records.length === 0) {
    return [];
  }

  const { data, error } = await supabase.from("document_chunks").insert(records).select("*");
  if (error) {
    throw new Error(error.message);
  }

  return data ?? [];
}

export async function createDocument(input: Omit<DocumentRecord, "id" | "created_at" | "updated_at" | "security_level" | "publish_status" | "acl_departments" | "acl_positions" | "acl_roles" | "acl_users" | "approved_by" | "approved_at" | "published_by" | "published_at" | "published_version_id" | "published_version"> & Partial<Pick<DocumentRecord, "security_level" | "publish_status" | "acl_departments" | "acl_positions" | "acl_roles" | "acl_users" | "approved_by" | "approved_at" | "published_by" | "published_at" | "published_version_id" | "published_version">>): Promise<DocumentRecord> {
  if (isMySqlDatabase()) {
    return mysqlDb.createDocument(input);
  }

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

  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    memoryStore.documents.unshift(record);
    return record;
  }

  const { data, error } = await supabase.from("documents").insert(record).select("*").single();
  if (error) {
    throw new Error(error.message);
  }

  return data;
}

export async function listDocumentVersions(): Promise<DocumentVersion[]> {
  if (isMySqlDatabase()) {
    return mysqlDb.listDocumentVersions();
  }

  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    return memoryStore.documentVersions;
  }

  const { data, error } = await supabase
    .from("document_versions")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return data ?? [];
}

export async function listDocumentVersionChunks(versionId?: string): Promise<DocumentVersionChunk[]> {
  if (isMySqlDatabase()) {
    return mysqlDb.listDocumentVersionChunks(versionId);
  }

  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    return memoryStore.documentVersionChunks
      .filter((chunk) => !versionId || chunk.document_version_id === versionId)
      .sort((a, b) => a.chunk_index - b.chunk_index);
  }

  let query = supabase
    .from("document_version_chunks")
    .select("*")
    .order("chunk_index", { ascending: true });

  if (versionId) {
    query = query.eq("document_version_id", versionId);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(error.message);
  }

  return data ?? [];
}

export async function createDocumentVersion(
  input: Omit<DocumentVersion, "id" | "version" | "created_at"> & {
    version?: number;
    snapshot_chunks?: Array<Pick<DocumentChunk, "chunk_index" | "content" | "token_estimate" | "metadata">>;
  }
): Promise<DocumentVersion> {
  if (isMySqlDatabase()) {
    return mysqlDb.createDocumentVersion(input);
  }

  const { snapshot_chunks: snapshotChunks, version: inputVersion, ...versionInput } = input;
  const supabase = createSupabaseAdminClient();
  const existingVersions = memoryStore.documentVersions.filter((item) =>
    input.document_id ? item.document_id === input.document_id : item.knowledge_base_id === input.knowledge_base_id
  );
  let version = inputVersion ?? Math.max(0, ...existingVersions.map((item) => item.version)) + 1;

  if (supabase && inputVersion === undefined) {
    let query = supabase
      .from("document_versions")
      .select("version")
      .order("version", { ascending: false })
      .limit(1);
    query = input.document_id
      ? query.eq("document_id", input.document_id)
      : query.is("document_id", null).eq("knowledge_base_id", input.knowledge_base_id);
    const { data: latest, error: latestError } = await query.maybeSingle();
    if (latestError) throw new Error(latestError.message);
    version = Number(latest?.version ?? 0) + 1;
  }

  const record: DocumentVersion = {
    id: createId("docver"),
    version,
    created_at: new Date().toISOString(),
    ...versionInput
  };

  if (!supabase) {
    memoryStore.documentVersions.unshift(record);
    if (snapshotChunks?.length) {
      memoryStore.documentVersionChunks.unshift(...snapshotChunks.map((chunk) => ({
        id: createId("docverchunk"),
        document_version_id: record.id,
        document_id: record.document_id,
        knowledge_base_id: record.knowledge_base_id,
        chunk_index: chunk.chunk_index,
        content: chunk.content,
        token_estimate: chunk.token_estimate,
        metadata: chunk.metadata,
        created_at: new Date().toISOString()
      })));
    }
    return record;
  }

  const { data, error } = await supabase.from("document_versions").insert(record).select("*").single();
  if (error) {
    if (error.code === "23505") {
      let existingQuery = supabase.from("document_versions").select("*").eq("version", record.version);
      existingQuery = record.document_id
        ? existingQuery.eq("document_id", record.document_id)
        : existingQuery.is("document_id", null).eq("knowledge_base_id", record.knowledge_base_id);
      const { data: existing } = await existingQuery.maybeSingle();
      if (existing) return existing;
    }
    throw new Error(error.message);
  }

  if (snapshotChunks?.length) {
    const snapshots = snapshotChunks.map((chunk) => ({
      id: createId("docverchunk"),
      document_version_id: data.id,
      document_id: data.document_id,
      knowledge_base_id: data.knowledge_base_id,
      chunk_index: chunk.chunk_index,
      content: chunk.content,
      token_estimate: chunk.token_estimate,
      metadata: chunk.metadata,
      created_at: new Date().toISOString()
    }));
    const { error: snapshotError } = await supabase.from("document_version_chunks").insert(snapshots);

    if (snapshotError) {
      throw new Error(snapshotError.message);
    }
  }

  return data;
}

export async function restoreDocumentVersionChunks(versionId: string, documentId: string, knowledgeBaseId: string): Promise<number> {
  if (isMySqlDatabase()) {
    return mysqlDb.restoreDocumentVersionChunks(versionId, documentId, knowledgeBaseId);
  }

  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    const snapshots = memoryStore.documentVersionChunks
      .filter((chunk) => chunk.document_version_id === versionId)
      .sort((a, b) => a.chunk_index - b.chunk_index);

    if (snapshots.length === 0) {
      return 0;
    }

    memoryStore.documentChunks = memoryStore.documentChunks.filter((chunk) => chunk.document_id !== documentId);
    memoryStore.documentChunks.unshift(...snapshots.map((snapshot) => ({
      id: createId("chunk"),
      document_id: documentId,
      knowledge_base_id: knowledgeBaseId,
      chunk_index: snapshot.chunk_index,
      content: snapshot.content,
      token_estimate: snapshot.token_estimate,
      metadata: snapshot.metadata,
      created_at: new Date().toISOString()
    })));
    return snapshots.length;
  }

  const { data: snapshots, error } = await supabase
    .from("document_version_chunks")
    .select("*")
    .eq("document_version_id", versionId)
    .order("chunk_index", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  if (!snapshots || snapshots.length === 0) {
    return 0;
  }

  const { error: deleteError } = await supabase.from("document_chunks").delete().eq("document_id", documentId);

  if (deleteError) {
    throw new Error(deleteError.message);
  }

  const restored = snapshots.map((snapshot) => ({
    id: createId("chunk"),
    document_id: documentId,
    knowledge_base_id: knowledgeBaseId,
    chunk_index: snapshot.chunk_index,
    content: snapshot.content,
    token_estimate: snapshot.token_estimate,
    metadata: snapshot.metadata,
    created_at: new Date().toISOString()
  }));
  const { error: insertError } = await supabase.from("document_chunks").insert(restored);

  if (insertError) {
    throw new Error(insertError.message);
  }

  return restored.length;
}

export async function updateDocument(
  id: string,
  input: Partial<Pick<DocumentRecord, "status" | "openai_file_id" | "storage_path" | "title" | "file_name" | "file_type" | "department" | "tags" | "security_level" | "publish_status" | "acl_departments" | "acl_positions" | "acl_roles" | "acl_users" | "approved_by" | "approved_at" | "published_by" | "published_at" | "published_version_id" | "published_version">>
): Promise<DocumentRecord> {
  if (isMySqlDatabase()) {
    return mysqlDb.updateDocument(id, input);
  }

  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    const index = memoryStore.documents.findIndex((item) => item.id === id);
    if (index === -1) {
      throw new Error("文档不存在");
    }

    memoryStore.documents[index] = {
      ...memoryStore.documents[index],
      ...input,
      updated_at: new Date().toISOString()
    };

    return memoryStore.documents[index];
  }

  const { data, error } = await supabase
    .from("documents")
    .update(input)
    .eq("id", id)
    .select("*")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data;
}

export async function listDocumentReviewerAssignments(userId?: string): Promise<DocumentReviewerAssignment[]> {
  if (isMySqlDatabase()) {
    return mysqlDb.listDocumentReviewerAssignments(userId);
  }
  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    return memoryStore.documentReviewerAssignments.filter((item) => !userId || item.user_id === userId);
  }
  let query = supabase.from("document_reviewer_assignments").select("*").order("created_at", { ascending: false });
  if (userId) {
    query = query.eq("user_id", userId);
  }
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function createDocumentReviewerAssignment(
  input: Omit<DocumentReviewerAssignment, "id" | "created_at" | "updated_at">
): Promise<DocumentReviewerAssignment> {
  if (isMySqlDatabase()) {
    return mysqlDb.createDocumentReviewerAssignment(input);
  }
  const now = new Date().toISOString();
  const record: DocumentReviewerAssignment = { id: createId("reviewer"), created_at: now, updated_at: now, ...input };
  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    memoryStore.documentReviewerAssignments.unshift(record);
    return record;
  }
  const { data, error } = await supabase.from("document_reviewer_assignments").insert(record).select("*").single();
  if (error) throw new Error(error.message);
  return data;
}

export async function updateDocumentReviewerAssignment(
  id: string,
  input: Partial<Pick<DocumentReviewerAssignment, "reviewer_type" | "knowledge_base_ids" | "departments" | "security_levels" | "can_review" | "can_publish" | "active">>
): Promise<DocumentReviewerAssignment> {
  if (isMySqlDatabase()) {
    return mysqlDb.updateDocumentReviewerAssignment(id, input);
  }
  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    const index = memoryStore.documentReviewerAssignments.findIndex((item) => item.id === id);
    if (index === -1) throw new Error("审批授权不存在");
    memoryStore.documentReviewerAssignments[index] = {
      ...memoryStore.documentReviewerAssignments[index],
      ...input,
      updated_at: new Date().toISOString()
    };
    return memoryStore.documentReviewerAssignments[index];
  }
  const { data, error } = await supabase
    .from("document_reviewer_assignments")
    .update({ ...input, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export async function deleteDocumentReviewerAssignment(id: string): Promise<void> {
  if (isMySqlDatabase()) return mysqlDb.deleteDocumentReviewerAssignment(id);
  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    memoryStore.documentReviewerAssignments = memoryStore.documentReviewerAssignments.filter((item) => item.id !== id);
    return;
  }
  const { error } = await supabase.from("document_reviewer_assignments").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export async function listDocumentApprovalRequests(): Promise<DocumentApprovalRequest[]> {
  if (isMySqlDatabase()) return mysqlDb.listDocumentApprovalRequests();
  const supabase = createSupabaseAdminClient();
  if (!supabase) return memoryStore.documentApprovalRequests;
  const { data, error } = await supabase.from("document_approval_requests").select("*").order("updated_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function getDocumentApprovalRequest(id: string): Promise<DocumentApprovalRequest | null> {
  if (isMySqlDatabase()) return mysqlDb.getDocumentApprovalRequest(id);
  const supabase = createSupabaseAdminClient();
  if (!supabase) return memoryStore.documentApprovalRequests.find((item) => item.id === id) ?? null;
  const { data, error } = await supabase.from("document_approval_requests").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

export async function getActiveDocumentApprovalRequest(documentId: string): Promise<DocumentApprovalRequest | null> {
  if (isMySqlDatabase()) return mysqlDb.getActiveDocumentApprovalRequest(documentId);
  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    return memoryStore.documentApprovalRequests.find((item) =>
      item.document_id === documentId && (item.status === "pending" || item.status === "approved" || item.status === "published")
    ) ?? null;
  }
  const { data, error } = await supabase
    .from("document_approval_requests")
    .select("*")
    .eq("document_id", documentId)
    .in("status", ["pending", "approved", "published"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

export async function createDocumentApprovalRequest(
  input: Omit<DocumentApprovalRequest, "id" | "created_at" | "updated_at">
): Promise<DocumentApprovalRequest> {
  if (isMySqlDatabase()) return mysqlDb.createDocumentApprovalRequest(input);
  const now = new Date().toISOString();
  const record: DocumentApprovalRequest = { id: createId("approval"), created_at: now, updated_at: now, ...input };
  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    memoryStore.documentApprovalRequests.unshift(record);
    return record;
  }
  const { data, error } = await supabase.from("document_approval_requests").insert(record).select("*").single();
  if (error) throw new Error(error.message);
  return data;
}

export async function updateDocumentApprovalRequest(
  id: string,
  input: Partial<Pick<DocumentApprovalRequest, "status" | "reviewed_by" | "reviewed_at" | "review_comment" | "published_by" | "published_at" | "withdrawn_by" | "withdrawn_at">>
): Promise<DocumentApprovalRequest> {
  if (isMySqlDatabase()) return mysqlDb.updateDocumentApprovalRequest(id, input);
  const supabase = createSupabaseAdminClient();
  const update = { ...input, updated_at: new Date().toISOString() };
  if (!supabase) {
    const index = memoryStore.documentApprovalRequests.findIndex((item) => item.id === id);
    if (index === -1) throw new Error("审批申请不存在");
    memoryStore.documentApprovalRequests[index] = { ...memoryStore.documentApprovalRequests[index], ...update };
    return memoryStore.documentApprovalRequests[index];
  }
  const { data, error } = await supabase.from("document_approval_requests").update(update).eq("id", id).select("*").single();
  if (error) throw new Error(error.message);
  return data;
}

export async function listDocumentApprovalEvents(documentId?: string): Promise<DocumentApprovalEvent[]> {
  if (isMySqlDatabase()) return mysqlDb.listDocumentApprovalEvents(documentId);
  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    return memoryStore.documentApprovalEvents.filter((item) => !documentId || item.document_id === documentId);
  }
  let query = supabase.from("document_approval_events").select("*").order("created_at", { ascending: false });
  if (documentId) query = query.eq("document_id", documentId);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function createDocumentApprovalEvent(
  input: Omit<DocumentApprovalEvent, "id" | "created_at">
): Promise<DocumentApprovalEvent> {
  if (isMySqlDatabase()) return mysqlDb.createDocumentApprovalEvent(input);
  const record: DocumentApprovalEvent = { id: createId("approvalevent"), created_at: new Date().toISOString(), ...input };
  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    memoryStore.documentApprovalEvents.unshift(record);
    return record;
  }
  const { data, error } = await supabase.from("document_approval_events").insert(record).select("*").single();
  if (error) throw new Error(error.message);
  return data;
}

export async function listDocumentPermissionTemplates(): Promise<DocumentPermissionTemplate[]> {
  if (isMySqlDatabase()) return mysqlDb.listDocumentPermissionTemplates();
  const supabase = createSupabaseAdminClient();
  if (!supabase) return memoryStore.documentPermissionTemplates;
  const { data, error } = await supabase.from("document_permission_templates").select("*").order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function createDocumentPermissionTemplate(
  input: Omit<DocumentPermissionTemplate, "id" | "created_at" | "updated_at">
): Promise<DocumentPermissionTemplate> {
  if (isMySqlDatabase()) return mysqlDb.createDocumentPermissionTemplate(input);
  const now = new Date().toISOString();
  const record: DocumentPermissionTemplate = { id: createId("acltemplate"), created_at: now, updated_at: now, ...input };
  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    memoryStore.documentPermissionTemplates.unshift(record);
    return record;
  }
  const { data, error } = await supabase.from("document_permission_templates").insert(record).select("*").single();
  if (error) throw new Error(error.message);
  return data;
}

export async function updateDocumentPermissionTemplate(
  id: string,
  input: Partial<Pick<DocumentPermissionTemplate, "name" | "description" | "security_level" | "acl_departments" | "acl_positions" | "acl_roles" | "acl_users">>
): Promise<DocumentPermissionTemplate> {
  if (isMySqlDatabase()) return mysqlDb.updateDocumentPermissionTemplate(id, input);
  const supabase = createSupabaseAdminClient();
  const update = { ...input, updated_at: new Date().toISOString() };
  if (!supabase) {
    const index = memoryStore.documentPermissionTemplates.findIndex((item) => item.id === id);
    if (index === -1) throw new Error("权限模板不存在");
    memoryStore.documentPermissionTemplates[index] = { ...memoryStore.documentPermissionTemplates[index], ...update };
    return memoryStore.documentPermissionTemplates[index];
  }
  const { data, error } = await supabase.from("document_permission_templates").update(update).eq("id", id).select("*").single();
  if (error) throw new Error(error.message);
  return data;
}

export async function deleteDocumentPermissionTemplate(id: string): Promise<void> {
  if (isMySqlDatabase()) return mysqlDb.deleteDocumentPermissionTemplate(id);
  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    memoryStore.documentPermissionTemplates = memoryStore.documentPermissionTemplates.filter((item) => item.id !== id);
    return;
  }
  const { error } = await supabase.from("document_permission_templates").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

function matchesConversationArchiveFilter(conversation: Conversation, filter: ConversationArchiveFilter) {
  if (filter === "all") {
    return true;
  }

  return filter === "archived" ? Boolean(conversation.archived_at) : !conversation.archived_at;
}

function sortConversationsForFilter(
  a: Conversation,
  b: Conversation,
  filter: ConversationArchiveFilter
) {
  if (filter === "active") {
    const aPinned = a.pinned_at ? new Date(a.pinned_at).getTime() : 0;
    const bPinned = b.pinned_at ? new Date(b.pinned_at).getTime() : 0;

    if (aPinned !== bPinned) {
      return bPinned - aPinned;
    }
  }

  return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
}

export async function listConversations(
  userId: string,
  filter: ConversationArchiveFilter = "active",
  searchQuery = ""
): Promise<Conversation[]> {
  if (isMySqlDatabase()) {
    return mysqlDb.listConversations(userId, filter, searchQuery);
  }

  const trimmedQuery = searchQuery.trim().toLowerCase();
  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    const matchedConversationIds = new Set(
      trimmedQuery
        ? memoryStore.messages
            .filter((message) => message.content.toLowerCase().includes(trimmedQuery))
            .map((message) => message.conversation_id)
        : []
    );

    return memoryStore.conversations
      .filter((item) => item.user_id === userId && matchesConversationArchiveFilter(item, filter))
      .filter((item) =>
        trimmedQuery
          ? item.title.toLowerCase().includes(trimmedQuery) || matchedConversationIds.has(item.id)
          : true
      )
      .sort((a, b) => sortConversationsForFilter(a, b, filter));
  }

  let query = supabase
    .from("conversations")
    .select("*")
    .eq("user_id", userId);

  if (filter === "active") {
    query = query.is("archived_at", null);
  }

  if (filter === "archived") {
    query = query.not("archived_at", "is", null);
  }

  query =
    filter === "active"
      ? query
          .order("pinned_at", { ascending: false, nullsFirst: false })
          .order("updated_at", { ascending: false })
      : query.order("updated_at", { ascending: false });

  const { data, error } = await query;

  if (error) {
    throw new Error(error.message);
  }

  const conversations = data ?? [];

  if (!trimmedQuery || conversations.length === 0) {
    return conversations;
  }

  const conversationIds = conversations.map((conversation) => conversation.id);
  const { data: matchedMessages, error: messageError } = await supabase
    .from("messages")
    .select("conversation_id")
    .in("conversation_id", conversationIds)
    .ilike("content", `%${trimmedQuery}%`);

  if (messageError) {
    throw new Error(messageError.message);
  }

  const matchedConversationIds = new Set((matchedMessages ?? []).map((message) => message.conversation_id));
  return conversations.filter(
    (conversation) =>
      conversation.title.toLowerCase().includes(trimmedQuery) || matchedConversationIds.has(conversation.id)
  );
}

export async function listAllConversations(): Promise<Conversation[]> {
  if (isMySqlDatabase()) {
    return mysqlDb.listAllConversations();
  }

  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    return memoryStore.conversations;
  }

  const { data, error } = await supabase
    .from("conversations")
    .select("*")
    .order("updated_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return data ?? [];
}

export async function upsertConversation(title: string, conversationId?: string): Promise<Conversation> {
  if (isMySqlDatabase()) {
    return mysqlDb.upsertConversation(title, conversationId);
  }

  const user = await getCurrentUser();
  const now = new Date().toISOString();
  const normalizedTitle = createConversationTitleFromMessage(title);
  const supabase = createSupabaseAdminClient();

  if (conversationId) {
    const existing = memoryStore.conversations.find((item) => item.id === conversationId);
    if (existing) {
      if (isDefaultConversationTitle(existing.title) && !isDefaultConversationTitle(normalizedTitle)) {
        existing.title = normalizedTitle;
      }
      existing.archived_at = null;
      existing.pinned_at = null;
      existing.updated_at = now;
      return existing;
    }

    if (supabase) {
      const { data: existingConversation, error: existingError } = await supabase
        .from("conversations")
        .select("title")
        .eq("id", conversationId)
        .eq("user_id", user.id)
        .maybeSingle();

      if (existingError) {
        throw new Error(existingError.message);
      }

      if (existingConversation) {
        const shouldUpdateTitle =
          isDefaultConversationTitle(existingConversation.title) && !isDefaultConversationTitle(normalizedTitle);
        const { data, error } = await supabase
          .from("conversations")
          .update({
            ...(shouldUpdateTitle ? { title: normalizedTitle } : {}),
            archived_at: null,
            pinned_at: null,
            updated_at: now
          })
          .eq("id", conversationId)
          .eq("user_id", user.id)
          .select("*")
          .maybeSingle();

        if (error) {
          throw new Error(error.message);
        }

        if (data) {
          return data;
        }
      }

      const { data, error } = await supabase
        .from("conversations")
        .update({ archived_at: null, pinned_at: null, updated_at: now })
        .eq("id", conversationId)
        .eq("user_id", user.id)
        .select("*")
        .maybeSingle();

      if (error) {
        throw new Error(error.message);
      }

      if (data) {
        return data;
      }
    }
  }

  const record: Conversation = {
    id: createId("conv"),
    user_id: user.id,
    title: normalizedTitle,
    archived_at: null,
    pinned_at: null,
    created_at: now,
    updated_at: now
  };

  if (!supabase) {
    memoryStore.conversations.unshift(record);
    return record;
  }

  const { data, error } = await supabase.from("conversations").insert(record).select("*").single();
  if (error) {
    throw new Error(error.message);
  }

  return data;
}

export async function archiveConversation(
  conversationId: string,
  archived: boolean
): Promise<Conversation | null> {
  if (isMySqlDatabase()) {
    return mysqlDb.archiveConversation(conversationId, archived);
  }

  const user = await getCurrentUser();
  const now = new Date().toISOString();
  const archivedAt = archived ? now : null;
  const supabase = createSupabaseAdminClient();

  if (!supabase) {
    const existing = memoryStore.conversations.find(
      (item) => item.id === conversationId && item.user_id === user.id
    );

    if (!existing) {
      return null;
    }

    existing.archived_at = archivedAt;
    if (archived) {
      existing.pinned_at = null;
    }
    existing.updated_at = now;
    return existing;
  }

  const updateInput = archived
    ? { archived_at: archivedAt, pinned_at: null, updated_at: now }
    : { archived_at: archivedAt, updated_at: now };

  const { data, error } = await supabase
    .from("conversations")
    .update(updateInput)
    .eq("id", conversationId)
    .eq("user_id", user.id)
    .select("*")
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data ?? null;
}

export async function pinConversation(
  conversationId: string,
  pinned: boolean
): Promise<Conversation | null> {
  if (isMySqlDatabase()) {
    return mysqlDb.pinConversation(conversationId, pinned);
  }

  const user = await getCurrentUser();
  const pinnedAt = pinned ? new Date().toISOString() : null;
  const supabase = createSupabaseAdminClient();

  if (!supabase) {
    const existing = memoryStore.conversations.find(
      (item) => item.id === conversationId && item.user_id === user.id && !item.archived_at
    );

    if (!existing) {
      return null;
    }

    existing.pinned_at = pinnedAt;
    return existing;
  }

  const { data, error } = await supabase
    .from("conversations")
    .update({ pinned_at: pinnedAt })
    .eq("id", conversationId)
    .eq("user_id", user.id)
    .is("archived_at", null)
    .select("*")
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data ?? null;
}

export async function renameConversation(conversationId: string, title: string): Promise<Conversation | null> {
  if (isMySqlDatabase()) {
    return mysqlDb.renameConversation(conversationId, title);
  }

  const user = await getCurrentUser();
  const now = new Date().toISOString();
  const supabase = createSupabaseAdminClient();

  if (!supabase) {
    const existing = memoryStore.conversations.find(
      (item) => item.id === conversationId && item.user_id === user.id
    );

    if (!existing) {
      return null;
    }

    existing.title = title;
    existing.updated_at = now;
    return existing;
  }

  const { data, error } = await supabase
    .from("conversations")
    .update({ title, updated_at: now })
    .eq("id", conversationId)
    .eq("user_id", user.id)
    .select("*")
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data ?? null;
}

export async function deleteArchivedConversation(conversationId: string): Promise<boolean> {
  if (isMySqlDatabase()) {
    return mysqlDb.deleteArchivedConversation(conversationId);
  }

  const user = await getCurrentUser();
  const supabase = createSupabaseAdminClient();

  if (!supabase) {
    const conversation = memoryStore.conversations.find(
      (item) => item.id === conversationId && item.user_id === user.id && item.archived_at
    );

    if (!conversation) {
      return false;
    }

    const messageIds = new Set(
      memoryStore.messages
        .filter((message) => message.conversation_id === conversationId)
        .map((message) => message.id)
    );
    const ticketIds = new Set(
      memoryStore.serviceTickets
        .filter((ticket) => ticket.conversation_id === conversationId)
        .map((ticket) => ticket.id)
    );

    memoryStore.feedback = memoryStore.feedback.filter((item) => !messageIds.has(item.message_id));
    memoryStore.serviceTicketComments = memoryStore.serviceTicketComments.filter((item) => !ticketIds.has(item.ticket_id));
    memoryStore.serviceTickets = memoryStore.serviceTickets.filter((item) => item.conversation_id !== conversationId);
    memoryStore.knowledgeTasks = memoryStore.knowledgeTasks.filter((item) => item.conversation_id !== conversationId);
    memoryStore.securityEvents = memoryStore.securityEvents.filter((item) => item.conversation_id !== conversationId);
    memoryStore.modelUsageEvents = memoryStore.modelUsageEvents.filter((item) => item.conversation_id !== conversationId);
    memoryStore.messages = memoryStore.messages.filter((item) => item.conversation_id !== conversationId);
    memoryStore.conversations = memoryStore.conversations.filter((item) => item.id !== conversationId);
    return true;
  }

  const { data: conversation, error: conversationError } = await supabase
    .from("conversations")
    .select("id")
    .eq("id", conversationId)
    .eq("user_id", user.id)
    .not("archived_at", "is", null)
    .maybeSingle();

  if (conversationError) {
    throw new Error(conversationError.message);
  }

  if (!conversation) {
    return false;
  }

  const { data: messages, error: messagesError } = await supabase
    .from("messages")
    .select("id")
    .eq("conversation_id", conversationId);

  if (messagesError) {
    throw new Error(messagesError.message);
  }

  const messageIds = (messages ?? []).map((message) => message.id);

  if (messageIds.length > 0) {
    const { error } = await supabase.from("feedback").delete().in("message_id", messageIds);
    if (error) {
      throw new Error(error.message);
    }
  }

  const { data: tickets, error: ticketsError } = await supabase
    .from("service_tickets")
    .select("id")
    .eq("conversation_id", conversationId);

  if (ticketsError) {
    throw new Error(ticketsError.message);
  }

  const ticketIds = (tickets ?? []).map((ticket) => ticket.id);

  if (ticketIds.length > 0) {
    const { error } = await supabase.from("service_ticket_comments").delete().in("ticket_id", ticketIds);
    if (error) {
      throw new Error(error.message);
    }
  }

  await supabase.from("service_tickets").delete().eq("conversation_id", conversationId);
  await supabase.from("knowledge_tasks").delete().eq("conversation_id", conversationId);
  await supabase.from("security_events").delete().eq("conversation_id", conversationId);
  await supabase.from("messages").delete().eq("conversation_id", conversationId);

  const { error: deleteError } = await supabase
    .from("conversations")
    .delete()
    .eq("id", conversationId)
    .eq("user_id", user.id);

  if (deleteError) {
    throw new Error(deleteError.message);
  }

  return true;
}

export async function listMessages(conversationId: string): Promise<Message[]> {
  if (isMySqlDatabase()) {
    return mysqlDb.listMessages(conversationId);
  }

  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    return memoryStore.messages.filter((item) => item.conversation_id === conversationId);
  }

  const { data, error } = await supabase
    .from("messages")
    .select("*")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return data ?? [];
}

export async function listAllMessages(): Promise<Message[]> {
  if (isMySqlDatabase()) {
    return mysqlDb.listAllMessages();
  }

  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    return [...memoryStore.messages].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  }

  const { data, error } = await supabase
    .from("messages")
    .select("*")
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return data ?? [];
}

export async function listMessageMetrics(): Promise<Message[]> {
  if (isMySqlDatabase()) {
    return mysqlDb.listMessageMetrics();
  }

  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    return [...memoryStore.messages].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  }

  const { data, error } = await supabase
    .from("messages")
    .select("id, conversation_id, role, citations, model, created_at")
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []).map((message) => ({ ...message, content: "" })) as Message[];
}

export async function countAllMessages(): Promise<number> {
  if (isMySqlDatabase()) {
    return mysqlDb.countAllMessages();
  }

  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    return memoryStore.messages.length;
  }

  const { count, error } = await supabase
    .from("messages")
    .select("id", { count: "exact", head: true });

  if (error) {
    throw new Error(error.message);
  }

  return count ?? 0;
}

export async function listRecentMessages(limit = 1200): Promise<Message[]> {
  if (isMySqlDatabase()) {
    return mysqlDb.listRecentMessages(limit);
  }

  const safeLimit = Math.min(Math.max(Math.trunc(limit) || 1200, 1), 5000);
  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    return [...memoryStore.messages]
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
      .slice(-safeLimit);
  }

  const { data, error } = await supabase
    .from("messages")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(safeLimit);

  if (error) {
    throw new Error(error.message);
  }

  return [...(data ?? [])].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
}

export async function listConversationMessageStats(): Promise<ConversationMessageStats[]> {
  if (isMySqlDatabase()) {
    return mysqlDb.listConversationMessageStats();
  }

  const messages = await listAllMessages();
  const stats = new Map<string, ConversationMessageStats>();

  for (const message of messages) {
    const current = stats.get(message.conversation_id) ?? {
      conversation_id: message.conversation_id,
      message_count: 0,
      last_message_at: null,
      unreferenced_assistant_count: 0
    };

    current.message_count += 1;
    if (!current.last_message_at || new Date(message.created_at).getTime() > new Date(current.last_message_at).getTime()) {
      current.last_message_at = message.created_at;
    }
    if (message.role === "assistant" && citationsCountForMessageStats(message.citations) === 0) {
      current.unreferenced_assistant_count += 1;
    }
    stats.set(message.conversation_id, current);
  }

  return [...stats.values()];
}

function citationsCountForMessageStats(citations: Message["citations"] | null | undefined) {
  return Array.isArray(citations) ? citations.length : 0;
}

export async function createMessage(input: Omit<Message, "id" | "created_at">): Promise<Message> {
  if (isMySqlDatabase()) {
    return mysqlDb.createMessage(input);
  }

  const record: Message = {
    id: createId("msg"),
    created_at: new Date().toISOString(),
    ...input
  };

  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    memoryStore.messages.push(record);
    return record;
  }

  const { data, error } = await supabase.from("messages").insert(record).select("*").single();
  if (error) {
    throw new Error(error.message);
  }

  return data;
}

export async function createModelUsageEvent(input: Omit<ModelUsageEvent, "id" | "created_at">): Promise<ModelUsageEvent> {
  if (isMySqlDatabase()) {
    return mysqlDb.createModelUsageEvent(input);
  }

  const record: ModelUsageEvent = {
    id: createId("usage"),
    created_at: new Date().toISOString(),
    ...input
  };

  memoryStore.modelUsageEvents.unshift(record);
  return record;
}

export async function listModelUsageEvents(
  limit = 500,
  filters: {
    source?: ModelUsageEvent["source"];
    sourceId?: string;
  } = {}
): Promise<ModelUsageEvent[]> {
  if (isMySqlDatabase()) {
    return mysqlDb.listModelUsageEvents(limit, filters);
  }

  return [...memoryStore.modelUsageEvents]
    .filter((event) => !filters.source || event.source === filters.source)
    .filter((event) => !filters.sourceId || event.source_id === filters.sourceId)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, Math.min(Math.max(Math.round(limit), 1), 2000));
}

export async function createFeedback(
  input: Omit<Feedback, "id" | "created_at" | "status" | "resolution_note" | "needs_knowledge_update"> &
    Partial<Pick<Feedback, "status" | "resolution_note" | "needs_knowledge_update">>
): Promise<Feedback> {
  if (isMySqlDatabase()) {
    return mysqlDb.createFeedback(input);
  }

  const record: Feedback = {
    id: createId("feedback"),
    created_at: new Date().toISOString(),
    status: "pending",
    resolution_note: null,
    needs_knowledge_update: input.rating === "dislike",
    ...input
  };

  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    memoryStore.feedback.unshift(record);
    return record;
  }

  const { data, error } = await supabase.from("feedback").insert(record).select("*").single();
  if (error) {
    throw new Error(error.message);
  }

  return data;
}

export async function updateFeedback(
  id: string,
  input: Partial<Pick<Feedback, "status" | "resolution_note" | "needs_knowledge_update">>
): Promise<Feedback> {
  if (isMySqlDatabase()) {
    return mysqlDb.updateFeedback(id, input);
  }

  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    const index = memoryStore.feedback.findIndex((item) => item.id === id);
    if (index === -1) {
      throw new Error("反馈不存在");
    }

    memoryStore.feedback[index] = {
      ...memoryStore.feedback[index],
      ...input
    };

    return memoryStore.feedback[index];
  }

  const { data, error } = await supabase
    .from("feedback")
    .update(input)
    .eq("id", id)
    .select("*")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data;
}

export async function listFeedback(): Promise<Feedback[]> {
  if (isMySqlDatabase()) {
    return mysqlDb.listFeedback();
  }

  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    return memoryStore.feedback;
  }

  const { data, error } = await supabase
    .from("feedback")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return data ?? [];
}

export async function listKnowledgeTasks(): Promise<KnowledgeTask[]> {
  if (isMySqlDatabase()) {
    return mysqlDb.listKnowledgeTasks();
  }

  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    return memoryStore.knowledgeTasks;
  }

  const { data, error } = await supabase
    .from("knowledge_tasks")
    .select("*")
    .order("updated_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return data ?? [];
}

export async function createKnowledgeTask(
  input: Omit<KnowledgeTask, "id" | "created_at" | "updated_at">
): Promise<KnowledgeTask> {
  if (isMySqlDatabase()) {
    return mysqlDb.createKnowledgeTask(input);
  }

  const now = new Date().toISOString();
  const record: KnowledgeTask = {
    id: createId("task"),
    created_at: now,
    updated_at: now,
    ...input
  };

  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    memoryStore.knowledgeTasks.unshift(record);
    return record;
  }

  const { data, error } = await supabase.from("knowledge_tasks").insert(record).select("*").single();
  if (error) {
    throw new Error(error.message);
  }

  return data;
}

export async function updateKnowledgeTask(
  id: string,
  input: Partial<Pick<KnowledgeTask, "status" | "note">>
): Promise<KnowledgeTask> {
  if (isMySqlDatabase()) {
    return mysqlDb.updateKnowledgeTask(id, input);
  }

  const next = {
    ...input,
    updated_at: new Date().toISOString()
  };
  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    const index = memoryStore.knowledgeTasks.findIndex((item) => item.id === id);
    if (index === -1) {
      throw new Error("任务不存在");
    }

    memoryStore.knowledgeTasks[index] = {
      ...memoryStore.knowledgeTasks[index],
      ...next
    };

    return memoryStore.knowledgeTasks[index];
  }

  const { data, error } = await supabase
    .from("knowledge_tasks")
    .update(next)
    .eq("id", id)
    .select("*")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data;
}

export async function listServiceTickets(): Promise<ServiceTicket[]> {
  if (isMySqlDatabase()) {
    return mysqlDb.listServiceTickets();
  }

  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    return memoryStore.serviceTickets;
  }

  const { data, error } = await supabase
    .from("service_tickets")
    .select("*")
    .order("updated_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return data ?? [];
}

export async function getServiceTicket(id: string): Promise<ServiceTicket | null> {
  if (isMySqlDatabase()) {
    return mysqlDb.getServiceTicket(id);
  }

  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    return memoryStore.serviceTickets.find((ticket) => ticket.id === id) ?? null;
  }

  const { data, error } = await supabase
    .from("service_tickets")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data ?? null;
}

export async function listServiceTicketsByUser(userId: string): Promise<ServiceTicket[]> {
  if (isMySqlDatabase()) {
    return mysqlDb.listServiceTicketsByUser(userId);
  }

  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    return memoryStore.serviceTickets.filter((ticket) => ticket.user_id === userId);
  }

  const { data, error } = await supabase
    .from("service_tickets")
    .select("*")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return data ?? [];
}

export async function createServiceTicket(
  input: Omit<ServiceTicket, "id" | "created_at" | "updated_at" | "status" | "priority" | "assignee_id" | "resolution_note" | "due_at" | "resolved_at"> &
    Partial<Pick<ServiceTicket, "status" | "priority" | "assignee_id" | "resolution_note" | "due_at" | "resolved_at">>
): Promise<ServiceTicket> {
  if (isMySqlDatabase()) {
    return mysqlDb.createServiceTicket(input);
  }

  const now = new Date().toISOString();
  const status = input.status ?? "pending";
  const priority = input.priority ?? "normal";
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

  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    memoryStore.serviceTickets.unshift(record);
    return record;
  }

  const { data, error } = await supabase.from("service_tickets").insert(record).select("*").single();
  if (error) {
    throw new Error(error.message);
  }

  return data;
}

export async function updateServiceTicket(
  id: string,
  input: Partial<Pick<ServiceTicket, "status" | "priority" | "assignee_id" | "resolution_note" | "due_at" | "resolved_at">>
): Promise<ServiceTicket> {
  if (isMySqlDatabase()) {
    return mysqlDb.updateServiceTicket(id, input);
  }

  const current = await getServiceTicket(id);
  if (!current) {
    throw new Error("工单不存在");
  }

  const now = new Date().toISOString();
  const next = {
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

  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    const index = memoryStore.serviceTickets.findIndex((item) => item.id === id);
    if (index === -1) {
      throw new Error("工单不存在");
    }

    memoryStore.serviceTickets[index] = next;

    return memoryStore.serviceTickets[index];
  }

  const updatePayload: Partial<Pick<ServiceTicket, "status" | "priority" | "assignee_id" | "resolution_note" | "due_at" | "resolved_at" | "updated_at">> = {
    status: next.status,
    priority: next.priority,
    assignee_id: next.assignee_id,
    resolution_note: next.resolution_note,
    due_at: next.due_at,
    resolved_at: next.resolved_at,
    updated_at: now
  };

  const { data, error } = await supabase
    .from("service_tickets")
    .update(updatePayload)
    .eq("id", id)
    .select("*")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data;
}

export async function listServiceTicketComments(ticketId?: string): Promise<ServiceTicketComment[]> {
  if (isMySqlDatabase()) {
    return mysqlDb.listServiceTicketComments(ticketId);
  }

  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    return memoryStore.serviceTicketComments
      .filter((comment) => !ticketId || comment.ticket_id === ticketId)
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  }

  let query = supabase
    .from("service_ticket_comments")
    .select("*")
    .order("created_at", { ascending: true })
    .limit(1000);

  if (ticketId) {
    query = query.eq("ticket_id", ticketId);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(error.message);
  }

  return data ?? [];
}

export async function createServiceTicketComment(
  input: Omit<ServiceTicketComment, "id" | "created_at">
): Promise<ServiceTicketComment> {
  if (isMySqlDatabase()) {
    return mysqlDb.createServiceTicketComment(input);
  }

  const record: ServiceTicketComment = {
    id: createId("ticket-comment"),
    created_at: new Date().toISOString(),
    ...input
  };

  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    memoryStore.serviceTicketComments.push(record);
    const ticketIndex = memoryStore.serviceTickets.findIndex((ticket) => ticket.id === record.ticket_id);
    if (ticketIndex !== -1) {
      memoryStore.serviceTickets[ticketIndex] = {
        ...memoryStore.serviceTickets[ticketIndex],
        updated_at: record.created_at
      };
    }
    return record;
  }

  const { data, error } = await supabase
    .from("service_ticket_comments")
    .insert(record)
    .select("*")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  await supabase
    .from("service_tickets")
    .update({ updated_at: record.created_at })
    .eq("id", record.ticket_id);

  return data;
}

export async function listSecurityEvents(): Promise<SecurityEvent[]> {
  if (isMySqlDatabase()) {
    return mysqlDb.listSecurityEvents();
  }

  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    return memoryStore.securityEvents;
  }

  const { data, error } = await supabase
    .from("security_events")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    throw new Error(error.message);
  }

  return data ?? [];
}

export async function createSecurityEvent(
  input: Omit<SecurityEvent, "id" | "created_at" | "status" | "resolved_at"> &
    Partial<Pick<SecurityEvent, "status" | "resolved_at">>
): Promise<SecurityEvent> {
  let event: SecurityEvent;
  if (isMySqlDatabase()) {
    event = await mysqlDb.createSecurityEvent(input);
  } else {
    const record: SecurityEvent = {
      id: createId("secevt"),
      status: "pending",
      created_at: new Date().toISOString(),
      resolved_at: null,
      ...input
    };

    const supabase = createSupabaseAdminClient();
    if (!supabase) {
      memoryStore.securityEvents.unshift(record);
      event = record;
    } else {
      const { data, error } = await supabase.from("security_events").insert(record).select("*").single();
      if (error) throw new Error(error.message);
      event = data;
    }
  }

  await notifyAdminsAboutSecurityEvent(event);
  return event;
}

export async function updateSecurityEvent(
  id: string,
  input: Partial<Pick<SecurityEvent, "status">>
): Promise<SecurityEvent> {
  if (isMySqlDatabase()) {
    return mysqlDb.updateSecurityEvent(id, input);
  }

  const next = {
    ...input,
    resolved_at: input.status === "resolved" || input.status === "ignored" ? new Date().toISOString() : null
  };
  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    const index = memoryStore.securityEvents.findIndex((item) => item.id === id);
    if (index === -1) {
      throw new Error("安全事件不存在");
    }

    memoryStore.securityEvents[index] = {
      ...memoryStore.securityEvents[index],
      ...next
    };

    return memoryStore.securityEvents[index];
  }

  const { data, error } = await supabase
    .from("security_events")
    .update(next)
    .eq("id", id)
    .select("*")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data;
}

export async function listNotifications(
  userId: string,
  options: { unreadOnly?: boolean; limit?: number } = {}
): Promise<AppNotification[]> {
  if (isMySqlDatabase()) {
    return mysqlDb.listNotifications(userId, options);
  }

  const limit = Math.min(Math.max(Number(options.limit ?? 100), 1), 200);
  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    return memoryStore.notifications
      .filter((item) => item.user_id === userId && (!options.unreadOnly || !item.read_at))
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, limit);
  }

  let query = supabase
    .from("notifications")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (options.unreadOnly) query = query.is("read_at", null);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function countUnreadNotifications(userId: string) {
  if (isMySqlDatabase()) {
    return mysqlDb.countUnreadNotifications(userId);
  }

  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    return memoryStore.notifications.filter((item) => item.user_id === userId && !item.read_at).length;
  }
  const { count, error } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .is("read_at", null);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

export async function createNotification(
  input: Omit<AppNotification, "id" | "read_at" | "created_at"> &
    Partial<Pick<AppNotification, "read_at" | "created_at">>
): Promise<AppNotification> {
  if (isMySqlDatabase()) {
    return mysqlDb.createNotification(input);
  }

  const record: AppNotification = {
    id: createId("notification"),
    read_at: null,
    created_at: new Date().toISOString(),
    ...input
  };
  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    const existing = record.dedupe_key
      ? memoryStore.notifications.find((item) => item.user_id === record.user_id && item.dedupe_key === record.dedupe_key)
      : null;
    if (existing) return existing;
    memoryStore.notifications.unshift(record);
    return record;
  }

  if (record.dedupe_key) {
    const { data: existing, error: existingError } = await supabase
      .from("notifications")
      .select("*")
      .eq("user_id", record.user_id)
      .eq("dedupe_key", record.dedupe_key)
      .maybeSingle();
    if (existingError) throw new Error(existingError.message);
    if (existing) return existing;
  }

  const { data, error } = await supabase.from("notifications").insert(record).select("*").single();
  if (error) throw new Error(error.message);
  return data;
}

export async function markNotificationRead(id: string, userId: string, read: boolean) {
  if (isMySqlDatabase()) {
    return mysqlDb.markNotificationRead(id, userId, read);
  }

  const readAt = read ? new Date().toISOString() : null;
  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    const index = memoryStore.notifications.findIndex((item) => item.id === id && item.user_id === userId);
    if (index === -1) throw new Error("通知不存在");
    memoryStore.notifications[index] = { ...memoryStore.notifications[index], read_at: readAt };
    return memoryStore.notifications[index];
  }
  const { data, error } = await supabase
    .from("notifications")
    .update({ read_at: readAt })
    .eq("id", id)
    .eq("user_id", userId)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export async function markAllNotificationsRead(userId: string) {
  if (isMySqlDatabase()) {
    return mysqlDb.markAllNotificationsRead(userId);
  }

  const readAt = new Date().toISOString();
  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    let count = 0;
    memoryStore.notifications = memoryStore.notifications.map((item) => {
      if (item.user_id !== userId || item.read_at) return item;
      count += 1;
      return { ...item, read_at: readAt };
    });
    return count;
  }
  const { data, error } = await supabase
    .from("notifications")
    .update({ read_at: readAt })
    .eq("user_id", userId)
    .is("read_at", null)
    .select("id");
  if (error) throw new Error(error.message);
  return data?.length ?? 0;
}

async function notifyAdminsAboutSecurityEvent(event: SecurityEvent) {
  if (event.severity !== "high" && event.severity !== "critical") return;
  try {
    const admins = (await listUsers()).filter((user) => user.role === "admin" && user.status === "active");
    await Promise.allSettled(admins.map((admin) => createNotification({
      user_id: admin.id,
      category: "security",
      severity: event.severity === "critical" ? "critical" : "warning",
      title: event.severity === "critical" ? "发现严重安全告警" : "发现高危安全告警",
      body: `${event.title}：${event.detail.slice(0, 180)}`,
      href: "/admin/insights?tab=security",
      source_type: "security_event",
      source_id: event.id,
      dedupe_key: `security:${event.id}`,
      metadata: {
        security_event_id: event.id,
        category: event.category,
        severity: event.severity,
        delivery: { in_app: true, external_channels: [] }
      }
    })));
  } catch (error) {
    console.warn("[security-event:notification]", error);
  }
}

export async function listTrainingJobs(): Promise<TrainingJob[]> {
  if (isMySqlDatabase()) {
    return mysqlDb.listTrainingJobs();
  }

  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    return memoryStore.trainingJobs;
  }

  const { data, error } = await supabase
    .from("training_jobs")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return data ?? [];
}

export async function getTrainingJob(id: string): Promise<TrainingJob | null> {
  if (isMySqlDatabase()) {
    return mysqlDb.getTrainingJob(id);
  }

  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    return memoryStore.trainingJobs.find((item) => item.id === id) ?? null;
  }

  const { data, error } = await supabase
    .from("training_jobs")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data;
}

export async function createTrainingJob(input: Omit<TrainingJob, "id" | "created_at">): Promise<TrainingJob> {
  if (isMySqlDatabase()) {
    return mysqlDb.createTrainingJob(input);
  }

  const record: TrainingJob = {
    id: createId("training"),
    created_at: new Date().toISOString(),
    ...input
  };

  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    memoryStore.trainingJobs.unshift(record);
    return record;
  }

  const { data, error } = await supabase.from("training_jobs").insert(record).select("*").single();
  if (error) {
    throw new Error(error.message);
  }

  return data;
}

export async function updateTrainingJob(
  id: string,
  input: Partial<Pick<TrainingJob, "script_json" | "audio_paths" | "status" | "title" | "description" | "instructor" | "cover_url" | "visible_departments" | "publish_status" | "published_by" | "published_at">>
): Promise<TrainingJob> {
  if (isMySqlDatabase()) {
    return mysqlDb.updateTrainingJob(id, input);
  }

  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    const index = memoryStore.trainingJobs.findIndex((item) => item.id === id);
    if (index === -1) {
      throw new Error("培训任务不存在");
    }

    memoryStore.trainingJobs[index] = {
      ...memoryStore.trainingJobs[index],
      ...input
    };

    return memoryStore.trainingJobs[index];
  }

  const { data, error } = await supabase
    .from("training_jobs")
    .update(input)
    .eq("id", id)
    .select("*")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data;
}

export async function deleteTrainingJob(id: string, options: { skipExistingCheck?: boolean } = {}): Promise<void> {
  if (isMySqlDatabase()) {
    await mysqlDb.deleteTrainingJob(id, options);
    return;
  }

  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    const jobIndex = memoryStore.trainingJobs.findIndex((item) => item.id === id);
    if (jobIndex === -1) {
      throw new Error("培训任务不存在");
    }

    memoryStore.trainingVideoJobs = memoryStore.trainingVideoJobs.filter((item) => item.training_job_id !== id);
    memoryStore.trainingProgress = memoryStore.trainingProgress.filter((item) => item.training_job_id !== id);
    memoryStore.trainingQuizAttempts = memoryStore.trainingQuizAttempts.filter((item) => item.training_job_id !== id);
    memoryStore.trainingJobs.splice(jobIndex, 1);
    return;
  }

  const cleanupTables = ["training_quiz_attempts", "training_progress", "training_video_jobs"];
  for (const table of cleanupTables) {
    const { error } = await supabase.from(table).delete().eq("training_job_id", id);
    if (error) {
      throw new Error(error.message);
    }
  }

  const { error } = await supabase.from("training_jobs").delete().eq("id", id);
  if (error) {
    throw new Error(error.message);
  }
}

export async function listTrainingVideoJobs(trainingJobId?: string): Promise<TrainingVideoJob[]> {
  if (isMySqlDatabase()) {
    return mysqlDb.listTrainingVideoJobs(trainingJobId);
  }

  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    return memoryStore.trainingVideoJobs
      .filter((item) => !trainingJobId || item.training_job_id === trainingJobId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  let query = supabase
    .from("training_video_jobs")
    .select("*")
    .order("created_at", { ascending: false });

  if (trainingJobId) {
    query = query.eq("training_job_id", trainingJobId);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(error.message);
  }

  return data ?? [];
}

export async function getTrainingVideoJob(id: string): Promise<TrainingVideoJob | null> {
  if (isMySqlDatabase()) {
    return mysqlDb.getTrainingVideoJob(id);
  }

  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    return memoryStore.trainingVideoJobs.find((item) => item.id === id) ?? null;
  }

  const { data, error } = await supabase
    .from("training_video_jobs")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data;
}

export async function createTrainingVideoJob(
  input: Omit<TrainingVideoJob, "id" | "created_at" | "updated_at">
): Promise<TrainingVideoJob> {
  if (isMySqlDatabase()) {
    return mysqlDb.createTrainingVideoJob(input);
  }

  const now = new Date().toISOString();
  const record: TrainingVideoJob = {
    id: createId("video"),
    created_at: now,
    updated_at: now,
    ...input
  };

  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    memoryStore.trainingVideoJobs.unshift(record);
    return record;
  }

  const { data, error } = await supabase.from("training_video_jobs").insert(record).select("*").single();
  if (error) {
    throw new Error(error.message);
  }

  return data;
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
): Promise<TrainingVideoJob> {
  if (isMySqlDatabase()) {
    return mysqlDb.updateTrainingVideoJob(id, input);
  }

  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    const index = memoryStore.trainingVideoJobs.findIndex((item) => item.id === id);
    if (index === -1) {
      throw new Error("数字人视频任务不存在");
    }

    if (memoryStore.trainingVideoJobs[index].status === "ready" && input.status && input.status !== "ready") {
      return memoryStore.trainingVideoJobs[index];
    }

    const next = {
      ...input,
      updated_at: new Date().toISOString()
    };

    memoryStore.trainingVideoJobs[index] = {
      ...memoryStore.trainingVideoJobs[index],
      ...next
    };

    return memoryStore.trainingVideoJobs[index];
  }

  const existing = await getTrainingVideoJob(id);
  if (!existing) {
    throw new Error("数字人视频任务不存在");
  }

  if (existing.status === "ready" && input.status && input.status !== "ready") {
    return existing;
  }

  const next = {
    ...input,
    updated_at: new Date().toISOString()
  };

  const { data, error } = await supabase
    .from("training_video_jobs")
    .update(next)
    .eq("id", id)
    .select("*")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data;
}

export async function listTrainingProgress(): Promise<TrainingProgress[]> {
  if (isMySqlDatabase()) {
    return mysqlDb.listTrainingProgress();
  }

  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    return memoryStore.trainingProgress;
  }

  const { data, error } = await supabase
    .from("training_progress")
    .select("*")
    .order("updated_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return data ?? [];
}

export async function getDeployOperationStats(): Promise<DeployOperationStats> {
  if (isMySqlDatabase()) {
    return mysqlDb.getDeployOperationStats();
  }

  const [knowledgeTasks, securityEvents, serviceTickets, trainingProgress] = await Promise.all([
    listKnowledgeTasks(),
    listSecurityEvents(),
    listServiceTickets(),
    listTrainingProgress()
  ]);
  const now = Date.now();

  return {
    open_knowledge_tasks: knowledgeTasks.filter((task) => task.status === "pending" || task.status === "processing").length,
    total_security_events: securityEvents.length,
    open_security_events: securityEvents.filter((event) => event.status === "pending" || event.status === "processing").length,
    total_service_tickets: serviceTickets.length,
    open_service_tickets: serviceTickets.filter((ticket) => ticket.status === "pending" || ticket.status === "processing").length,
    overdue_service_tickets: serviceTickets.filter((ticket) =>
      Boolean(ticket.due_at && !isTicketClosedStatus(ticket.status) && new Date(ticket.due_at).getTime() < now)
    ).length,
    training_learners: trainingProgress.length,
    completed_training_learners: trainingProgress.filter((item) => item.progress_percent >= 100).length
  };
}

export async function getTrainingProgress(trainingJobId: string, userId: string): Promise<TrainingProgress | null> {
  if (isMySqlDatabase()) {
    return mysqlDb.getTrainingProgress(trainingJobId, userId);
  }

  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    return memoryStore.trainingProgress.find((item) => item.training_job_id === trainingJobId && item.user_id === userId) ?? null;
  }

  const { data, error } = await supabase
    .from("training_progress")
    .select("*")
    .eq("training_job_id", trainingJobId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data;
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
}): Promise<TrainingProgress> {
  if (isMySqlDatabase()) {
    return mysqlDb.upsertTrainingProgress(input);
  }

  const now = new Date().toISOString();
  const existing = await getTrainingProgress(input.training_job_id, input.user_id);

  if (!existing) {
    const record: TrainingProgress = {
      id: createId("progress"),
      created_at: now,
      updated_at: now,
      ...input
    };
    const supabase = createSupabaseAdminClient();
    if (!supabase) {
      memoryStore.trainingProgress.unshift(record);
      return record;
    }

    const { data, error } = await supabase.from("training_progress").insert(record).select("*").single();
    if (error) {
      throw new Error(error.message);
    }

    return data;
  }

  const next = {
    ...input,
    updated_at: now
  };
  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    const index = memoryStore.trainingProgress.findIndex((item) => item.id === existing.id);
    memoryStore.trainingProgress[index] = {
      ...existing,
      ...next
    };
    return memoryStore.trainingProgress[index];
  }

  const { data, error } = await supabase
    .from("training_progress")
    .update(next)
    .eq("id", existing.id)
    .select("*")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data;
}

export async function createTrainingAuditEvent(
  input: Omit<TrainingAuditEvent, "id" | "created_at">
): Promise<TrainingAuditEvent> {
  if (isMySqlDatabase()) {
    return mysqlDb.createTrainingAuditEvent(input);
  }

  const record: TrainingAuditEvent = {
    id: createId("training-audit"),
    created_at: new Date().toISOString(),
    ...input
  };
  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    memoryStore.trainingAuditEvents.unshift(record);
    return record;
  }
  const { data, error } = await supabase.from("training_audit_events").insert(record).select("*").single();
  if (error) throw new Error(error.message);
  return data;
}

export async function listTrainingAuditEvents(trainingJobId?: string): Promise<TrainingAuditEvent[]> {
  if (isMySqlDatabase()) {
    return mysqlDb.listTrainingAuditEvents(trainingJobId);
  }

  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    return memoryStore.trainingAuditEvents.filter((item) => !trainingJobId || item.training_job_id === trainingJobId);
  }
  let query = supabase.from("training_audit_events").select("*").order("created_at", { ascending: false });
  if (trainingJobId) query = query.eq("training_job_id", trainingJobId);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function listTrainingQuizAttempts(trainingJobId: string, userId: string): Promise<TrainingQuizAttempt[]> {
  if (isMySqlDatabase()) {
    return mysqlDb.listTrainingQuizAttempts(trainingJobId, userId);
  }

  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    return memoryStore.trainingQuizAttempts.filter((item) => item.training_job_id === trainingJobId && item.user_id === userId);
  }

  const { data, error } = await supabase
    .from("training_quiz_attempts")
    .select("*")
    .eq("training_job_id", trainingJobId)
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return data ?? [];
}

export async function listAllTrainingQuizAttempts(): Promise<TrainingQuizAttempt[]> {
  if (isMySqlDatabase()) {
    return mysqlDb.listAllTrainingQuizAttempts();
  }

  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    return memoryStore.trainingQuizAttempts;
  }

  const { data, error } = await supabase
    .from("training_quiz_attempts")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return data ?? [];
}

export async function createTrainingQuizAttempt(input: Omit<TrainingQuizAttempt, "id" | "created_at">): Promise<TrainingQuizAttempt> {
  if (isMySqlDatabase()) {
    return mysqlDb.createTrainingQuizAttempt(input);
  }

  const record: TrainingQuizAttempt = {
    id: createId("quiz"),
    created_at: new Date().toISOString(),
    ...input
  };
  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    memoryStore.trainingQuizAttempts.unshift(record);
    return record;
  }

  const { data, error } = await supabase.from("training_quiz_attempts").insert(record).select("*").single();
  if (error) {
    throw new Error(error.message);
  }

  return data;
}

export async function listQaTestMetrics(): Promise<Array<Pick<QaTestCase, "id" | "status" | "created_by" | "created_at" | "updated_at">>> {
  if (isMySqlDatabase()) {
    return mysqlDb.listQaTestMetrics();
  }

  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    return [];
  }

  const { data, error } = await supabase
    .from("qa_test_cases")
    .select("id, status, created_by, created_at, updated_at")
    .order("updated_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as Array<Pick<QaTestCase, "id" | "status" | "created_by" | "created_at" | "updated_at">>;
}

export async function listQaTestCases(options: { compactCitations?: boolean } = {}): Promise<QaTestCase[]> {
  if (isMySqlDatabase()) {
    return mysqlDb.listQaTestCases(options);
  }

  return [];
}

export async function getQaTestCase(id: string): Promise<QaTestCase | null> {
  if (isMySqlDatabase()) {
    return mysqlDb.getQaTestCase(id);
  }

  return null;
}

export async function createQaTestCase(input: {
  question: string;
  expected_answer?: string | null;
  knowledge_base_ids: string[];
  created_by: string | null;
}): Promise<QaTestCase> {
  if (isMySqlDatabase()) {
    return mysqlDb.createQaTestCase(input);
  }

  throw new Error("当前数据库模式暂不支持问答测试记录");
}

export async function updateQaTestCase(
  id: string,
  input: Partial<Pick<QaTestCase, "expected_answer" | "knowledge_base_ids" | "answer" | "citations" | "model" | "status" | "reviewer_note" | "latency_ms">> & {
    question?: string;
  }
): Promise<QaTestCase> {
  if (isMySqlDatabase()) {
    return mysqlDb.updateQaTestCase(id, input);
  }

  throw new Error("当前数据库模式暂不支持问答测试记录");
}
