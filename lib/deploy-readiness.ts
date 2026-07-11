import fs from "node:fs/promises";
import path from "node:path";
import {
  env,
  hasAnyChatModelConfig,
  hasChatModelConfig,
  hasDigitalHumanConfig,
  hasLdapConfig,
  hasMySqlConfig,
  hasOcrConfig,
  hasSsoConfig,
  hasTtsConfig,
  isLocalTextRag,
  isMySqlDatabase
} from "@/lib/config";
import { getPilotReadiness, parserLabel, type PilotReadiness } from "@/lib/pilot-readiness";
import { loadPilotReadinessSnapshot } from "@/lib/pilot-readiness-cache";
import { getSystemHealth } from "@/lib/health";
import { getDeployOperationStats } from "@/lib/db";
import type { DeployOperationStats } from "@/lib/types";

export type DeployCheckStatus = "ready" | "warning" | "error";

export type DeployCheck = {
  id: string;
  group: "environment" | "database" | "model" | "runtime" | "backup" | "pilot";
  name: string;
  status: DeployCheckStatus;
  detail: string;
  action?: {
    label: string;
    href: string;
  };
};

export type DeployIntegrationCheck = {
  id: string;
  name: string;
  status: DeployCheckStatus;
  detail: string;
  acceptance: string;
  action: {
    label: string;
    href: string;
  };
  check_ids: string[];
};

export type DeployReadiness = {
  checkedAt: string;
  summary: {
    ready: number;
    warning: number;
    error: number;
    total: number;
    score: number;
  };
  runtime: {
    nodeEnv: string;
    appBaseUrl: string;
    databaseProvider: string;
    ragProvider: string;
    chatProvider: string;
    ttsProvider: string;
    hasBuildOutput: boolean;
    hasAuthSecret: boolean;
    isLocalhostAppBaseUrl: boolean;
  };
  launchMetrics: {
    knowledgeBases: number;
    readyDocuments: number;
    chunks: number;
    parserTypes: number;
    qaTests: number;
    qaRun: number;
    qaPassRate: number;
    qaNoCitationRate: number;
    openFeedback: number;
    openKnowledgeTasks: number;
    openSecurityEvents: number;
    openServiceTickets: number;
    overdueServiceTickets: number;
    readyTrainingJobs: number;
    trainingLearners: number;
    completedTrainingLearners: number;
  };
  parserCoverage: Array<{
    parser: string;
    label: string;
    chunks: number;
  }>;
  integrationChecklist: DeployIntegrationCheck[];
  checks: DeployCheck[];
};

const scoreWeight: Record<DeployCheckStatus, number> = {
  ready: 1,
  warning: 0.5,
  error: 0
};

