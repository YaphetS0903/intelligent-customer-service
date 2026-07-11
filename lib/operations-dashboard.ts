import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  listAllConversations,
  listAllTrainingQuizAttempts,
  listDocumentApprovalRequests,
  listDocuments,
  listFeedback,
  listKnowledgeTasks,
  listMessageMetrics,
  listQaTestMetrics,
  listServiceTicketComments,
  listServiceTickets,
  listTrainingJobs,
  listTrainingProgress,
  listUsers
} from "@/lib/db";
import { isMySqlDatabase } from "@/lib/config";
import * as mysqlDb from "@/lib/mysql-db";
import { isTicketClosedStatus } from "@/lib/service-ticket-rules";
import type {
  Conversation,
  DocumentApprovalRequest,
  DocumentRecord,
  Feedback,
  KnowledgeTask,
  Message,
  QaTestCase,
  ServiceTicket,
  ServiceTicketComment,
  TrainingJob,
  TrainingProgress,
  TrainingQuizAttempt,
  UserProfile
} from "@/lib/types";

const SHANGHAI_OFFSET = "+08:00";
const DEFAULT_DAYS = 30;
const MAX_DAYS = 366;

export type OperationsDashboardFilters = {
  from: string;
  to: string;
  from_date: string;
  to_date: string;
  days: number;
  department: string;
  position: string;
};

export type OperationsDashboardReport = {
  generated_at: string;
  data_status: {
    source: "live" | "snapshot";
    updated_at: string;
    warning: string | null;
  };
  filters: OperationsDashboardFilters;
  options: {
    departments: string[];
    positions: string[];
  };
  summary: {
    active_employees: { value: number; eligible: number; rate: number };
    questions: { value: number; conversations: number };
    satisfaction: { positive: number; rated: number; rate: number };
    no_citation: { value: number; answers: number; rate: number };
    qa: { passed: number; tested: number; rate: number };
    knowledge_gaps: { value: number; open: number };
    remediation: { completed: number; total: number; rate: number };
    approvals: { reviewed: number; average_hours: number | null; pending_backlog: number };
    training: {
      participants: number;
      eligible: number;
      participation_rate: number;
      completed: number;
      completion_rate: number;
      quiz_passed: number;
      quiz_attempted: number;
      quiz_pass_rate: number;
    };
    tickets: {
      value: number;
      responded: number;
      average_response_hours: number | null;
      closed: number;
      close_rate: number;
    };
  };
  daily: Array<{
    date: string;
    active_employees: number;
    questions: number;
    answers: number;
    no_citation: number;
    positive_feedback: number;
    rated_feedback: number;
    tickets: number;
  }>;
  departments: Array<{
    department: string;
    eligible_employees: number;
    active_employees: number;
    questions: number;
    satisfaction_rate: number;
    no_citation_rate: number;
    training_completed: number;
    tickets: number;
  }>;
  definitions: Array<{ key: string; label: string; description: string }>;
};

type DashboardData = {
  users: UserProfile[];
  conversations: Conversation[];
  messages: Message[];
  feedback: Feedback[];
  tasks: KnowledgeTask[];
  qaTests: Array<Pick<QaTestCase, "id" | "status" | "created_by" | "created_at" | "updated_at">>;
  approvals: DocumentApprovalRequest[];
  documents: DocumentRecord[];
  trainingJobs: TrainingJob[];
  trainingProgress: TrainingProgress[];
  quizAttempts: TrainingQuizAttempt[];
  tickets: ServiceTicket[];
  ticketComments: ServiceTicketComment[];
};

let dashboardDataCache: { data: DashboardData; expires_at: number } | null = null;
let dashboardDataPromise: Promise<DashboardData> | null = null;
let dashboardDataStatus: OperationsDashboardReport["data_status"] = {
  source: "live",
  updated_at: new Date().toISOString(),
  warning: null
};

