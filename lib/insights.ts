import {
  countAllMessages,
  listAllConversations,
  listConversationMessageStats,
  listFeedback,
  listKnowledgeBases,
  listKnowledgeTasks,
  listModelUsageEvents,
  listRecentMessages,
  listSecurityEvents,
  listServiceTicketComments,
  listServiceTickets,
  listUsers
} from "@/lib/db";
import { isTicketClosedStatus } from "@/lib/service-ticket-rules";
import type {
  Citation,
  Conversation,
  ConversationMessageStats,
  Feedback,
  KnowledgeBase,
  KnowledgeTask,
  Message,
  ModelUsageEvent,
  ModelUsageSource,
  SecurityEvent,
  ServiceTicket,
  ServiceTicketComment,
  UserProfile,
  WorkStatus
} from "@/lib/types";
import { getQaStrategyAnomalySchedule, type QaStrategyAnomalySchedule } from "@/lib/qa-strategy-anomaly-schedule";

export type ConversationInsight = Conversation & {
  user: Pick<UserProfile, "id" | "email" | "name" | "department"> | null;
  message_count: number;
  last_message_at: string | null;
  feedback_count: number;
  dislikes: number;
  has_unreferenced_answer: boolean;
  messages: Message[];
};

export type FeedbackInsight = Feedback & {
  message: Message | null;
  conversation: Conversation | null;
  user: Pick<UserProfile, "id" | "email" | "name" | "department"> | null;
  question: string | null;
  task_id: string | null;
  task_status: WorkStatus | null;
};

export type KnowledgeGap = {
  id: string;
  source: "dislike" | "no_citation";
  source_id: string;
  conversation_id: string;
  question: string;
  answer: string;
  user_email: string;
  status: WorkStatus;
  note: string | null;
  task_id: string | null;
  created_at: string;
};

export type QaRemediationTask = KnowledgeTask & {
  qa_test_id: string;
  reason: string;
  missing_keywords: string[];
  suggestion: string;
  expected_answer: string | null;
};

export type ServiceTicketInsight = ServiceTicket & {
  user: Pick<UserProfile, "id" | "email" | "name" | "department"> | null;
  assignee: Pick<UserProfile, "id" | "email" | "name" | "department"> | null;
  conversation: Conversation | null;
  message: Message | null;
  comments: ServiceTicketComment[];
  overdue: boolean;
};

export type SecurityEventInsight = SecurityEvent & {
  user: Pick<UserProfile, "id" | "email" | "name" | "department"> | null;
  conversation: Conversation | null;
  message: Message | null;
};

export type ModelUsageInsight = ModelUsageEvent & {
  user: Pick<UserProfile, "id" | "email" | "name" | "department"> | null;
  conversation: Conversation | null;
  source_label: string;
};

export type ModelUsageAggregate = {
  key: string;
  label: string;
  events: number;
  total_tokens: number;
  input_tokens: number;
  output_tokens: number;
  estimated_events: number;
  cost_usd: number | null;
};

export type ModelUsageSummary = {
  total_events: number;
  total_tokens: number;
  input_tokens: number;
  output_tokens: number;
  estimated_events: number;
  cost_usd: number | null;
  today_tokens: number;
  today_cost_usd: number | null;
  seven_day_tokens: number;
  seven_day_cost_usd: number | null;
  by_source: ModelUsageAggregate[];
  by_user: ModelUsageAggregate[];
  recent: ModelUsageInsight[];
};

export type PopularQuestionInsight = {
  id: string;
  question: string;
  normalized_question: string;
  count: number;
  user_count: number;
  conversation_count: number;
  departments: string[];
  first_asked_at: string;
  last_asked_at: string;
  latest_conversation_id: string;
  latest_user_email: string;
  latest_answer: string | null;
  no_citation_answers: number;
  disliked_answers: number;
};

export type OperationAlert = {
  id: string;
  category: "qa_strategy_anomaly" | "qa_strategy_anomaly_error";
  severity: "info" | "warning" | "critical";
  title: string;
  detail: string;
  action_label: string;
  href: string;
  created_at: string;
  metrics: Array<{
    label: string;
    value: number | string;
  }>;
};

