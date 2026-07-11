import { env, isLocalTextRag, isMySqlDatabase } from "@/lib/config";
import {
  listDocumentChunkMetadata,
  listDocuments,
  listFeedback,
  listKnowledgeBases,
  listQaTestCases,
  listTrainingJobs,
  listUsers
} from "@/lib/db";
import { loadPilotReadinessSnapshot, setPilotReadinessSnapshot } from "@/lib/pilot-readiness-cache";
import { loadTrainingListSnapshot } from "@/lib/training-list-cache";
import { mysqlBatchQuery } from "@/lib/mysql";

export type PilotCheckStatus = "ready" | "warning" | "error";

export type PilotCheck = {
  id: string;
  group: "knowledge" | "permission" | "qa" | "training" | "operation";
  name: string;
  status: PilotCheckStatus;
  detail: string;
  action?: {
    label: string;
    href: string;
  };
};

export type PilotReadiness = {
  checkedAt: string;
  summary: {
    ready: number;
    warning: number;
    error: number;
    total: number;
    score: number;
  };
  metrics: {
    knowledgeBases: number;
    readyDocuments: number;
    failedDocuments: number;
    chunks: number;
    activeUsers: number;
    employeeUsers: number;
    departments: number;
    departmentScopedKbs: number;
    qaTests: number;
    qaRun: number;
    qaPassed: number;
    qaFailed: number;
    qaNoCitation: number;
    qaPassRate: number;
    qaNoCitationRate: number;
    readyTrainingJobs: number;
    openFeedback: number;
  };
  parserCoverage: Array<{
    parser: string;
    chunks: number;
  }>;
  checks: PilotCheck[];
};

const groupWeight: Record<PilotCheckStatus, number> = {
  ready: 1,
  warning: 0.5,
  error: 0
};

export async function getPilotReadiness(): Promise<PilotReadiness> {
  const cachedPilot = await loadPilotReadinessSnapshot();
  if (cachedPilot && Date.now() - new Date(cachedPilot.checkedAt).getTime() < 5 * 60 * 1000) {
    return cachedPilot;
  }

  if (isMySqlDatabase()) {
    try {
      const readiness = await getMySqlPilotReadiness();
      setPilotReadinessSnapshot(readiness);
      return readiness;
    } catch (error) {
      console.warn("[pilot-readiness] MySQL aggregate failed, using snapshot", error);
      if (cachedPilot) {
        return { ...cachedPilot, checkedAt: new Date().toISOString() };
      }
    }
  }

  const cachedTraining = await loadTrainingListSnapshot();
  let usedFallback = false;
  const markFallback = () => {
    usedFallback = true;
  };
  const [knowledgeBases, documents, chunkMetadata, users, qaTests, trainingJobs, feedback] = await Promise.all([
    withPilotFallback(() => listKnowledgeBases(), [], "knowledge bases", 5000, markFallback),
    withPilotFallback(() => listDocuments(), [], "documents", 10000, markFallback),
    isLocalTextRag() ? withPilotFallback(() => listDocumentChunkMetadata(), [], "document chunk metadata", 10000, markFallback) : Promise.resolve([]),
    withPilotFallback(() => listUsers(), [], "users", 10000, markFallback),
    withPilotFallback(() => listQaTestCases(), [], "qa tests", 12000, markFallback),
    withPilotFallback(() => listTrainingJobs(), cachedTraining?.trainingJobs ?? [], "training jobs", 8000, markFallback),
    withPilotFallback(() => listFeedback(), [], "feedback", 10000, markFallback)
  ]);

  const readyDocuments = documents.filter((document) => document.status === "ready");
  const failedDocuments = documents.filter((document) => document.status === "failed");
  const activeUsers = users.filter((user) => user.status === "active");
  const employeeUsers = activeUsers.filter((user) => user.role === "employee");
  const departments = new Set(activeUsers.map((user) => user.department).filter(Boolean));
  const departmentScopedKbs = knowledgeBases.filter((kb) => kb.visibility === "department" && kb.departments.length > 0);
  const qaRun = qaTests.filter((test) => Boolean(test.answer));
  const qaPassed = qaTests.filter((test) => test.status === "passed");
  const qaFailed = qaTests.filter((test) => test.status === "failed");
  const qaNoCitation = qaRun.filter((test) => test.citations.length === 0);
  const openFeedback = feedback.filter((item) => item.status === "pending" || item.status === "processing");
  const parserCoverage = summarizeParserCoverage(chunkMetadata);
  const metrics = {
    knowledgeBases: knowledgeBases.length,
    readyDocuments: readyDocuments.length,
    failedDocuments: failedDocuments.length,
    chunks: chunkMetadata.length,
    activeUsers: activeUsers.length,
    employeeUsers: employeeUsers.length,
    departments: departments.size,
    departmentScopedKbs: departmentScopedKbs.length,
    qaTests: qaTests.length,
    qaRun: qaRun.length,
    qaPassed: qaPassed.length,
    qaFailed: qaFailed.length,
    qaNoCitation: qaNoCitation.length,
    qaPassRate: qaRun.length > 0 ? Math.round((qaPassed.length / qaRun.length) * 100) : 0,
    qaNoCitationRate: qaRun.length > 0 ? Math.round((qaNoCitation.length / qaRun.length) * 100) : 0,
    readyTrainingJobs: trainingJobs.filter((job) => job.status === "ready").length,
    openFeedback: openFeedback.length
  };
  const checks = buildChecks(metrics, parserCoverage);

  const readiness = {
    checkedAt: new Date().toISOString(),
    summary: summarize(checks),
    metrics,
    parserCoverage,
    checks
  };

  if (usedFallback && cachedPilot) {
    return {
      ...cachedPilot,
      checkedAt: readiness.checkedAt
    };
  }

  if (!usedFallback) {
    setPilotReadinessSnapshot(readiness);
  }

  return readiness;
}