export function parseOperationsDashboardFilters(searchParams: URLSearchParams, now = new Date()): OperationsDashboardFilters {
  const requestedDays = Number(searchParams.get("days") ?? DEFAULT_DAYS);
  const days = Number.isFinite(requestedDays) ? Math.min(MAX_DAYS, Math.max(1, Math.round(requestedDays))) : DEFAULT_DAYS;
  const today = shanghaiDateKey(now);
  const defaultTo = dateAtShanghai(today, false);
  const defaultFrom = new Date(defaultTo.getTime() - (days - 1) * 86_400_000);
  let from = parseDateBoundary(searchParams.get("from"), true) ?? startOfShanghaiDay(defaultFrom);
  let to = parseDateBoundary(searchParams.get("to"), false) ?? defaultTo;

  if (from.getTime() > to.getTime()) {
    [from, to] = [startOfShanghaiDay(to), endOfShanghaiDay(from)];
  }

  if (to.getTime() - from.getTime() > (MAX_DAYS - 1) * 86_400_000 + 86_399_999) {
    from = startOfShanghaiDay(new Date(to.getTime() - (MAX_DAYS - 1) * 86_400_000));
  }

  return {
    from: from.toISOString(),
    to: to.toISOString(),
    from_date: shanghaiDateKey(from),
    to_date: shanghaiDateKey(to),
    days: inclusiveDays(from, to),
    department: cleanFilter(searchParams.get("department")),
    position: cleanFilter(searchParams.get("position"))
  };
}

export async function getOperationsDashboardReport(filters: OperationsDashboardFilters): Promise<OperationsDashboardReport> {
  const data = await loadDashboardData();
  return {
    ...buildOperationsDashboardReport(data, filters),
    data_status: dashboardDataStatus
  };
}