export type AdminInsights = {
  totals: {
    conversations: number;
    messages: number;
    feedback: number;
    tickets: number;
    pendingTickets: number;
    overdueTickets: number;
    securityEvents: number;
    openSecurityEvents: number;
    highRiskSecurityEvents: number;
    criticalSecurityEvents: number;
    likes: number;
    dislikes: number;
    unreferencedAnswers: number;
    knowledgeGaps: number;
    qaRemediationTasks: number;
    pendingWork: number;
    resolvedWork: number;
    modelUsageEvents: number;
    modelTokens: number;
    estimatedModelUsageEvents: number;
    modelCostUsd: number | null;
    popularQuestions: number;
    operationAlerts: number;
  };
  conversations: ConversationInsight[];
  feedback: FeedbackInsight[];
  tickets: ServiceTicketInsight[];
  securityEvents: SecurityEventInsight[];
  securityAlerts: SecurityEventInsight[];
  operationAlerts: OperationAlert[];
  tasks: KnowledgeTask[];
  knowledgeBases: KnowledgeBase[];
  users: Array<Pick<UserProfile, "id" | "email" | "name" | "department" | "role">>;
  qaRemediationTasks: QaRemediationTask[];
  knowledgeGaps: KnowledgeGap[];
  modelUsage: ModelUsageSummary;
  popularQuestions: PopularQuestionInsight[];
};

function byId<T extends { id: string }>(items: T[]) {
  return new Map(items.map((item) => [item.id, item]));
}

function buildOperationAlerts(input: {
  qaStrategyAnomalySchedule: QaStrategyAnomalySchedule | null;
  openQaRemediationTasks: number;
}): OperationAlert[] {
  const alerts: OperationAlert[] = [];
  const schedule = input.qaStrategyAnomalySchedule;

  if (!schedule) {
    return alerts;
  }

  if (schedule.last_error) {
    alerts.push({
      id: "qa-strategy-anomaly-error",
      category: "qa_strategy_anomaly_error",
      severity: "critical",
      title: "QA 策略异常巡检失败",
      detail: `最近一次巡检失败：${schedule.last_error}`,
      action_label: "查看巡检计划",
      href: "/admin/qa-tests",
      created_at: schedule.updated_at,
      metrics: [
        { label: "巡检次数", value: schedule.run_count },
        { label: "待处理 QA 整改", value: input.openQaRemediationTasks }
      ]
    });
  }

  const result = schedule.last_result;
  if (result && (result.candidate_count > 0 || result.created_count > 0)) {
    alerts.push({
      id: "qa-strategy-anomaly-latest",
      category: "qa_strategy_anomaly",
      severity: result.created_count > 0 ? "critical" : "warning",
      title: "QA 策略异常需要跟进",
      detail: `最近巡检发现 ${result.candidate_count} 条可整改 QA，新增 ${result.created_count} 条整改，跳过 ${result.skipped_count} 条已有任务。`,
      action_label: "处理 QA 整改",
      href: "/admin/insights?tab=qa",
      created_at: result.finished_at,
      metrics: [
        { label: "候选", value: result.candidate_count },
        { label: "新增", value: result.created_count },
        { label: "跳过", value: result.skipped_count },
        { label: "待处理 QA 整改", value: input.openQaRemediationTasks }
      ]
    });
  }

  return alerts
    .sort((a, b) => severityOrder(a.severity) - severityOrder(b.severity) || new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 3);
}

function severityOrder(value: OperationAlert["severity"]) {
  if (value === "critical") {
    return 0;
  }
  if (value === "warning") {
    return 1;
  }
  return 2;
}

function citationsCount(citations: Citation[] | null | undefined) {
  return Array.isArray(citations) ? citations.length : 0;
}

function previousUserQuestion(messages: Message[], assistantMessage: Message) {
  const assistantIndex = messages.findIndex((message) => message.id === assistantMessage.id);

  for (let index = assistantIndex - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") {
      return messages[index].content;
    }
  }

  return "未找到对应问题";
}

