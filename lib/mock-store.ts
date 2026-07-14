import type {
  Conversation,
  DocumentApprovalEvent,
  DocumentApprovalRequest,
  DocumentChunk,
  DocumentPermissionTemplate,
  DocumentRecord,
  DocumentReviewerAssignment,
  DocumentVersion,
  DocumentVersionChunk,
  Feedback,
  KnowledgeTask,
  KnowledgeBase,
  Message,
  ModelUsageEvent,
  AppNotification,
  SecurityEvent,
  ServiceTicket,
  ServiceTicketComment,
  TrainingJob,
  TrainingAuditEvent,
  TrainingProgress,
  TrainingQuizAttempt,
  TrainingQuizQuestion,
  TrainingExamSession,
  TrainingCertificate,
  TrainingVideoJob,
  UserProfile
} from "@/lib/types";

const now = new Date().toISOString();

export const demoUser: UserProfile = {
  id: "demo-admin",
  email: "admin@example.com",
  name: "演示管理员",
  role: "admin",
  department: "综合管理部",
  position: "系统管理员",
  security_clearance: "restricted",
  status: "active",
  created_at: now
};

type MemoryStore = {
  knowledgeBases: KnowledgeBase[];
  documents: DocumentRecord[];
  documentVersions: DocumentVersion[];
  documentReviewerAssignments: DocumentReviewerAssignment[];
  documentApprovalRequests: DocumentApprovalRequest[];
  documentApprovalEvents: DocumentApprovalEvent[];
  documentPermissionTemplates: DocumentPermissionTemplate[];
  documentChunks: DocumentChunk[];
  documentVersionChunks: DocumentVersionChunk[];
  conversations: Conversation[];
  messages: Message[];
  modelUsageEvents: ModelUsageEvent[];
  feedback: Feedback[];
  knowledgeTasks: KnowledgeTask[];
  serviceTickets: ServiceTicket[];
  serviceTicketComments: ServiceTicketComment[];
  securityEvents: SecurityEvent[];
  notifications: AppNotification[];
  trainingJobs: TrainingJob[];
  trainingVideoJobs: TrainingVideoJob[];
  trainingProgress: TrainingProgress[];
  trainingQuizAttempts: TrainingQuizAttempt[];
  trainingQuizQuestions: TrainingQuizQuestion[];
  trainingExamSessions: TrainingExamSession[];
  trainingCertificates: TrainingCertificate[];
  trainingAuditEvents: TrainingAuditEvent[];
};

declare global {
  // eslint-disable-next-line no-var
  var __enterpriseAiSupportMemoryStore: MemoryStore | undefined;
}

export const memoryStore: MemoryStore = globalThis.__enterpriseAiSupportMemoryStore ?? {
  knowledgeBases: [
    {
      id: "kb-demo",
      name: "企业制度与培训资料",
      description: "演示知识库。配置 OpenAI API 后，可创建真实 vector store。",
      openai_vector_store_id: null,
      visibility: "all",
      departments: [],
      positions: [],
      created_by: demoUser.id,
      created_at: now
    }
  ],
  documents: [],
  documentVersions: [],
  documentReviewerAssignments: [],
  documentApprovalRequests: [],
  documentApprovalEvents: [],
  documentPermissionTemplates: [],
  documentChunks: [],
  documentVersionChunks: [],
  conversations: [
    {
      id: "conv-demo",
      user_id: demoUser.id,
      title: "新员工常见问题",
      archived_at: null,
      pinned_at: null,
      deleted_at: null,
      created_at: now,
      updated_at: now
    }
  ],
  messages: [
    {
      id: "msg-demo-assistant",
      conversation_id: "conv-demo",
      role: "assistant",
      content:
        "你好，我是企业智能客服。上传公司制度、培训手册或产品资料后，我可以基于知识库回答问题，并尽量给出来源引用。",
      citations: [],
      model: null,
      created_at: now
    }
  ],
  modelUsageEvents: [],
  feedback: [],
  knowledgeTasks: [],
  serviceTickets: [],
  serviceTicketComments: [],
  securityEvents: [],
  notifications: [],
  trainingJobs: [],
  trainingVideoJobs: [],
  trainingProgress: [],
  trainingQuizAttempts: [],
  trainingQuizQuestions: [],
  trainingExamSessions: [],
  trainingCertificates: [],
  trainingAuditEvents: []
};

globalThis.__enterpriseAiSupportMemoryStore = memoryStore;

export function createId(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}