export function buildOperationsDashboardReport(data: DashboardData, filters: OperationsDashboardFilters): OperationsDashboardReport {
  const fromMs = new Date(filters.from).getTime();
  const toMs = new Date(filters.to).getTime();
  const inRange = (value: string | null | undefined) => {
    if (!value) return false;
    const time = new Date(value).getTime();
    return Number.isFinite(time) && time >= fromMs && time <= toMs;
  };
  const usersById = new Map(data.users.map((user) => [user.id, user]));
  const conversationsById = new Map(data.conversations.map((conversation) => [conversation.id, conversation]));
  const documentsById = new Map(data.documents.map((document) => [document.id, document]));
  const employees = data.users.filter((user) => user.role === "employee" && user.status === "active");
  const orgMatches = (user: UserProfile | undefined | null) => Boolean(
    user &&
    (!filters.department || user.department === filters.department) &&
    (!filters.position || user.position === filters.position)
  );
  const employeeMatches = (user: UserProfile | undefined | null) => Boolean(
    user &&
    user.role === "employee" &&
    user.status === "active" &&
    orgMatches(user)
  );
  const eligibleEmployees = employees.filter(employeeMatches);
  const eligibleIds = new Set(eligibleEmployees.map((user) => user.id));
  const conversationUserId = (conversationId: string) => conversationsById.get(conversationId)?.user_id ?? null;
  const messageUserId = (message: Message) => conversationUserId(message.conversation_id);

  const scopedMessages = data.messages.filter((message) => {
    const userId = messageUserId(message);
    return Boolean(userId && eligibleIds.has(userId) && inRange(message.created_at));
  });
  const questions = scopedMessages.filter((message) => message.role === "user");
  const answers = scopedMessages.filter((message) => message.role === "assistant");
  const noCitationAnswers = answers.filter((message) => message.citations.length === 0);
  const scopedConversationIds = new Set(scopedMessages.map((message) => message.conversation_id));

  const scopedFeedback = data.feedback.filter((item) => eligibleIds.has(item.user_id) && inRange(item.created_at));
  const positiveFeedback = scopedFeedback.filter((item) => item.rating === "like");
  const scopedTasks = data.tasks.filter((task) => {
    const ownerId = conversationUserId(task.conversation_id) ?? task.created_by;
    return Boolean(ownerId && eligibleIds.has(ownerId) && inRange(task.created_at));
  });
  const gapKeys = new Set<string>();
  for (const answer of noCitationAnswers) gapKeys.add(`no_citation:${answer.id}`);
  for (const item of scopedFeedback.filter((feedback) => feedback.rating === "dislike")) gapKeys.add(`feedback:${item.id}`);
  for (const task of scopedTasks) gapKeys.add(task.source_id ? `${task.source}:${task.source_id}` : `task:${task.id}`);
  const openTaskCount = scopedTasks.filter((task) => task.status === "pending" || task.status === "processing").length;
  const completedTasks = scopedTasks.filter((task) => task.status === "resolved" || task.status === "ignored");

  const scopedQaTests = data.qaTests.filter((test) => {
    if (!inRange(test.updated_at)) return false;
    if (!filters.department && !filters.position) return true;
    return orgMatches(test.created_by ? usersById.get(test.created_by) : null);
  });
  const testedQa = scopedQaTests.filter((test) => test.status === "passed" || test.status === "failed");
  const passedQa = testedQa.filter((test) => test.status === "passed");

  const approvalMatchesScope = (request: DocumentApprovalRequest) => {
    const document = documentsById.get(request.document_id);
    const submitter = usersById.get(request.submitted_by);
    const departmentMatches = !filters.department || document?.department === filters.department || (!document?.department && submitter?.department === filters.department);
    const positionMatches = !filters.position || submitter?.position === filters.position;
    return departmentMatches && positionMatches;
  };
  const scopedApprovals = data.approvals.filter((request) => approvalMatchesScope(request) && inRange(request.submitted_at));
  const reviewedApprovals = scopedApprovals.filter((request) => request.reviewed_at && new Date(request.reviewed_at).getTime() >= new Date(request.submitted_at).getTime());
  const approvalHours = reviewedApprovals.map((request) => (
    new Date(request.reviewed_at as string).getTime() - new Date(request.submitted_at).getTime()
  ) / 3_600_000);
  const pendingBacklog = data.approvals.filter((request) => (
    request.status === "pending" && approvalMatchesScope(request) && new Date(request.submitted_at).getTime() <= toMs
  )).length;

  const publishedTrainingIds = new Set(data.trainingJobs.filter((job) => job.publish_status === "published").map((job) => job.id));
  const scopedProgress = data.trainingProgress.filter((progress) => (
    eligibleIds.has(progress.user_id) && publishedTrainingIds.has(progress.training_job_id) && inRange(progress.updated_at)
  ));
  const participantIds = new Set(scopedProgress.map((progress) => progress.user_id));
  const completedProgress = scopedProgress.filter((progress) => progress.progress_percent >= 100 || Boolean(progress.completed_at));
  const completedParticipantIds = new Set(completedProgress.map((progress) => progress.user_id));
  const scopedQuizAttempts = data.quizAttempts.filter((attempt) => (
    eligibleIds.has(attempt.user_id) && publishedTrainingIds.has(attempt.training_job_id) && inRange(attempt.created_at)
  ));
  const latestQuizByLearnerCourse = new Map<string, TrainingQuizAttempt>();
  for (const attempt of scopedQuizAttempts) {
    const key = `${attempt.user_id}:${attempt.training_job_id}`;
    const previous = latestQuizByLearnerCourse.get(key);
    if (!previous || new Date(attempt.created_at).getTime() > new Date(previous.created_at).getTime()) {
      latestQuizByLearnerCourse.set(key, attempt);
    }
  }
  const quizResults = [...latestQuizByLearnerCourse.values()];
  const passedQuizResults = quizResults.filter((attempt) => attempt.passed);

  const scopedTickets = data.tickets.filter((ticket) => eligibleIds.has(ticket.user_id) && inRange(ticket.created_at));
  const commentsByTicketId = new Map<string, ServiceTicketComment[]>();
  for (const comment of data.ticketComments) {
    const comments = commentsByTicketId.get(comment.ticket_id) ?? [];
    comments.push(comment);
    commentsByTicketId.set(comment.ticket_id, comments);
  }
  const responseHours = scopedTickets.flatMap((ticket) => {
    const firstAdminResponse = (commentsByTicketId.get(ticket.id) ?? [])
      .filter((comment) => comment.author_role === "admin" && new Date(comment.created_at).getTime() >= new Date(ticket.created_at).getTime())
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())[0];
    return firstAdminResponse
      ? [(new Date(firstAdminResponse.created_at).getTime() - new Date(ticket.created_at).getTime()) / 3_600_000]
      : [];
  });
  const closedTickets = scopedTickets.filter((ticket) => isTicketClosedStatus(ticket.status));

  const activeEmployeeIds = new Set<string>();
  for (const message of questions) {
    const userId = messageUserId(message);
    if (userId) activeEmployeeIds.add(userId);
  }
  for (const progress of scopedProgress) activeEmployeeIds.add(progress.user_id);
  for (const attempt of scopedQuizAttempts) activeEmployeeIds.add(attempt.user_id);
  for (const ticket of scopedTickets) activeEmployeeIds.add(ticket.user_id);

  const daily = buildDailyRows(filters);
  const dailyActiveUsers = new Map<string, Set<string>>();
  const dailyByDate = new Map(daily.map((row) => [row.date, row]));
  for (const message of scopedMessages) {
    const row = dailyByDate.get(shanghaiDateKey(new Date(message.created_at)));
    if (!row) continue;
    if (message.role === "user") row.questions += 1;
    if (message.role === "assistant") {
      row.answers += 1;
      if (message.citations.length === 0) row.no_citation += 1;
    }
    const userId = messageUserId(message);
    if (userId) addDailyActive(row.date, userId);
  }
  for (const item of scopedFeedback) {
    const row = dailyByDate.get(shanghaiDateKey(new Date(item.created_at)));
    if (!row) continue;
    row.rated_feedback += 1;
    if (item.rating === "like") row.positive_feedback += 1;
  }
  for (const ticket of scopedTickets) {
    const row = dailyByDate.get(shanghaiDateKey(new Date(ticket.created_at)));
    if (row) row.tickets += 1;
    addDailyActive(shanghaiDateKey(new Date(ticket.created_at)), ticket.user_id);
  }
  for (const progress of scopedProgress) addDailyActive(shanghaiDateKey(new Date(progress.updated_at)), progress.user_id);
  for (const attempt of scopedQuizAttempts) addDailyActive(shanghaiDateKey(new Date(attempt.created_at)), attempt.user_id);
  for (const row of daily) row.active_employees = dailyActiveUsers.get(row.date)?.size ?? 0;

  const departmentNames = unique(employees.map((user) => user.department));
  const departments = departmentNames.map((department) => buildDepartmentRow({
    department,
    employees: eligibleEmployees,
    activeEmployeeIds,
    questions,
    answers,
    scopedFeedback,
    completedProgress,
    scopedTickets,
    conversationsById
  })).filter((row) => !filters.department || row.department === filters.department);

  return {
    generated_at: new Date().toISOString(),
    data_status: dashboardDataStatus,
    filters,
    options: {
      departments: departmentNames,
      positions: unique(employees.map((user) => user.position))
    },
    summary: {
      active_employees: { value: activeEmployeeIds.size, eligible: eligibleEmployees.length, rate: percent(activeEmployeeIds.size, eligibleEmployees.length) },
      questions: { value: questions.length, conversations: scopedConversationIds.size },
      satisfaction: { positive: positiveFeedback.length, rated: scopedFeedback.length, rate: percent(positiveFeedback.length, scopedFeedback.length) },
      no_citation: { value: noCitationAnswers.length, answers: answers.length, rate: percent(noCitationAnswers.length, answers.length) },
      qa: { passed: passedQa.length, tested: testedQa.length, rate: percent(passedQa.length, testedQa.length) },
      knowledge_gaps: { value: gapKeys.size, open: openTaskCount },
      remediation: { completed: completedTasks.length, total: scopedTasks.length, rate: percent(completedTasks.length, scopedTasks.length) },
      approvals: { reviewed: reviewedApprovals.length, average_hours: average(approvalHours), pending_backlog: pendingBacklog },
      training: {
        participants: participantIds.size,
        eligible: eligibleEmployees.length,
        participation_rate: percent(participantIds.size, eligibleEmployees.length),
        completed: completedParticipantIds.size,
        completion_rate: percent(completedParticipantIds.size, participantIds.size),
        quiz_passed: passedQuizResults.length,
        quiz_attempted: quizResults.length,
        quiz_pass_rate: percent(passedQuizResults.length, quizResults.length)
      },
      tickets: {
        value: scopedTickets.length,
        responded: responseHours.length,
        average_response_hours: average(responseHours),
        closed: closedTickets.length,
        close_rate: percent(closedTickets.length, scopedTickets.length)
      }
    },
    daily,
    departments,
    definitions: metricDefinitions
  };

  function addDailyActive(date: string, userId: string) {
    const users = dailyActiveUsers.get(date) ?? new Set<string>();
    users.add(userId);
    dailyActiveUsers.set(date, users);
  }
}