export async function getAdminInsights(): Promise<AdminInsights> {
  const [conversations, users, knowledgeBases, qaStrategyAnomalySchedule] = await Promise.all([
    withInsightFallback(listAllConversations(), [] as Conversation[], 2500, "conversations"),
    withInsightFallback(listUsers(), [] as UserProfile[], 2500, "users"),
    withInsightFallback(listKnowledgeBases(), [] as KnowledgeBase[], 2500, "knowledge bases"),
    withInsightFallback(getQaStrategyAnomalySchedule(), null as QaStrategyAnomalySchedule | null, 1500, "qa strategy anomaly schedule")
  ]);
  const [messages, messageTotal, messageStats, feedback] = await Promise.all([
    withInsightFallback(listRecentMessages(1200), [] as Message[], 6000, "recent messages"),
    withInsightFallback(countAllMessages(), 0, 3000, "message count"),
    withInsightFallback(listConversationMessageStats(), [] as ConversationMessageStats[], 6000, "message stats"),
    withInsightFallback(listFeedback(), [] as Feedback[], 2500, "feedback"),
  ]);
  const [tasks, tickets, ticketComments] = await Promise.all([
    withInsightFallback(listKnowledgeTasks(), [] as KnowledgeTask[], 2500, "knowledge tasks"),
    withInsightFallback(listServiceTickets(), [] as ServiceTicket[], 2500, "service tickets"),
    withInsightFallback(listServiceTicketComments(), [] as ServiceTicketComment[], 2500, "ticket comments")
  ]);
  const [securityEvents, modelUsageEvents] = await Promise.all([
    withInsightFallback(listSecurityEvents(), [] as SecurityEvent[], 2500, "security events"),
    withInsightFallback(listModelUsageEvents(1000), [] as ModelUsageEvent[], 3000, "model usage")
  ]);
  const usersById = byId(users);
  const messagesByConversation = new Map<string, Message[]>();

  for (const message of messages) {
    const list = messagesByConversation.get(message.conversation_id) ?? [];
    list.push(message);
    messagesByConversation.set(message.conversation_id, list);
  }

  for (const [conversationId, conversationMessages] of messagesByConversation) {
    messagesByConversation.set(
      conversationId,
      [...conversationMessages].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
    );
  }

  const messagesById = byId(messages);
  const conversationsById = byId(conversations);
  const messageStatsByConversation = new Map(messageStats.map((item) => [item.conversation_id, item]));
  const tasksBySource = new Map(tasks.map((task) => [`${task.source}:${task.source_id ?? task.id}`, task]));
  const feedbackByMessage = new Map<string, Feedback[]>();
  const ticketCommentsByTicketId = new Map<string, ServiceTicketComment[]>();

  for (const item of feedback) {
    const list = feedbackByMessage.get(item.message_id) ?? [];
    list.push(item);
    feedbackByMessage.set(item.message_id, list);
  }

  const popularQuestions = buildPopularQuestions({
    conversationsById,
    feedbackByMessage,
    messagesByConversation,
    usersById
  });

  for (const comment of ticketComments) {
    const list = ticketCommentsByTicketId.get(comment.ticket_id) ?? [];
    list.push(comment);
    ticketCommentsByTicketId.set(comment.ticket_id, list);
  }

  const conversationInsights = conversations.map((conversation) => {
    const conversationMessages = messagesByConversation.get(conversation.id) ?? [];
    const stats = messageStatsByConversation.get(conversation.id);
    const relatedFeedback = conversationMessages.flatMap((message) => feedbackByMessage.get(message.id) ?? []);
    const assistantMessages = conversationMessages.filter((message) => message.role === "assistant");

    return {
      ...conversation,
      user: usersById.get(conversation.user_id) ?? null,
      message_count: stats?.message_count ?? conversationMessages.length,
      last_message_at: stats?.last_message_at ?? conversationMessages.at(-1)?.created_at ?? conversation.updated_at,
      feedback_count: relatedFeedback.length,
      dislikes: relatedFeedback.filter((item) => item.rating === "dislike").length,
      has_unreferenced_answer:
        (stats?.unreferenced_assistant_count ?? 0) > 0 ||
        assistantMessages.some((message) => citationsCount(message.citations) === 0),
      messages: conversationMessages
    };
  });

  const feedbackInsights = feedback.map((item) => {
    const message = messagesById.get(item.message_id) ?? null;
    const conversation = message ? conversationsById.get(message.conversation_id) ?? null : null;
    const conversationMessages = conversation ? messagesByConversation.get(conversation.id) ?? [] : [];
    const task = tasksBySource.get(`feedback:${item.id}`) ?? null;

    return {
      ...item,
      message,
      conversation,
      user: usersById.get(item.user_id) ?? null,
      question: message && message.role === "assistant" ? previousUserQuestion(conversationMessages, message) : null,
      task_id: task?.id ?? null,
      task_status: task?.status ?? null
    };
  });

  const now = Date.now();
  const ticketInsights = tickets.map((ticket) => ({
    ...ticket,
    user: usersById.get(ticket.user_id) ?? null,
    assignee: ticket.assignee_id ? usersById.get(ticket.assignee_id) ?? null : null,
    conversation: conversationsById.get(ticket.conversation_id) ?? null,
    message: ticket.message_id ? messagesById.get(ticket.message_id) ?? null : null,
    comments: ticketCommentsByTicketId.get(ticket.id) ?? [],
    overdue: Boolean(ticket.due_at && !isTicketClosedStatus(ticket.status) && new Date(ticket.due_at).getTime() < now)
  }));
  const securityEventInsights = securityEvents.map((event) => ({
    ...event,
    user: event.user_id ? usersById.get(event.user_id) ?? null : null,
    conversation: event.conversation_id ? conversationsById.get(event.conversation_id) ?? null : null,
    message: event.message_id ? messagesById.get(event.message_id) ?? null : null
  }));
  const openSecurityEvents = securityEventInsights.filter((item) => item.status === "pending" || item.status === "processing");
  const securityAlerts = openSecurityEvents
    .filter((item) => item.severity === "high" || item.severity === "critical")
    .sort((a, b) => {
      const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 } as const;
      const severityDelta = severityOrder[a.severity] - severityOrder[b.severity];
      return severityDelta || new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
  const modelUsageInsights = modelUsageEvents.map((event) => ({
    ...event,
    user: event.user_id ? usersById.get(event.user_id) ?? null : null,
    conversation: event.conversation_id ? conversationsById.get(event.conversation_id) ?? null : null,
    source_label: modelUsageSourceLabel(event.source)
  }));
  const modelUsage = buildModelUsageSummary(modelUsageInsights);

  const gapsFromDislikes = feedbackInsights
    .filter((item) => item.rating === "dislike" && item.message?.role === "assistant" && item.conversation)
    .map((item) => {
      const conversationMessages = item.conversation ? messagesByConversation.get(item.conversation.id) ?? [] : [];

      return {
        id: `gap-${item.id}`,
        source: "dislike" as const,
        source_id: item.id,
        conversation_id: item.conversation?.id ?? "",
        question: item.message ? previousUserQuestion(conversationMessages, item.message) : "未找到对应问题",
        answer: item.message?.content ?? "",
        user_email: item.user?.email ?? "未知用户",
        status: item.status,
        note: item.resolution_note,
        task_id: tasksBySource.get(`feedback:${item.id}`)?.id ?? null,
        created_at: item.created_at
      };
    });

  const gapsFromNoCitation = conversationInsights.flatMap((conversation) =>
    conversation.messages
      .filter((message) => message.role === "assistant" && citationsCount(message.citations) === 0)
      .slice(-3)
      .map((message) => ({
        id: `gap-${message.id}`,
        source: "no_citation" as const,
        source_id: message.id,
        conversation_id: conversation.id,
        question: previousUserQuestion(conversation.messages, message),
        answer: message.content,
        user_email: conversation.user?.email ?? "未知用户",
        status: tasksBySource.get(`no_citation:${message.id}`)?.status ?? "pending",
        note: tasksBySource.get(`no_citation:${message.id}`)?.note ?? null,
        task_id: tasksBySource.get(`no_citation:${message.id}`)?.id ?? null,
        created_at: message.created_at
      }))
  );

  const knowledgeGaps = [...gapsFromDislikes, ...gapsFromNoCitation]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 30);
  const qaRemediationTasks = tasks
    .filter((task) => task.source === "manual" && task.source_id?.startsWith("qa:"))
    .map(toQaRemediationTask)
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
    .slice(0, 80);
  const operationAlerts = buildOperationAlerts({
    qaStrategyAnomalySchedule,
    openQaRemediationTasks: qaRemediationTasks.filter((task) => task.status === "pending" || task.status === "processing").length
  });
  const likes = feedback.filter((item) => item.rating === "like").length;
  const dislikes = feedback.filter((item) => item.rating === "dislike").length;
  const pendingWork =
    feedback.filter((item) => item.status === "pending" || item.status === "processing").length +
    tasks.filter((item) => item.status === "pending" || item.status === "processing").length +
    tickets.filter((item) => item.status === "pending" || item.status === "processing").length +
    openSecurityEvents.length;
  const resolvedWork =
    feedback.filter((item) => item.status === "resolved" || item.status === "ignored").length +
    tasks.filter((item) => item.status === "resolved" || item.status === "ignored").length +
    tickets.filter((item) => item.status === "resolved" || item.status === "ignored").length +
    securityEvents.filter((item) => item.status === "resolved" || item.status === "ignored").length;

  return {
    totals: {
      conversations: conversations.length,
      messages: messageTotal || messages.length,
      feedback: feedback.length,
      tickets: tickets.length,
      pendingTickets: tickets.filter((item) => item.status === "pending" || item.status === "processing").length,
      overdueTickets: ticketInsights.filter((item) => item.overdue).length,
      securityEvents: securityEvents.length,
      openSecurityEvents: openSecurityEvents.length,
      highRiskSecurityEvents: securityAlerts.filter((item) => item.severity === "high").length,
      criticalSecurityEvents: securityAlerts.filter((item) => item.severity === "critical").length,
      likes,
      dislikes,
      unreferencedAnswers: messageStats.reduce((sum, item) => sum + item.unreferenced_assistant_count, 0) ||
        messages.filter((message) => message.role === "assistant" && citationsCount(message.citations) === 0).length,
      knowledgeGaps: knowledgeGaps.length,
      qaRemediationTasks: qaRemediationTasks.length,
      pendingWork,
      resolvedWork,
      modelUsageEvents: modelUsage.total_events,
      modelTokens: modelUsage.total_tokens,
      estimatedModelUsageEvents: modelUsage.estimated_events,
      modelCostUsd: modelUsage.cost_usd,
      popularQuestions: popularQuestions.length,
      operationAlerts: operationAlerts.length
    },
    conversations: conversationInsights
      .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
      .slice(0, 50),
    feedback: feedbackInsights.slice(0, 50),
    tickets: ticketInsights.slice(0, 80),
    securityEvents: securityEventInsights.slice(0, 80),
    securityAlerts: securityAlerts.slice(0, 5),
    operationAlerts,
    tasks: tasks.slice(0, 50),
    knowledgeBases,
    users: users.map((user) => ({
      id: user.id,
      email: user.email,
      name: user.name,
      department: user.department,
      role: user.role
    })),
    qaRemediationTasks,
    knowledgeGaps,
    modelUsage,
    popularQuestions
  };
}