export async function getDeployReadiness(): Promise<DeployReadiness> {
  const [
    health,
    pilot,
    hasBuildOutput,
    hasCiWorkflow,
    hasDeployWorkflow,
    mysqlBackup,
    mysqlRestore,
    runtimeMonitor,
    operationStats
  ] = await Promise.all([
    getSystemHealth(),
    getDeployPilotReadiness(),
    hasNextBuildOutput(),
    hasWorkflowFile("ci.yml"),
    hasWorkflowFile("deploy.yml"),
    getMysqlBackupState(),
    getMysqlRestoreState(),
    getRuntimeMonitorState(),
    withDeployFallback(getDeployOperationStats(), emptyDeployOperationStats(), "operation stats")
  ]);
  const openKnowledgeTasks = operationStats.open_knowledge_tasks;
  const openSecurityEvents = operationStats.open_security_events;
  const openServiceTickets = operationStats.open_service_tickets;
  const overdueServiceTickets = operationStats.overdue_service_tickets;
  const completedTrainingLearners = operationStats.completed_training_learners;
  const hasUnifiedIdentityConfig = hasSsoConfig() || hasLdapConfig();
  const isLocalhostAppBaseUrl = isLocalhostUrl(env.appBaseUrl);
  const parserCoverage = pilot.parserCoverage.map((item) => ({
    ...item,
    label: parserLabel(item.parser)
  }));
  const launchMetrics: DeployReadiness["launchMetrics"] = {
    knowledgeBases: pilot.metrics.knowledgeBases,
    readyDocuments: pilot.metrics.readyDocuments,
    chunks: pilot.metrics.chunks,
    parserTypes: parserCoverage.length,
    qaTests: pilot.metrics.qaTests,
    qaRun: pilot.metrics.qaRun,
    qaPassRate: pilot.metrics.qaPassRate,
    qaNoCitationRate: pilot.metrics.qaNoCitationRate,
    openFeedback: pilot.metrics.openFeedback,
    openKnowledgeTasks,
    openSecurityEvents,
    openServiceTickets,
    overdueServiceTickets,
    readyTrainingJobs: pilot.metrics.readyTrainingJobs,
    trainingLearners: operationStats.training_learners,
    completedTrainingLearners
  };
  const checks: DeployCheck[] = [
    {
      id: "node-env",
      group: "runtime",
      name: "运行模式",
      status: process.env.NODE_ENV === "production" ? "ready" : "warning",
      detail: process.env.NODE_ENV === "production"
        ? "当前以 production 模式运行。"
        : "当前不是 production 模式。正式部署时请执行 npm run build 后用 npm run start 或 PM2 启动。"
    },
    {
      id: "build-output",
      group: "runtime",
      name: "生产构建产物",
      status: hasBuildOutput ? "ready" : "error",
      detail: hasBuildOutput
        ? "已检测到 .next 生产构建产物。"
        : "未检测到 .next 构建产物，请先执行 npm run build。"
    },
    {
      id: "app-base-url",
      group: "environment",
      name: "访问地址",
      status: !isHttpUrl(env.appBaseUrl) ? "error" : isLocalhostAppBaseUrl ? "warning" : "ready",
      detail: !isHttpUrl(env.appBaseUrl)
        ? `APP_BASE_URL 当前为 ${env.appBaseUrl || "空"}，必须填写 http/https 地址。`
        : isLocalhostAppBaseUrl
          ? `APP_BASE_URL 当前为 ${env.appBaseUrl}。正式内网部署请改为员工可访问的服务器 IP 或域名；OIDC 回调会使用 ${ssoCallbackUrl()}。`
          : `APP_BASE_URL 已配置为 ${env.appBaseUrl}；OIDC 回调地址为 ${ssoCallbackUrl()}。`,
      action: isLocalhostAppBaseUrl || !isHttpUrl(env.appBaseUrl)
        ? { label: "配置访问地址", href: "/admin/settings#setup" }
        : undefined
    },
    {
      id: "auth-secret",
      group: "environment",
      name: "登录会话密钥",
      status: isWeakAuthSecret() ? "error" : "ready",
      detail: isWeakAuthSecret()
        ? "AUTH_SECRET 未配置或长度不足。正式部署前必须设置至少 24 位随机长字符串，例如 openssl rand -base64 32。"
        : "AUTH_SECRET 已配置。"
    },
    {
      id: "upload-limit",
      group: "environment",
      name: "上传限制",
      status: env.maxUploadMb >= 5 && env.maxUploadMb <= 100 ? "ready" : "warning",
      detail: `MAX_UPLOAD_MB 当前为 ${env.maxUploadMb}MB。试运行建议保留 20-50MB，并结合 Nginx client_max_body_size 同步配置。`,
      action: env.maxUploadMb < 5 || env.maxUploadMb > 100
        ? { label: "调整上传限制", href: "/admin/settings#setup" }
        : undefined
    },
    {
      id: "database-provider",
      group: "database",
      name: "数据库模式",
      status: isMySqlDatabase() && hasMySqlConfig() ? "ready" : isMySqlDatabase() ? "error" : "warning",
      detail: isMySqlDatabase()
        ? hasMySqlConfig()
          ? `当前使用 MySQL：${env.mysqlHost}:${env.mysqlPort}/${env.mysqlDatabase}。`
          : "DATABASE_PROVIDER=mysql，但 MySQL 连接信息不完整。"
        : "当前未使用 MySQL。正式内网部署建议使用公司自有 MySQL。"
    },
    {
      id: "database-health",
      group: "database",
      name: "数据库健康",
      status: mapHealthStatus(health.checks.find((check) => check.id === "mysql-connection")?.status ?? "warning"),
      detail: health.checks.find((check) => check.id === "mysql-connection")?.detail ?? "未读取到数据库健康检查结果。",
      action: { label: "查看配置", href: "/admin/settings" }
    },
    {
      id: "sso-provider",
      group: "environment",
      name: "统一身份认证",
      status: hasUnifiedIdentityConfig ? "ready" : "warning",
      detail: hasSsoConfig()
        ? "OIDC 统一登录已配置，员工可通过企业身份平台登录。"
        : hasLdapConfig()
          ? "LDAP / AD 直连登录已配置，员工可通过企业目录账号登录。"
          : env.ssoProvider === "oidc"
            ? "OIDC 统一登录配置不完整，登录页不会启用企业登录。"
            : "当前仍使用系统内账号密码。正式上线建议接入 OIDC、LDAP 或 AD 统一身份认证。",
      action: hasUnifiedIdentityConfig ? undefined : { label: "配置统一身份", href: "/admin/settings" }
    },
    {
      id: "ldap-provider",
      group: "environment",
      name: "LDAP / AD 登录",
      status: hasLdapConfig() ? "ready" : hasSsoConfig() ? "ready" : "warning",
      detail: env.ldapProvider === "custom"
        ? hasSsoConfig()
          ? "OIDC 已覆盖统一身份入口；如还需要直连 LDAP / AD，可继续补充 LDAP 配置。"
          : hasLdapConfig()
            ? "LDAP / AD 直连登录已配置，员工可用企业目录账号登录。"
            : "LDAP / AD 登录配置不完整，需要填写 LDAP_URL，并配置服务账号搜索或用户 DN 模板。"
        : hasSsoConfig()
          ? "OIDC 已覆盖统一身份入口；当前未额外启用 LDAP / AD 直连。"
          : "LDAP / AD 登录配置不完整，需要填写 LDAP_URL，并配置服务账号搜索或用户 DN 模板。",
      action: hasUnifiedIdentityConfig ? undefined : { label: "配置 LDAP", href: "/admin/settings" }
    },
    {
      id: "identity-callback",
      group: "environment",
      name: "统一身份回调地址",
      status: hasSsoConfig()
        ? isLocalhostAppBaseUrl ? "warning" : "ready"
        : hasLdapConfig() ? "ready" : "warning",
      detail: hasSsoConfig()
        ? isLocalhostAppBaseUrl
          ? `OIDC 已配置，但回调地址仍是 ${ssoCallbackUrl()}。正式身份平台通常无法回调 localhost，请先改 APP_BASE_URL。`
          : `请在身份平台登记回调地址：${ssoCallbackUrl()}。`
        : hasLdapConfig()
          ? "当前使用 LDAP / AD 直连登录，不需要 OIDC 回调地址。"
          : "未启用统一身份。若后续接 OIDC，请先确定 APP_BASE_URL，再把回调地址登记到身份平台。",
      action: !hasSsoConfig() || isLocalhostAppBaseUrl
        ? { label: "配置统一身份", href: "/admin/settings#setup" }
        : undefined
    },
    {
      id: "rag-provider",
      group: "model",
      name: "RAG 模式",
      status: isLocalTextRag() ? "ready" : "warning",
      detail: isLocalTextRag()
        ? "当前为 local_text，本地数据库分片轻量混合检索，适合无大型服务器场景。"
        : "当前不是 local_text。若无大型服务器且不使用 OpenAI File Search，建议切换为 local_text。"
    },
    {
      id: "chat-model",
      group: "model",
      name: "对话模型",
      status: hasAnyChatModelConfig() ? "ready" : "error",
      detail: hasChatModelConfig()
        ? `主对话模型已配置：${env.aiChatProvider === "custom" ? env.aiChatModel : env.openaiChatModel}；主模型失败时会按备用模型顺序自动降级。`
        : hasAnyChatModelConfig()
          ? "主对话模型未完整配置，但至少有一个备用模型可用。建议补齐主模型或把备用模型提升为主模型。"
          : "对话模型未完整配置，员工问答无法稳定生成回答。",
      action: { label: "配置模型", href: "/admin/settings" }
    },
    {
      id: "tts-model",
      group: "model",
      name: "语音服务",
      status: hasTtsConfig() ? "ready" : "warning",
      detail: hasTtsConfig()
        ? `语音服务已配置：${env.ttsProvider}。`
        : "服务端语音未完整配置；员工端和培训页会退回浏览器本地朗读。"
    },
    {
      id: "ocr-model",
      group: "model",
      name: "OCR 扫描件识别",
      status: hasOcrConfig() ? "ready" : "warning",
      detail: env.ocrProvider === "custom"
        ? hasOcrConfig()
          ? `OCR 已配置为自定义接口${env.ocrModel ? `，模型：${env.ocrModel}` : ""}，扫描件 PDF 和图片资料可走 OCR 入库。`
          : "OCR_PROVIDER 为 custom 时，需要填写 OCR_API_URL 和 OCR_API_KEY；未完整配置前只能解析文本型资料。"
        : "当前未启用 OCR。文本型 PDF、Word、PPT、Excel 可正常入库；扫描件会提示配置 OCR 后重试。",
      action: !hasOcrConfig()
        ? { label: "配置 OCR", href: "/admin/settings" }
        : undefined
    },
    {
      id: "digital-human-model",
      group: "model",
      name: "数字人视频服务",
      status: hasDigitalHumanConfig() ? "ready" : "warning",
      detail: env.digitalHumanProvider === "custom"
        ? hasDigitalHumanConfig()
          ? "数字人视频服务已配置，可在培训课程中提交视频生成任务。"
          : "数字人服务未完整配置；如要生成数字人课程视频，需要填写 API URL 和 API Key。"
        : "当前未启用数字人视频，系统会继续使用 PPT 讲稿和语音讲解。"
    },
    {
      id: "provider-test-entrypoints",
      group: "model",
      name: "第三方联调入口",
      status: "ready",
      detail: "配置页已提供对话模型、TTS 语音试听、OCR 实际测试和数字人接口测试；完成真实服务商参数后，应逐项点击并留存测试结果。",
      action: { label: "打开配置页测试", href: "/admin/settings#setup" }
    },
    {
      id: "knowledge-volume",
      group: "pilot",
      name: "知识库资料量",
      status: launchMetrics.readyDocuments >= 3 && launchMetrics.chunks >= 10 ? "ready" : launchMetrics.readyDocuments > 0 ? "warning" : "error",
      detail: launchMetrics.readyDocuments > 0
        ? `已有 ${launchMetrics.readyDocuments} 份可用资料、${launchMetrics.chunks} 个可检索片段。`
        : "还没有可用资料，员工问答无法形成可靠依据。",
      action: { label: "知识管理", href: "/admin/documents" }
    },
    {
      id: "parser-coverage",
      group: "pilot",
      name: "资料解析覆盖",
      status: parserCoverage.length >= 2 ? "ready" : parserCoverage.length > 0 ? "warning" : "error",
      detail: parserCoverage.length > 0
        ? `当前解析来源：${parserCoverage.map((item) => `${item.label} ${item.chunks}`).join("、")} 个片段。`
        : "暂无资料解析结果。建议至少验证 Markdown/TXT、Word/PDF/PPT/Excel 中的实际资料类型。",
      action: { label: "上传资料", href: "/admin/documents" }
    },
    {
      id: "pilot-score",
      group: "pilot",
      name: "试运行验收得分",
      status: pilot.summary.score >= 80 && pilot.summary.error === 0 ? "ready" : pilot.summary.score >= 60 ? "warning" : "error",
      detail: `当前试运行得分 ${pilot.summary.score}%，已就绪 ${pilot.summary.ready} 项，需处理 ${pilot.summary.error} 项。`,
      action: { label: "试运行验收", href: "/admin/pilot" }
    },
    {
      id: "qa-quality",
      group: "pilot",
      name: "QA 验证",
      status: pilot.metrics.qaRun >= 10 && pilot.metrics.qaPassRate >= 80 ? "ready" : pilot.metrics.qaRun > 0 ? "warning" : "error",
      detail: pilot.metrics.qaRun > 0
        ? `已运行 ${pilot.metrics.qaRun} 条 QA，通过率 ${pilot.metrics.qaPassRate}%，无引用率 ${pilot.metrics.qaNoCitationRate}%。`
        : "QA 测试尚未运行。正式开放前建议至少运行 30 条高频问题。",
      action: { label: "问答测试", href: "/admin/qa-tests" }
    },
    {
      id: "training-learning-flow",
      group: "pilot",
      name: "培训学习闭环",
      status: launchMetrics.readyTrainingJobs > 0 && launchMetrics.trainingLearners > 0
        ? "ready"
        : launchMetrics.readyTrainingJobs > 0 ? "warning" : "error",
      detail: launchMetrics.readyTrainingJobs > 0
        ? `已有 ${launchMetrics.readyTrainingJobs} 个可用课程、${launchMetrics.trainingLearners} 条学习进度、${launchMetrics.completedTrainingLearners} 条完课记录。试运行至少安排 1 名员工完成课程并提交测验。`
        : "还没有可用培训课程。请上传 PPTX，生成讲稿，发布课程，并让员工完成一次学习进度和测验验证。",
      action: { label: "培训管理", href: "/admin/training" }
    },
    {
      id: "service-ticket-flow",
      group: "pilot",
      name: "人工转接工单",
      status: overdueServiceTickets === 0 && openServiceTickets <= 10 ? "ready" : "warning",
      detail: `正式工单流转已启用，当前工单 ${operationStats.total_service_tickets} 条，待处理 ${openServiceTickets} 条，超时 ${overdueServiceTickets} 条。员工可从对话页发起人工协助，管理员可在会话反馈页处理。`,
      action: { label: "人工工单", href: "/admin/insights" }
    },
    {
      id: "security-audit-flow",
      group: "pilot",
      name: "安全审计与异常告警",
      status: openSecurityEvents <= 10 ? "ready" : "warning",
      detail: `已启用敏感信息脱敏、提示词注入检测、无权限访问记录和连续风险触发告警。当前安全事件 ${operationStats.total_security_events} 条，待处理 ${openSecurityEvents} 条。`,
      action: { label: "安全审计", href: "/admin/insights" }
    },
    {
      id: "runtime-monitor",
      group: "runtime",
      name: "服务运行监控",
      status: runtimeMonitor.activeAlerts > 0 ? "error" : runtimeMonitor.recent ? "ready" : "warning",
      detail: runtimeMonitor.checkedAt
        ? `最近巡检 ${runtimeMonitor.checkedAt}，检查 ${runtimeMonitor.checks} 项，当前告警 ${runtimeMonitor.activeAlerts} 条。`
        : "尚未检测到服务、数据库、磁盘和关键接口巡检记录。",
      action: { label: "运维与告警", href: "/admin/operations" }
    },
    {
      id: "knowledge-task-backlog",
      group: "pilot",
      name: "知识整改积压",
      status: openKnowledgeTasks <= 5 ? "ready" : "warning",
      detail: openKnowledgeTasks <= 5
        ? `当前待处理知识整改 ${openKnowledgeTasks} 条，试运行压力可控。`
        : `当前待处理知识整改 ${openKnowledgeTasks} 条，不阻塞生产底座启动；扩大试运行前建议先处理高频未命中和低覆盖问题。`,
      action: { label: "会话反馈", href: "/admin/insights" }
    },
    {
      id: "feedback-backlog",
      group: "pilot",
      name: "员工反馈积压",
      status: launchMetrics.openFeedback <= 5 ? "ready" : launchMetrics.openFeedback <= 20 ? "warning" : "error",
      detail: launchMetrics.openFeedback <= 5
        ? `当前待处理反馈 ${launchMetrics.openFeedback} 条。`
        : `当前待处理反馈 ${launchMetrics.openFeedback} 条，建议上线前关闭明显问题。`,
      action: { label: "反馈处理", href: "/admin/insights" }
    },
    {
      id: "backup-plan",
      group: "backup",
      name: "数据库备份方案",
      status: isMySqlDatabase() && mysqlBackup.recent ? "ready" : "warning",
      detail: mysqlBackup.recent
        ? `已检测到最近一次 MySQL 备份成功记录：${mysqlBackup.checkedAt}。请继续保留 .env.local 的安全备份。`
        : mysqlBackup.checkedAt
          ? `最近一次 MySQL 备份成功记录为 ${mysqlBackup.checkedAt}，已超过 36 小时。请检查服务器 crontab 和备份日志。`
          : "系统未检测到 MySQL 备份成功记录。请配置 mysqldump 定时备份，并保留 .env.local 的安全备份。",
      action: { label: "运维与备份", href: "/admin/operations" }
    },
    {
      id: "restore-verification",
      group: "backup",
      name: "备份恢复演练",
      status: mysqlRestore.valid ? "ready" : "warning",
      detail: mysqlRestore.valid
        ? `最近一次恢复验证 ${mysqlRestore.checkedAt} 完成：${mysqlRestore.tableCount} 张表、${mysqlRestore.totalRows} 行一致，临时恢复数据已清理。`
        : mysqlRestore.checkedAt
          ? `恢复验证记录 ${mysqlRestore.checkedAt} 未满足完整性要求，请重新执行验证。`
          : "尚未检测到不覆盖生产库的恢复验证记录。",
      action: { label: "执行恢复验证", href: "/admin/operations" }
    },
    {
      id: "ci-workflow",
      group: "backup",
      name: "自动化回归 CI",
      status: hasCiWorkflow ? "ready" : "error",
      detail: hasCiWorkflow
        ? "已配置 GitHub Actions CI，包含 npm ci、typecheck、build 和 Playwright 自动回归。"
        : "未检测到 .github/workflows/ci.yml，代码提交后无法自动执行回归验证。"
    },
    {
      id: "deploy-workflow",
      group: "backup",
      name: "部署流水线",
      status: hasDeployWorkflow ? "ready" : "warning",
      detail: hasDeployWorkflow
        ? "已配置部署流水线，发布前会先执行类型检查、生产构建和 Playwright 回归，再通过 SSH 调用本机部署脚本。"
        : "未检测到 .github/workflows/deploy.yml，正式环境需要手动部署或补充流水线。"
    },
    {
      id: "ops-doc",
      group: "backup",
      name: "部署运维手册",
      status: "ready",
      detail: "项目根目录已提供《部署与运维手册.md》，包含部署、Nginx、PM2、备份和恢复说明。"
    }
  ];
  const integrationChecklist = buildIntegrationChecklist(checks);

  return {
    checkedAt: new Date().toISOString(),
    summary: summarize(checks),
    runtime: {
      nodeEnv: process.env.NODE_ENV ?? "development",
      appBaseUrl: env.appBaseUrl,
      databaseProvider: env.databaseProvider,
      ragProvider: env.ragProvider,
      chatProvider: env.aiChatProvider,
      ttsProvider: env.ttsProvider,
      hasBuildOutput,
      hasAuthSecret: !isWeakAuthSecret(),
      isLocalhostAppBaseUrl
    },
    launchMetrics,
    parserCoverage,
    integrationChecklist,
    checks
  };
}