async function loadDashboardData(): Promise<DashboardData> {
  if (dashboardDataCache && dashboardDataCache.expires_at > Date.now()) {
    return dashboardDataCache.data;
  }
  if (dashboardDataPromise) {
    return dashboardDataPromise;
  }

  dashboardDataPromise = (async () => {
    if (isMySqlDatabase()) {
      const snapshot = await readDashboardSnapshot();
      const livePromise = mysqlDb.listOperationsDashboardData().then(async (data) => {
        const savedAt = new Date().toISOString();
        dashboardDataStatus = { source: "live", updated_at: savedAt, warning: null };
        dashboardDataCache = { data, expires_at: Date.now() + 60_000 };
        await persistDashboardSnapshot(data, savedAt).catch((error) => {
          console.warn("[operations-dashboard] failed to persist snapshot", error);
        });
        return data;
      });

      if (!snapshot) {
        return livePromise;
      }

      try {
        return await Promise.race([
          livePromise,
          new Promise<DashboardData>((_, reject) => {
            setTimeout(() => reject(new Error("实时数据读取超过 8 秒")), 8_000);
          })
        ]);
      } catch (error) {
        dashboardDataStatus = {
          source: "snapshot",
          updated_at: snapshot.saved_at,
          warning: `数据库连接暂时不可用，当前展示最近一次成功快照。${error instanceof Error ? ` ${error.message}` : ""}`.trim()
        };
        dashboardDataCache = { data: snapshot.data, expires_at: Date.now() + 30_000 };
        void livePromise.catch((liveError) => {
          console.warn("[operations-dashboard] background refresh failed", liveError);
        });
        return snapshot.data;
      }
    }

    // The production database is remote. Keeping these lightweight reads serial
    // avoids exhausting the small pool and makes cold dashboard loads predictable.
    const users = await listUsers();
    const conversations = await listAllConversations();
    const messages = await listMessageMetrics();
    const feedback = await listFeedback();
    const tasks = await listKnowledgeTasks();
    const qaTests = await listQaTestMetrics();
    const approvals = await listDocumentApprovalRequests();
    const documents = await listDocuments();
    const trainingJobs = await listTrainingJobs();
    const trainingProgress = await listTrainingProgress();
    const quizAttempts = await listAllTrainingQuizAttempts();
    const tickets = await listServiceTickets();
    const ticketComments = await listServiceTicketComments();
    const data = { users, conversations, messages, feedback, tasks, qaTests, approvals, documents, trainingJobs, trainingProgress, quizAttempts, tickets, ticketComments };
    dashboardDataCache = { data, expires_at: Date.now() + 60_000 };
    return data;
  })();

  try {
    return await dashboardDataPromise;
  } finally {
    dashboardDataPromise = null;
  }
}