function buildPopularQuestions(input: {
  conversationsById: Map<string, Conversation>;
  feedbackByMessage: Map<string, Feedback[]>;
  messagesByConversation: Map<string, Message[]>;
  usersById: Map<string, UserProfile>;
}): PopularQuestionInsight[] {
  const groups = new Map<string, {
    question: string;
    normalized_question: string;
    count: number;
    userIds: Set<string>;
    conversationIds: Set<string>;
    departments: Set<string>;
    firstAskedAt: string;
    lastAskedAt: string;
    latestConversationId: string;
    latestUserEmail: string;
    latestAnswer: string | null;
    noCitationAnswers: number;
    dislikedAnswers: number;
  }>();

  for (const [conversationId, messages] of input.messagesByConversation) {
    const conversation = input.conversationsById.get(conversationId);
    const user = conversation ? input.usersById.get(conversation.user_id) ?? null : null;

    for (let index = 0; index < messages.length; index += 1) {
      const message = messages[index];
      if (message.role !== "user") {
        continue;
      }

      const normalizedQuestion = normalizeQuestionForStats(message.content);
      if (!normalizedQuestion) {
        continue;
      }

      const answer = findNextAssistantMessage(messages, index);
      const existing = groups.get(normalizedQuestion) ?? {
        question: message.content.trim(),
        normalized_question: normalizedQuestion,
        count: 0,
        userIds: new Set<string>(),
        conversationIds: new Set<string>(),
        departments: new Set<string>(),
        firstAskedAt: message.created_at,
        lastAskedAt: message.created_at,
        latestConversationId: conversationId,
        latestUserEmail: user?.email ?? "未知用户",
        latestAnswer: answer?.content ?? null,
        noCitationAnswers: 0,
        dislikedAnswers: 0
      };

      existing.count += 1;
      if (conversation) {
        existing.userIds.add(conversation.user_id);
      }
      existing.conversationIds.add(conversationId);
      if (user?.department) {
        existing.departments.add(user.department);
      }

      if (new Date(message.created_at).getTime() < new Date(existing.firstAskedAt).getTime()) {
        existing.firstAskedAt = message.created_at;
      }

      if (new Date(message.created_at).getTime() >= new Date(existing.lastAskedAt).getTime()) {
        existing.question = message.content.trim();
        existing.lastAskedAt = message.created_at;
        existing.latestConversationId = conversationId;
        existing.latestUserEmail = user?.email ?? "未知用户";
        existing.latestAnswer = answer?.content ?? null;
      }

      if (answer && citationsCount(answer.citations) === 0) {
        existing.noCitationAnswers += 1;
      }

      if (answer && (input.feedbackByMessage.get(answer.id) ?? []).some((item) => item.rating === "dislike")) {
        existing.dislikedAnswers += 1;
      }

      groups.set(normalizedQuestion, existing);
    }
  }

  return [...groups.values()]
    .map((item) => ({
      id: `popular-${stableQuestionId(item.normalized_question)}`,
      question: item.question,
      normalized_question: item.normalized_question,
      count: item.count,
      user_count: item.userIds.size,
      conversation_count: item.conversationIds.size,
      departments: [...item.departments].slice(0, 6),
      first_asked_at: item.firstAskedAt,
      last_asked_at: item.lastAskedAt,
      latest_conversation_id: item.latestConversationId,
      latest_user_email: item.latestUserEmail,
      latest_answer: item.latestAnswer ? truncateText(item.latestAnswer, 260) : null,
      no_citation_answers: item.noCitationAnswers,
      disliked_answers: item.dislikedAnswers
    }))
    .filter((item) => item.count > 1 || item.no_citation_answers > 0 || item.disliked_answers > 0)
    .sort((a, b) =>
      b.count - a.count ||
      b.no_citation_answers - a.no_citation_answers ||
      b.disliked_answers - a.disliked_answers ||
      new Date(b.last_asked_at).getTime() - new Date(a.last_asked_at).getTime()
    )
    .slice(0, 30);
}