async function getMySqlPilotReadiness(): Promise<PilotReadiness> {
  const results = await mysqlBatchQuery([
    { sql: `select count(*) knowledge_bases,
      sum(case when visibility='department' and json_length(departments) > 0 then 1 else 0 end) department_scoped_kbs
      from knowledge_bases` },
    { sql: `select
      sum(case when status='ready' then 1 else 0 end) ready_documents,
      sum(case when status='failed' then 1 else 0 end) failed_documents
      from documents` },
    { sql: `select coalesce(json_unquote(json_extract(metadata, '$.parser')), 'unknown') parser, count(*) chunks
      from document_chunks group by parser order by chunks desc` },
    { sql: `select
      sum(case when status='active' then 1 else 0 end) active_users,
      sum(case when status='active' and role='employee' then 1 else 0 end) employee_users,
      count(distinct case when status='active' and department <> '' then department end) departments
      from users` },
    { sql: `select count(*) qa_tests,
      sum(case when answer is not null and answer <> '' then 1 else 0 end) qa_run,
      sum(case when status='passed' then 1 else 0 end) qa_passed,
      sum(case when status='failed' then 1 else 0 end) qa_failed,
      sum(case when answer is not null and answer <> '' and json_length(citations)=0 then 1 else 0 end) qa_no_citation
      from qa_test_cases` },
    { sql: "select sum(case when status='ready' then 1 else 0 end) ready_training_jobs from training_jobs" },
    { sql: "select sum(case when status in ('pending','processing') then 1 else 0 end) open_feedback from feedback" }
  ]);
  const first = (index: number) => (results[index] as Array<Record<string, unknown>> | undefined)?.[0] ?? {};
  const knowledge = first(0);
  const documents = first(1);
  const chunks = (results[2] as Array<Record<string, unknown>> | undefined) ?? [];
  const users = first(3);
  const qa = first(4);
  const training = first(5);
  const feedback = first(6);
  const qaRun = Number(qa.qa_run ?? 0);
  const qaPassed = Number(qa.qa_passed ?? 0);
  const qaNoCitation = Number(qa.qa_no_citation ?? 0);
  const parserCoverage = chunks.map((row) => ({
    parser: String(row.parser ?? "unknown"),
    chunks: Number(row.chunks ?? 0)
  }));
  const metrics: PilotReadiness["metrics"] = {
    knowledgeBases: Number(knowledge.knowledge_bases ?? 0),
    readyDocuments: Number(documents.ready_documents ?? 0),
    failedDocuments: Number(documents.failed_documents ?? 0),
    chunks: parserCoverage.reduce((sum, item) => sum + item.chunks, 0),
    activeUsers: Number(users.active_users ?? 0),
    employeeUsers: Number(users.employee_users ?? 0),
    departments: Number(users.departments ?? 0),
    departmentScopedKbs: Number(knowledge.department_scoped_kbs ?? 0),
    qaTests: Number(qa.qa_tests ?? 0),
    qaRun,
    qaPassed,
    qaFailed: Number(qa.qa_failed ?? 0),
    qaNoCitation,
    qaPassRate: qaRun > 0 ? Math.round(qaPassed / qaRun * 100) : 0,
    qaNoCitationRate: qaRun > 0 ? Math.round(qaNoCitation / qaRun * 100) : 0,
    readyTrainingJobs: Number(training.ready_training_jobs ?? 0),
    openFeedback: Number(feedback.open_feedback ?? 0)
  };
  const checks = buildChecks(metrics, parserCoverage);
  return {
    checkedAt: new Date().toISOString(),
    summary: summarize(checks),
    metrics,
    parserCoverage,
    checks
  };
}