async function persistDashboardSnapshot(data: DashboardData, savedAt: string) {
  const target = dashboardSnapshotFile();
  const temporary = `${target}.tmp`;
  await mkdir(dirname(target), { recursive: true });
  await writeFile(temporary, JSON.stringify({ saved_at: savedAt, data }), { mode: 0o600 });
  await rename(temporary, target);
}

async function readDashboardSnapshot(): Promise<{ saved_at: string; data: DashboardData } | null> {
  try {
    const parsed = JSON.parse(await readFile(dashboardSnapshotFile(), "utf8")) as { saved_at?: unknown; data?: DashboardData };
    if (typeof parsed.saved_at !== "string" || !parsed.data) return null;
    return { saved_at: parsed.saved_at, data: parsed.data };
  } catch {
    return null;
  }
}

function dashboardSnapshotFile() {
  return resolve(process.env.OPERATIONS_DASHBOARD_SNAPSHOT_FILE ?? ".ops/operations-dashboard-data.json");
}

function buildDailyRows(filters: OperationsDashboardFilters): OperationsDashboardReport["daily"] {
  const rows: OperationsDashboardReport["daily"] = [];
  let cursor = startOfShanghaiDay(new Date(filters.from));
  const end = new Date(filters.to).getTime();
  while (cursor.getTime() <= end && rows.length < MAX_DAYS) {
    rows.push({ date: shanghaiDateKey(cursor), active_employees: 0, questions: 0, answers: 0, no_citation: 0, positive_feedback: 0, rated_feedback: 0, tickets: 0 });
    cursor = new Date(cursor.getTime() + 86_400_000);
  }
  return rows;
}