function findNextAssistantMessage(messages: Message[], userMessageIndex: number) {
  for (let index = userMessageIndex + 1; index < messages.length; index += 1) {
    const message = messages[index];
    if (message.role === "assistant") {
      return message;
    }

    if (message.role === "user") {
      return null;
    }
  }

  return null;
}

function normalizeQuestionForStats(value: string) {
  return value
    .toLowerCase()
    .replace(/^(请问|你好|您好|麻烦问下|想问一下|问一下)/, "")
    .replace(/[“”"'`]/g, "")
    .replace(/[，。！？、；：,.!?;:\s]+/g, "")
    .trim()
    .slice(0, 120);
}

function stableQuestionId(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
  }

  return Math.abs(hash).toString(36);
}

function truncateText(value: string, maxLength: number) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 1)}…`;
}

async function withInsightFallback<T>(promise: Promise<T>, fallback: T, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => {
          console.warn(`[admin-insights] ${label} timed out, using fallback`);
          resolve(fallback);
        }, timeoutMs);
      })
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

function buildModelUsageSummary(events: ModelUsageInsight[]): ModelUsageSummary {
  const now = Date.now();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStart = today.getTime();
  const sevenDayStart = now - 7 * 24 * 60 * 60 * 1000;
  const sorted = [...events].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  const bySource = aggregateUsage(
    sorted,
    (event) => event.source,
    (event) => event.source_label
  );
  const byUser = aggregateUsage(
    sorted.filter((event) => event.user_id),
    (event) => event.user_id ?? "unknown",
    (event) => event.user?.email ?? event.user_id ?? "未知用户"
  );
  const todayEvents = sorted.filter((event) => new Date(event.created_at).getTime() >= todayStart);
  const sevenDayEvents = sorted.filter((event) => new Date(event.created_at).getTime() >= sevenDayStart);
  const total = sumUsage(sorted);
  const todayTotal = sumUsage(todayEvents);
  const sevenDayTotal = sumUsage(sevenDayEvents);

  return {
    total_events: sorted.length,
    total_tokens: total.total_tokens,
    input_tokens: total.input_tokens,
    output_tokens: total.output_tokens,
    estimated_events: sorted.filter((event) => event.estimated).length,
    cost_usd: total.cost_usd,
    today_tokens: todayTotal.total_tokens,
    today_cost_usd: todayTotal.cost_usd,
    seven_day_tokens: sevenDayTotal.total_tokens,
    seven_day_cost_usd: sevenDayTotal.cost_usd,
    by_source: bySource,
    by_user: byUser,
    recent: sorted.slice(0, 80)
  };
}

function aggregateUsage(
  events: ModelUsageInsight[],
  keyOf: (event: ModelUsageInsight) => string,
  labelOf: (event: ModelUsageInsight) => string
) {
  const groups = new Map<string, ModelUsageInsight[]>();

  for (const event of events) {
    const key = keyOf(event);
    const group = groups.get(key) ?? [];
    group.push(event);
    groups.set(key, group);
  }

  return [...groups.entries()]
    .map(([key, group]) => {
      const total = sumUsage(group);
      return {
        key,
        label: labelOf(group[0]),
        events: group.length,
        total_tokens: total.total_tokens,
        input_tokens: total.input_tokens,
        output_tokens: total.output_tokens,
        estimated_events: group.filter((event) => event.estimated).length,
        cost_usd: total.cost_usd
      };
    })
    .sort((a, b) => b.total_tokens - a.total_tokens)
    .slice(0, 12);
}

function sumUsage(events: ModelUsageEvent[]) {
  const costValues = events
    .map((event) => event.cost_usd)
    .filter((cost): cost is number => typeof cost === "number" && Number.isFinite(cost));

  return {
    input_tokens: events.reduce((sum, event) => sum + event.input_tokens, 0),
    output_tokens: events.reduce((sum, event) => sum + event.output_tokens, 0),
    total_tokens: events.reduce((sum, event) => sum + event.total_tokens, 0),
    cost_usd: costValues.length > 0 ? Number(costValues.reduce((sum, cost) => sum + cost, 0).toFixed(8)) : null
  };
}

function modelUsageSourceLabel(source: ModelUsageSource) {
  if (source === "qa") {
    return "QA 测试";
  }

  if (source === "training_tts") {
    return "课程语音";
  }

  if (source === "training_video") {
    return "课件视频";
  }

  return "员工对话";
}

function toQaRemediationTask(task: KnowledgeTask): QaRemediationTask {
  const parsed = parseTaskNote(task.note);

  return {
    ...task,
    qa_test_id: task.source_id?.replace(/^qa:/, "") ?? task.conversation_id,
    reason: parsed["原因"] ?? "未记录原因",
    missing_keywords: (parsed["缺失关键词"] ?? "")
      .split(/[、,，]/)
      .map((item) => item.trim())
      .filter(Boolean),
    suggestion: parsed["建议"] ?? "复核知识库资料和期望答案，补充缺失依据后重新运行测试。",
    expected_answer: parsed["期望答案"] ?? null
  };
}

function parseTaskNote(note: string | null) {
  const fields: Record<string, string> = {};

  for (const line of note?.split(/\r?\n/) ?? []) {
    const index = line.indexOf("：");

    if (index === -1) {
      continue;
    }

    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim();

    if (key && value) {
      fields[key] = value;
    }
  }

  return fields;
}