async function withPilotFallback<T>(
  operation: () => Promise<T>,
  fallback: T,
  label: string,
  timeoutMs = 2500,
  onFallback?: () => void
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    let timer: ReturnType<typeof setTimeout> | null = null;
    try {
      return await Promise.race([
        operation(),
        new Promise<T>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`${label} 读取超时`)), timeoutMs);
        })
      ]);
    } catch (error) {
      lastError = error;
      if (attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 350));
      }
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  console.warn(`[pilot-readiness] ${label} failed after retries, using fallback`, lastError);
  onFallback?.();
  return fallback;
}

function buildChecks(metrics: PilotReadiness["metrics"], parserCoverage: PilotReadiness["parserCoverage"]): PilotCheck[] {
  const checks: PilotCheck[] = [
    {
      id: "knowledge-base",
      group: "knowledge",
      name: "知识库已创建",
      status: metrics.knowledgeBases > 0 ? "ready" : "error",
      detail: metrics.knowledgeBases > 0
        ? `已有 ${metrics.knowledgeBases} 个知识库。`
        : "还没有知识库，员工问答没有检索范围。",
      action: { label: "进入知识管理", href: "/admin/documents" }
    },
    {
      id: "ready-documents",
      group: "knowledge",
      name: "可用资料",
      status: metrics.readyDocuments >= 3 ? "ready" : metrics.readyDocuments > 0 ? "warning" : "error",
      detail: metrics.readyDocuments >= 3
        ? `已有 ${metrics.readyDocuments} 份可用资料，适合小范围试运行。`
        : metrics.readyDocuments > 0
          ? `当前只有 ${metrics.readyDocuments} 份可用资料，建议至少准备 3-5 份核心制度或培训手册。`
          : "还没有处理完成的资料。",
      action: { label: "上传资料", href: "/admin/documents" }
    },
    {
      id: "local-chunks",
      group: "knowledge",
      name: "本地 RAG 分片",
      status: env.ragProvider === "local_text"
        ? metrics.chunks > 0 ? "ready" : "error"
        : "ready",
      detail: env.ragProvider === "local_text"
        ? metrics.chunks > 0
          ? `当前已有 ${metrics.chunks} 个可检索知识片段。`
          : "local_text 模式下还没有可检索分片，请重新上传或检查资料解析。"
        : "当前未使用 local_text，本项不限制试运行。",
      action: { label: "查看资料", href: "/admin/documents" }
    },
    {
      id: "parser-coverage",
      group: "knowledge",
      name: "资料类型覆盖",
      status: parserCoverage.length >= 2 ? "ready" : parserCoverage.length > 0 ? "warning" : "error",
      detail: parserCoverage.length > 0
        ? `已覆盖 ${parserCoverage.map((item) => parserLabel(item.parser)).join("、")}。`
        : "还没有可统计的资料解析类型。",
      action: { label: "上传 PDF/Excel/PPT", href: "/admin/documents" }
    },
    {
      id: "users",
      group: "permission",
      name: "员工账号",
      status: metrics.employeeUsers > 0 ? "ready" : "warning",
      detail: metrics.employeeUsers > 0
        ? `已有 ${metrics.employeeUsers} 个启用的员工账号。`
        : "建议至少创建 1-2 个员工账号，用普通员工身份验收问答体验。",
      action: { label: "用户管理", href: "/admin/users" }
    },
    {
      id: "department-permission",
      group: "permission",
      name: "部门权限",
      status: metrics.departments >= 2 && metrics.departmentScopedKbs > 0
        ? "ready"
        : metrics.departments > 0 ? "warning" : "error",
      detail: metrics.departmentScopedKbs > 0
        ? `已有 ${metrics.departmentScopedKbs} 个部门可见知识库，当前用户覆盖 ${metrics.departments} 个部门。`
        : "建议配置至少一个“部门可见”的知识库，并用不同部门员工账号验证越权隔离。",
      action: { label: "配置知识库权限", href: "/admin/documents" }
    },
    {
      id: "qa-tests",
      group: "qa",
      name: "问答测试集",
      status: metrics.qaTests >= 30 ? "ready" : metrics.qaTests >= 10 ? "warning" : "error",
      detail: metrics.qaTests >= 10
        ? `已有 ${metrics.qaTests} 条测试问题。`
        : `当前只有 ${metrics.qaTests} 条测试问题，建议先准备 30 条高频问题。`,
      action: { label: "进入问答测试", href: "/admin/qa-tests" }
    },
    {
      id: "qa-result",
      group: "qa",
      name: "问答通过率",
      status: metrics.qaRun >= 10 && metrics.qaPassRate >= 80 && metrics.qaNoCitationRate <= 10
        ? "ready"
        : metrics.qaRun > 0 ? "warning" : "error",
      detail: metrics.qaRun > 0
        ? `已运行 ${metrics.qaRun} 条，通过率 ${metrics.qaPassRate}%，无引用率 ${metrics.qaNoCitationRate}%。`
        : "问答测试还没有运行结果。",
      action: { label: "运行测试", href: "/admin/qa-tests" }
    },
    {
      id: "training",
      group: "training",
      name: "培训语音课程",
      status: metrics.readyTrainingJobs > 0 ? "ready" : "warning",
      detail: metrics.readyTrainingJobs > 0
        ? `已有 ${metrics.readyTrainingJobs} 个可用培训讲解任务。`
        : "如要试运行培训场景，建议上传 1 个 PPTX 生成讲稿并测试语音播放。",
      action: { label: "讲解生成", href: "/admin/training" }
    },
    {
      id: "feedback-loop",
      group: "operation",
      name: "反馈闭环",
      status: metrics.openFeedback <= 5 ? "ready" : "warning",
      detail: metrics.openFeedback <= 5
        ? `当前待处理反馈 ${metrics.openFeedback} 条，运营压力可控。`
        : `当前待处理反馈 ${metrics.openFeedback} 条，建议先处理高频问题和需补充知识。`,
      action: { label: "会话反馈", href: "/admin/insights" }
    }
  ];

  if (metrics.failedDocuments > 0) {
    checks.push({
      id: "failed-documents",
      group: "knowledge",
      name: "失败资料处理",
      status: "warning",
      detail: `有 ${metrics.failedDocuments} 份资料处理失败，建议删除后重新上传或检查文件格式/OCR 配置。`,
      action: { label: "查看失败资料", href: "/admin/documents" }
    });
  }

  return checks;
}