function buildDepartmentRow(input: {
  department: string;
  employees: UserProfile[];
  activeEmployeeIds: Set<string>;
  questions: Message[];
  answers: Message[];
  scopedFeedback: Feedback[];
  completedProgress: TrainingProgress[];
  scopedTickets: ServiceTicket[];
  conversationsById: Map<string, Conversation>;
}): OperationsDashboardReport["departments"][number] {
  const departmentUserIds = new Set(input.employees.filter((user) => user.department === input.department).map((user) => user.id));
  const ownerId = (message: Message) => input.conversationsById.get(message.conversation_id)?.user_id ?? null;
  const answers = input.answers.filter((message) => departmentUserIds.has(ownerId(message) ?? ""));
  const feedback = input.scopedFeedback.filter((item) => departmentUserIds.has(item.user_id));
  return {
    department: input.department,
    eligible_employees: departmentUserIds.size,
    active_employees: [...input.activeEmployeeIds].filter((id) => departmentUserIds.has(id)).length,
    questions: input.questions.filter((message) => departmentUserIds.has(ownerId(message) ?? "")).length,
    satisfaction_rate: percent(feedback.filter((item) => item.rating === "like").length, feedback.length),
    no_citation_rate: percent(answers.filter((message) => message.citations.length === 0).length, answers.length),
    training_completed: new Set(input.completedProgress.filter((progress) => departmentUserIds.has(progress.user_id)).map((progress) => progress.user_id)).size,
    tickets: input.scopedTickets.filter((ticket) => departmentUserIds.has(ticket.user_id)).length
  };
}

export function operationsDashboardCsv(report: OperationsDashboardReport) {
  const rows: string[][] = [["范围", "维度", "名称", "指标", "数值", "单位", "说明"]];
  const range = `${report.filters.from_date} 至 ${report.filters.to_date}`;
  const add = (dimension: string, name: string, metric: string, value: string | number, unit: string, note = "") => rows.push([range, dimension, name, metric, String(value), unit, note]);
  const summary = report.summary;
  add("汇总", "员工", "活跃员工", summary.active_employees.value, "人", `符合筛选员工 ${summary.active_employees.eligible} 人`);
  add("汇总", "问答", "问答量", summary.questions.value, "次", `涉及 ${summary.questions.conversations} 个会话`);
  add("汇总", "问答", "满意度", summary.satisfaction.rate, "%", `${summary.satisfaction.positive}/${summary.satisfaction.rated}`);
  add("汇总", "问答", "无引用率", summary.no_citation.rate, "%", `${summary.no_citation.value}/${summary.no_citation.answers}`);
  add("汇总", "质量", "QA 通过率", summary.qa.rate, "%", `${summary.qa.passed}/${summary.qa.tested}`);
  add("汇总", "质量", "知识缺口", summary.knowledge_gaps.value, "项", `待处理任务 ${summary.knowledge_gaps.open} 项`);
  add("汇总", "质量", "整改完成率", summary.remediation.rate, "%", `${summary.remediation.completed}/${summary.remediation.total}`);
  add("汇总", "审批", "平均审批耗时", summary.approvals.average_hours ?? "-", "小时", `已审批 ${summary.approvals.reviewed} 项`);
  add("汇总", "审批", "待审批积压", summary.approvals.pending_backlog, "项", "截至筛选结束日期");
  add("汇总", "培训", "参与率", summary.training.participation_rate, "%", `${summary.training.participants}/${summary.training.eligible}`);
  add("汇总", "培训", "完课率", summary.training.completion_rate, "%", `${summary.training.completed}/${summary.training.participants}`);
  add("汇总", "培训", "测验通过率", summary.training.quiz_pass_rate, "%", `${summary.training.quiz_passed}/${summary.training.quiz_attempted}`);
  add("汇总", "工单", "工单数量", summary.tickets.value, "单");
  add("汇总", "工单", "平均响应时间", summary.tickets.average_response_hours ?? "-", "小时", `已响应 ${summary.tickets.responded} 单`);
  add("汇总", "工单", "关闭率", summary.tickets.close_rate, "%", `${summary.tickets.closed}/${summary.tickets.value}`);
  for (const day of report.daily) {
    add("每日", day.date, "活跃员工", day.active_employees, "人");
    add("每日", day.date, "问答量", day.questions, "次");
    add("每日", day.date, "无引用回答", day.no_citation, "次", `回答 ${day.answers} 次`);
    add("每日", day.date, "工单", day.tickets, "单");
  }
  for (const department of report.departments) {
    add("部门", department.department, "活跃员工", department.active_employees, "人", `符合筛选员工 ${department.eligible_employees} 人`);
    add("部门", department.department, "问答量", department.questions, "次");
    add("部门", department.department, "满意度", department.satisfaction_rate, "%");
    add("部门", department.department, "无引用率", department.no_citation_rate, "%");
    add("部门", department.department, "完课人数", department.training_completed, "人");
    add("部门", department.department, "工单", department.tickets, "单");
  }
  return `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\n")}`;
}