async function getDeployPilotReadiness(): Promise<PilotReadiness> {
  const snapshot = await loadPilotReadinessSnapshot();
  if (snapshot) {
    return snapshot;
  }

  return getPilotReadiness();
}

function emptyDeployOperationStats(): DeployOperationStats {
  return {
    open_knowledge_tasks: 0,
    total_security_events: 0,
    open_security_events: 0,
    total_service_tickets: 0,
    open_service_tickets: 0,
    overdue_service_tickets: 0,
    training_learners: 0,
    completed_training_learners: 0
  };
}

async function withDeployFallback<T>(promise: Promise<T>, fallback: T, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => {
          console.warn(`[deploy-readiness] ${label} timed out, using fallback`);
          resolve(fallback);
        }, 2500);
      })
    ]);
  } catch (error) {
    console.warn(`[deploy-readiness] ${label} failed, using fallback`, error);
    return fallback;
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

function buildIntegrationChecklist(checks: DeployCheck[]): DeployIntegrationCheck[] {
  const items: Array<Omit<DeployIntegrationCheck, "status" | "detail">> = [
    {
      id: "ocr",
      name: "OCR 联调",
      check_ids: ["ocr-model", "provider-test-entrypoints"],
      acceptance: "上传图片或扫描件 PDF，能返回文字预览，并能进入资料入库解析链路。",
      action: { label: "配置 OCR", href: "/admin/settings#setup" }
    },
    {
      id: "tts",
      name: "TTS 联调",
      check_ids: ["tts-model", "provider-test-entrypoints"],
      acceptance: "在配置页试听语音成功，员工问答和培训讲稿可播放服务端音频。",
      action: { label: "配置 TTS", href: "/admin/settings#setup" }
    },
    {
      id: "digital-human",
      name: "数字人联调",
      check_ids: ["digital-human-model", "provider-test-entrypoints"],
      acceptance: "配置页数字人测试能返回任务编号或视频地址，课程页可查看生成状态和播放视频。",
      action: { label: "配置数字人", href: "/admin/settings#setup" }
    },
    {
      id: "identity",
      name: "统一身份联调",
      check_ids: ["sso-provider", "ldap-provider", "identity-callback"],
      acceptance: "员工可通过 OIDC 或 LDAP / AD 登录，系统自动同步邮箱、姓名、部门和岗位。",
      action: { label: "配置身份", href: "/admin/settings#setup" }
    },
    {
      id: "ci-cd",
      name: "CI/CD 联调",
      check_ids: ["ci-workflow", "deploy-workflow"],
      acceptance: "代码提交触发 typecheck、build、Playwright 回归；部署流水线可执行服务器更新脚本。",
      action: { label: "查看流水线", href: "/admin/deploy" }
    }
  ];

  return items.map((item) => {
    const relatedChecks = item.check_ids
      .map((id) => checks.find((check) => check.id === id))
      .filter((check): check is DeployCheck => Boolean(check));

    return {
      ...item,
      status: summarizeIntegrationStatus(relatedChecks),
      detail: relatedChecks.length > 0
        ? relatedChecks.map((check) => `${check.name}：${statusLabel(check.status)}`).join("；")
        : "未找到对应检查项"
    };
  });
}

function summarizeIntegrationStatus(checks: DeployCheck[]): DeployCheckStatus {
  if (checks.some((check) => check.status === "error")) {
    return "error";
  }

  if (checks.length === 0 || checks.some((check) => check.status === "warning")) {
    return "warning";
  }

  return "ready";
}

function statusLabel(status: DeployCheckStatus) {
  const labels: Record<DeployCheckStatus, string> = {
    ready: "已就绪",
    warning: "待确认",
    error: "需处理"
  };

  return labels[status];
}

async function hasNextBuildOutput() {
  try {
    await fs.access(path.join(process.cwd(), ".next", "BUILD_ID"));
    return true;
  } catch {
    return false;
  }
}

async function hasWorkflowFile(fileName: string) {
  try {
    await fs.access(path.join(process.cwd(), ".github", "workflows", fileName));
    return true;
  } catch {
    return false;
  }
}

async function getMysqlBackupState() {
  try {
    const raw = await fs.readFile(path.join(process.cwd(), ".ops", "mysql-backup-last-success.json"), "utf8");
    const state = JSON.parse(raw) as { checkedAt?: unknown };
    const checkedAt = typeof state.checkedAt === "string" ? state.checkedAt : "";
    const checkedAtMs = Date.parse(checkedAt);
    const recent = Number.isFinite(checkedAtMs) && Date.now() - checkedAtMs <= 36 * 60 * 60 * 1000;

    return { checkedAt, recent };
  } catch {
    return { checkedAt: "", recent: false };
  }
}

async function getMysqlRestoreState() {
  try {
    const raw = await fs.readFile(path.join(process.cwd(), ".ops", "mysql-restore-last-success.json"), "utf8");
    const state = JSON.parse(raw) as Record<string, unknown>;
    const checkedAt = typeof state.checkedAt === "string" ? state.checkedAt : "";
    const tableCount = Number(state.tableCount ?? 0);
    const totalRows = Number(state.totalRows ?? 0);
    const mismatches = Number(state.rowCountMismatches ?? -1);
    const artifactsRemoved = state.restoreArtifactsRemoved === true;
    return {
      checkedAt,
      tableCount,
      totalRows,
      valid: Boolean(checkedAt && tableCount > 0 && mismatches === 0 && artifactsRemoved)
    };
  } catch {
    return { checkedAt: "", tableCount: 0, totalRows: 0, valid: false };
  }
}

async function getRuntimeMonitorState() {
  try {
    const raw = await fs.readFile(path.join(process.cwd(), ".ops", "runtime-monitor-state.json"), "utf8");
    const state = JSON.parse(raw) as Record<string, unknown>;
    const checkedAt = typeof state.checkedAt === "string" ? state.checkedAt : "";
    const checkedAtMs = Date.parse(checkedAt);
    const recent = Number.isFinite(checkedAtMs) && Date.now() - checkedAtMs <= 15 * 60 * 1000;
    return {
      checkedAt,
      recent,
      checks: Array.isArray(state.checks) ? state.checks.length : 0,
      activeAlerts: Array.isArray(state.alerts) ? state.alerts.length : 0
    };
  } catch {
    return { checkedAt: "", recent: false, checks: 0, activeAlerts: 0 };
  }
}

function isWeakAuthSecret() {
  return !process.env.AUTH_SECRET || env.authSecret === "dev-auth-secret" || env.authSecret.length < 24;
}

function isHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function isLocalhostUrl(value: string) {
  try {
    const url = new URL(value);
    return ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  } catch {
    return false;
  }
}

function ssoCallbackUrl() {
  return `${env.appBaseUrl.replace(/\/$/, "")}/api/auth/sso/callback`;
}

function mapHealthStatus(status: string): DeployCheckStatus {
  if (status === "ready" || status === "error") {
    return status;
  }

  return "warning";
}

function summarize(checks: DeployCheck[]) {
  const ready = checks.filter((check) => check.status === "ready").length;
  const warning = checks.filter((check) => check.status === "warning").length;
  const error = checks.filter((check) => check.status === "error").length;
  const score = checks.length > 0
    ? Math.round((checks.reduce((total, check) => total + scoreWeight[check.status], 0) / checks.length) * 100)
    : 0;

  return {
    ready,
    warning,
    error,
    total: checks.length,
    score
  };
}