function summarizeParserCoverage(chunks: Awaited<ReturnType<typeof listDocumentChunkMetadata>>) {
  const counts = new Map<string, number>();

  for (const chunk of chunks) {
    const parser = chunk.metadata.parser ?? chunk.metadata.source ?? "unknown";
    counts.set(parser, (counts.get(parser) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([parser, count]) => ({ parser, chunks: count }))
    .sort((a, b) => b.chunks - a.chunks);
}

function summarize(checks: PilotCheck[]) {
  const ready = checks.filter((check) => check.status === "ready").length;
  const warning = checks.filter((check) => check.status === "warning").length;
  const error = checks.filter((check) => check.status === "error").length;
  const score = checks.length > 0
    ? Math.round((checks.reduce((total, check) => total + groupWeight[check.status], 0) / checks.length) * 100)
    : 0;

  return {
    ready,
    warning,
    error,
    total: checks.length,
    score
  };
}

export function parserLabel(parser: string) {
  const labels: Record<string, string> = {
    text: "TXT/Markdown",
    docx: "Word",
    pptx: "PPT",
    pdf_text: "PDF",
    excel: "Excel",
    ocr: "OCR",
    local_text: "本地文本",
    manual_supplement: "整改补充"
  };

  return labels[parser] ?? parser;
}