const metricDefinitions = [
  { key: "active_employees", label: "活跃员工", description: "筛选期内发生提问、培训学习、测验或工单行为的去重在职员工。" },
  { key: "satisfaction", label: "满意度", description: "点赞数 / 已评价回答数；没有评价时显示 0%。" },
  { key: "no_citation", label: "无引用率", description: "没有知识库引用的回答数 / 全部回答数，作为无答案风险口径。" },
  { key: "qa", label: "QA 通过率", description: "已通过测试数 / 已执行测试数，未测试用例不进入分母。" },
  { key: "remediation", label: "整改完成率", description: "已解决或已忽略的知识整改任务 / 筛选期内知识整改任务。" },
  { key: "approvals", label: "审批耗时", description: "审批完成时间减提交时间；待审批积压统计截至筛选结束日期仍待处理的申请。" },
  { key: "training", label: "培训指标", description: "参与率以符合筛选的在职员工为分母，完课率以参与员工为分母，测验按员工课程的最新一次作答统计。" },
  { key: "tickets", label: "工单响应", description: "响应时间取工单创建到首条管理员回复；关闭率按已解决或已忽略统计。" }
];

function percent(numerator: number, denominator: number) {
  return denominator > 0 ? round((numerator / denominator) * 100, 1) : 0;
}

function average(values: number[]) {
  if (values.length === 0) return null;
  return round(values.reduce((sum, value) => sum + value, 0) / values.length, 2);
}

function round(value: number, digits: number) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function unique(values: Array<string | null | undefined>) {
  return [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))].sort((a, b) => a.localeCompare(b, "zh-CN"));
}

function cleanFilter(value: string | null) {
  const clean = value?.trim() ?? "";
  return clean === "all" ? "" : clean.slice(0, 80);
}

function parseDateBoundary(value: string | null, start: boolean) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = dateAtShanghai(value, start);
  return Number.isFinite(date.getTime()) ? date : null;
}

function dateAtShanghai(date: string, start: boolean) {
  return new Date(`${date}T${start ? "00:00:00.000" : "23:59:59.999"}${SHANGHAI_OFFSET}`);
}

function startOfShanghaiDay(date: Date) {
  return dateAtShanghai(shanghaiDateKey(date), true);
}

function endOfShanghaiDay(date: Date) {
  return dateAtShanghai(shanghaiDateKey(date), false);
}

function shanghaiDateKey(date: Date) {
  const parts = new Intl.DateTimeFormat("en", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function inclusiveDays(from: Date, to: Date) {
  return Math.min(MAX_DAYS, Math.max(1, Math.round((startOfShanghaiDay(to).getTime() - startOfShanghaiDay(from).getTime()) / 86_400_000) + 1));
}

function csvCell(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}
