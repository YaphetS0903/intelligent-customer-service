import {
  env,
  hasAnyChatModelConfig,
  hasChatModelConfig,
  hasDigitalHumanConfig,
  hasLdapConfig,
  hasMySqlConfig,
  hasOcrConfig,
  hasOpenAIConfig,
  hasSsoConfig,
  hasTtsConfig,
  isMySqlDatabase,
  isLocalTextRag,
  hasSupabaseAdminConfig,
  hasSupabaseConfig
} from "@/lib/config";
import {
  getCurrentUserOrNull,
  getWorkflowReadinessStats
} from "@/lib/db";
import { getOpenAIClient } from "@/lib/openai";
import { demoUser } from "@/lib/mock-store";
import { mysqlQuery } from "@/lib/mysql";
import { createSupabaseAdminClient, createSupabaseServerClient } from "@/lib/supabase/server";
import type { WorkflowReadinessStats } from "@/lib/types";
import type { UserProfile } from "@/lib/types";

export type HealthStatus = "ready" | "warning" | "error";

export type HealthCheck = {
  id: string;
  group: "database" | "supabase" | "openai" | "user" | "workflow";
  name: string;
  status: HealthStatus;
  detail: string;
  action?: {
    label: string;
    href: string;
  };
};

export type SettingsUserSnapshot = {
  id: string;
  email: string;
  name: string;
  role: UserProfile["role"];
  department: string;
  source: "demo" | "mysql" | "supabase";
  adminByEnv: boolean;
};

export type SystemHealth = {
  checkedAt: string;
  mode: "demo" | "connected";
  summary: {
    ready: number;
    warning: number;
    error: number;
    total: number;
  };
  user: SettingsUserSnapshot | null;
  config: {
    supabaseUrl: boolean;
    supabaseAnonKey: boolean;
    supabaseServiceRoleKey: boolean;
    supabaseAdminEmails: number;
    openaiApiKey: boolean;
    openaiChatModel: string;
    openaiTtsModel: string;
    openaiTtsVoice: string;
    ttsProvider: string;
    ttsApiUrl: boolean;
    ttsStatusUrl: boolean;
    ttsApiKey: boolean;
    ttsModel: string;
    ttsVoice: string;
    aiChatProvider: string;
    aiChatBaseUrl: boolean;
    aiChatApiKey: boolean;
    aiChatModel: string;
    ocrProvider: string;
    ocrApiUrl: boolean;
    ocrApiKey: boolean;
    ocrModel: string;
    ragProvider: string;
    digitalHumanProvider: string;
    digitalHumanApiUrl: boolean;
    digitalHumanStatusUrl: boolean;
    digitalHumanApiKey: boolean;
    digitalHumanModel: string;
    digitalHumanAvatarId: string;
    digitalHumanVoiceId: string;
    ssoProvider: string;
    ssoAuthorizeUrl: boolean;
    ssoTokenUrl: boolean;
    ssoUserinfoUrl: boolean;
    ssoClientId: boolean;
    ssoScopes: string;
    ldapProvider: string;
    ldapUrl: boolean;
    ldapBindDn: boolean;
    ldapSearchBase: boolean;
    ldapUserDnTemplate: boolean;
    ldapEmailAttribute: string;
    ldapNameAttribute: string;
    ldapDepartmentAttribute: string;
    ldapPositionAttribute: string;
    ldapDefaultDomain: string;
    databaseProvider: string;
    mysqlHost: boolean;
    mysqlDatabase: boolean;
    mysqlUser: boolean;
  };
  checks: HealthCheck[];
};

const schemaTables = [
  "users",
  "knowledge_bases",
  "documents",
  "document_chunks",
  "document_versions",
  "document_version_chunks",
  "conversations",
  "messages",
  "feedback",
  "knowledge_tasks",
  "service_tickets",
  "security_events",
  "training_jobs",
  "training_video_jobs",
  "training_progress",
  "training_quiz_attempts",
  "qa_test_cases"
];

function envReady(...values: string[]) {
  return values.every((value) => value.trim().length > 0);
}

function redactError(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (typeof error === "object" && error && "message" in error) {
    return String(error.message);
  }

  return "检查失败";
}

function summarize(checks: HealthCheck[]) {
  return checks.reduce(
    (current, check) => ({
      ...current,
      [check.status]: current[check.status] + 1,
      total: current.total + 1
    }),
    { ready: 0, warning: 0, error: 0, total: 0 }
  );
}

async function withHealthTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      })
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

async function withHealthFallback<T>(promise: Promise<T>, fallback: T, timeoutMs: number, label: string): Promise<T> {
  try {
    return await withHealthTimeout(promise, timeoutMs, `${label} 读取超时`);
  } catch (error) {
    console.warn(`[health] ${label} unavailable, using fallback`, error);
    return fallback;
  }
}

export async function getSettingsUserSnapshot(): Promise<SettingsUserSnapshot | null> {
  if (isMySqlDatabase()) {
    const user = await getCurrentUserOrNull();
    if (!user) {
      return null;
    }

    return {
      ...user,
      source: "mysql",
      adminByEnv: false
    };
  }

  if (!hasSupabaseConfig()) {
    return {
      ...demoUser,
      source: "demo",
      adminByEnv: true
    };
  }

  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return null;
  }

  const {
    data: { user },
    error
  } = await supabase.auth.getUser();

  if (error || !user?.email) {
    return null;
  }

  const email = user.email.toLowerCase();
  const adminByEnv = env.adminEmails.includes(email);
  const fallback: SettingsUserSnapshot = {
    id: user.id,
    email: user.email,
    name: user.user_metadata?.name ?? user.email.split("@")[0],
    role: adminByEnv ? "admin" : "employee",
    department: user.user_metadata?.department ?? "",
    source: "supabase",
    adminByEnv
  };

  const admin = createSupabaseAdminClient();

  if (!admin) {
    return fallback;
  }

  const { data } = await admin
    .from("users")
    .select("id,email,name,role,department,created_at")
    .eq("id", user.id)
    .maybeSingle();

  if (!data) {
    return fallback;
  }

  return {
    id: data.id,
    email: data.email,
    name: data.name,
    role: adminByEnv ? "admin" : data.role,
    department: data.department ?? "",
    source: "supabase",
    adminByEnv
  };
}

async function checkMySqlDatabase(): Promise<HealthCheck> {
  if (!isMySqlDatabase()) {
    return {
      id: "database-provider",
      group: "database",
      name: "数据库模式",
      status: env.databaseProvider === "memory" ? "warning" : "ready",
      detail: env.databaseProvider === "memory"
        ? "当前使用内存演示数据，重启开发服务后业务数据会恢复初始状态。"
        : `当前数据库模式：${env.databaseProvider}。`
    };
  }

  if (!hasMySqlConfig()) {
    return {
      id: "mysql-connection",
      group: "database",
      name: "MySQL 数据库连接",
      status: "error",
      detail: "DATABASE_PROVIDER 已设置为 mysql，但 MYSQL_HOST、MYSQL_PORT、MYSQL_DATABASE、MYSQL_USER 尚未完整配置。",
      action: { label: "配置自定义数据库", href: "/admin/settings#setup" }
    };
  }

  try {
    await withHealthTimeout(mysqlQuery("select 1"), 2500, "MySQL 连接检查超时");

    return {
      id: "mysql-connection",
      group: "database",
      name: "MySQL 数据库连接",
      status: "ready",
      detail: `已连接 ${env.mysqlHost}:${env.mysqlPort}/${env.mysqlDatabase}，并自动确认 ${schemaTables.length} 张核心表。`
    };
  } catch (error) {
    return {
      id: "mysql-connection",
      group: "database",
      name: "MySQL 数据库连接",
      status: "error",
      detail: `连接或建表失败：${redactError(error)}`,
      action: { label: "检查数据库配置", href: "/admin/settings#setup" }
    };
  }
}

export async function requireSettingsAccess() {
  const user = await getSettingsUserSnapshot();

  if (!user || user.role !== "admin") {
    throw new Error("需要管理员权限");
  }

  return user;
}

async function checkSupabaseSchema(): Promise<HealthCheck> {
  if (!hasSupabaseAdminConfig()) {
    return {
      id: "supabase-schema",
      group: "supabase",
      name: "数据库表结构",
      status: "warning",
      detail: "未配置 service role key，无法检查 Supabase 表结构。",
      action: { label: "查看初始化说明", href: "/admin/settings#setup" }
    };
  }

  const admin = createSupabaseAdminClient();

  if (!admin) {
    return {
      id: "supabase-schema",
      group: "supabase",
      name: "数据库表结构",
      status: "error",
      detail: "Supabase Admin client 初始化失败，请检查 URL 和 service role key。"
    };
  }

  const missing: string[] = [];
  const failed: string[] = [];

  await Promise.all(
    schemaTables.map(async (table) => {
      const { error } = await admin.from(table).select("id", { count: "exact", head: true });

      if (!error) {
        return;
      }

      if (error.code === "42P01" || error.message.includes("does not exist")) {
        missing.push(table);
        return;
      }

      failed.push(`${table}: ${error.message}`);
    })
  );

  if (missing.length > 0) {
    return {
      id: "supabase-schema",
      group: "supabase",
      name: "数据库表结构",
      status: "error",
      detail: `缺少表：${missing.join("、")}。请在 Supabase SQL Editor 执行 supabase/schema.sql 和 migrations。`,
      action: { label: "查看初始化说明", href: "/admin/settings#setup" }
    };
  }

  if (failed.length > 0) {
    return {
      id: "supabase-schema",
      group: "supabase",
      name: "数据库表结构",
      status: "error",
      detail: failed.slice(0, 2).join("；")
    };
  }

  return {
    id: "supabase-schema",
    group: "supabase",
    name: "数据库表结构",
    status: "ready",
    detail: `已检查 ${schemaTables.length} 张核心表。`
  };
}

async function checkStorageBucket(): Promise<HealthCheck> {
  if (!hasSupabaseAdminConfig()) {
    return {
      id: "supabase-storage",
      group: "supabase",
      name: "Storage documents bucket",
      status: "warning",
      detail: "未配置 service role key，无法检查资料和语音缓存 bucket。",
      action: { label: "查看初始化说明", href: "/admin/settings#setup" }
    };
  }

  const admin = createSupabaseAdminClient();

  if (!admin) {
    return {
      id: "supabase-storage",
      group: "supabase",
      name: "Storage documents bucket",
      status: "error",
      detail: "Supabase Admin client 初始化失败。"
    };
  }

  const { error } = await admin.storage.getBucket("documents");

  if (error) {
    return {
      id: "supabase-storage",
      group: "supabase",
      name: "Storage documents bucket",
      status: "error",
      detail: "未读取到 documents bucket，请在 Supabase Storage 中创建同名 bucket。",
      action: { label: "查看初始化说明", href: "/admin/settings#setup" }
    };
  }

  return {
    id: "supabase-storage",
    group: "supabase",
    name: "Storage documents bucket",
    status: "ready",
    detail: "documents bucket 可访问，可用于资料文件和培训语音缓存。"
  };
}

async function checkOpenAIModel(id: string, name: string, model: string): Promise<HealthCheck> {
  if (!hasOpenAIConfig()) {
    return {
      id,
      group: "openai",
      name,
      status: "warning",
      detail: "未配置 OPENAI_API_KEY，当前会使用演示/降级逻辑。",
      action: { label: "查看 OpenAI 初始化", href: "/admin/settings#setup" }
    };
  }

  const client = getOpenAIClient();

  if (!client) {
    return {
      id,
      group: "openai",
      name,
      status: "error",
      detail: "OpenAI client 初始化失败。"
    };
  }

  try {
    await client.models.retrieve(model);

    return {
      id,
      group: "openai",
      name,
      status: "ready",
      detail: `模型 ${model} 可访问。`
    };
  } catch (error) {
    return {
      id,
      group: "openai",
      name,
      status: "error",
      detail: `模型 ${model} 校验失败：${redactError(error)}`
    };
  }
}

async function checkWorkflowReadiness(): Promise<HealthCheck[]> {
  try {
    const stats = await withHealthFallback(
      getWorkflowReadinessStats(),
      emptyWorkflowReadinessStats(),
      3500,
      "workflow readiness stats"
    );

    return [
      {
        id: "workflow-knowledge-base",
        group: "workflow",
        name: "上线验证：知识库",
        status: stats.knowledge_base_count > 0 ? "ready" : "warning",
        detail: stats.knowledge_base_count > 0
          ? `已创建 ${stats.knowledge_base_count} 个知识库。`
          : "真实接入后先创建一个知识库，用于承载制度、手册、FAQ 或培训资料。",
        action: { label: stats.knowledge_base_count > 0 ? "查看知识库" : "创建知识库", href: "/admin" }
      },
      {
        id: "workflow-vector-store",
        group: "workflow",
        name: isLocalTextRag() ? "上线验证：本地文本 RAG" : "上线验证：Vector Store",
        status: isLocalTextRag() || stats.vector_store_count > 0 ? "ready" : "warning",
        detail: isLocalTextRag()
          ? "当前使用 local_text 模式，上传资料会解析文字并写入当前数据库的 document_chunks，员工提问时使用轻量混合检索召回。"
          : stats.vector_store_count > 0
            ? `${stats.vector_store_count} 个知识库已绑定 OpenAI Vector Store。`
            : "至少需要给一个知识库创建 Vector Store，资料上传后才能进入 File Search 检索。",
        action: { label: "进入知识管理", href: "/admin" }
      },
      {
        id: "workflow-ready-documents",
        group: "workflow",
        name: "上线验证：可检索资料",
        status: stats.ready_document_count > 0 ? "ready" : "warning",
        detail: stats.ready_document_count > 0
          ? `已有 ${stats.ready_document_count} 份资料处理完成，可被员工问答检索。`
          : stats.processing_document_count > 0
            ? `有 ${stats.processing_document_count} 份资料仍在处理中，请刷新状态直到变为可用。`
            : "还没有处理完成的资料。请上传一份测试制度或 FAQ，并等待状态变为可用。",
        action: { label: stats.ready_document_count > 0 ? "查看资料" : "上传资料", href: "/admin" }
      },
      {
        id: "workflow-chat-validation",
        group: "workflow",
        name: "上线验证：员工问答",
        status: stats.conversation_count > 0 && stats.ready_document_count > 0 ? "ready" : "warning",
        detail: stats.conversation_count > 0
          ? `已产生 ${stats.conversation_count} 个会话。建议用真实资料提问，检查回答是否有来源引用。`
          : "资料可用后，用员工端发起一次真实提问，确认回答、引用来源和反馈按钮是否正常。",
        action: { label: "进入员工问答", href: "/chat" }
      },
      {
        id: "workflow-training-validation",
        group: "workflow",
        name: "上线验证：PPT 语音课程",
        status: stats.ready_training_count > 0 ? "ready" : "warning",
        detail: stats.ready_training_count > 0
          ? `已有 ${stats.ready_training_count} 个 PPT 课程生成完成。`
          : "数字人能力先延期时，可以先上传 PPTX 生成逐页讲稿和 TTS 语音，用于培训验证。",
        action: { label: "进入讲解生成", href: "/admin/training" }
      }
    ];
  } catch (error) {
    return [
      {
        id: "workflow-readiness-error",
        group: "workflow",
        name: "上线验证流程",
        status: "error",
        detail: `无法读取业务数据：${redactError(error)}。请先确认数据库连接和表结构可用。`,
        action: { label: "查看初始化说明", href: "/admin/settings#setup" }
      }
    ];
  }
}

function emptyWorkflowReadinessStats(): WorkflowReadinessStats {
  return {
    knowledge_base_count: 0,
    vector_store_count: 0,
    ready_document_count: 0,
    processing_document_count: 0,
    conversation_count: 0,
    ready_training_count: 0
  };
}

export async function getSystemHealth(): Promise<SystemHealth> {
  const user = await getSettingsUserSnapshot();
  const hasUnifiedIdentityConfig = hasSsoConfig() || hasLdapConfig();
  const checks: HealthCheck[] = [
    {
      id: "database-provider",
      group: "database",
      name: "数据库类型",
      status: ["memory", "supabase", "mysql"].includes(env.databaseProvider) ? "ready" : "error",
      detail: env.databaseProvider === "mysql"
        ? "当前使用自定义 MySQL 数据库保存用户、知识库、文档分片、会话、反馈和培训任务。"
        : env.databaseProvider === "supabase"
          ? "当前使用 Supabase 保存业务数据。"
          : "当前使用内存演示数据，适合无数据库时快速试用。",
      action: { label: "配置数据库", href: "/admin/settings#setup" }
    },
    {
      id: "supabase-client-env",
      group: "supabase",
      name: "Supabase Client 环境变量",
      status: hasSupabaseConfig() ? "ready" : isMySqlDatabase() ? "ready" : "warning",
      detail: hasSupabaseConfig()
        ? "NEXT_PUBLIC_SUPABASE_URL 和 NEXT_PUBLIC_SUPABASE_ANON_KEY 已配置。"
        : isMySqlDatabase()
          ? "当前使用自定义 MySQL 数据库，Supabase Client 可不配置。"
        : "未配置 Supabase client，系统会进入本地演示模式。",
      action: hasSupabaseConfig() || isMySqlDatabase() ? undefined : { label: "查看 .env.local 示例", href: "/admin/settings#setup" }
    },
    {
      id: "supabase-admin-env",
      group: "supabase",
      name: "Supabase Admin 环境变量",
      status: hasSupabaseAdminConfig() ? "ready" : isMySqlDatabase() ? "ready" : "warning",
      detail: hasSupabaseAdminConfig()
        ? "SUPABASE_SERVICE_ROLE_KEY 已配置，服务端可写入数据库和 Storage。"
        : isMySqlDatabase()
          ? "当前使用自定义 MySQL 数据库，Supabase Admin 可不配置；资料会解析后写入 MySQL。"
        : "未配置 service role key，真实资料上传、状态刷新和语音缓存会受限。",
      action: hasSupabaseAdminConfig() || isMySqlDatabase() ? undefined : { label: "查看 Supabase 初始化", href: "/admin/settings#setup" }
    },
    {
      id: "admin-email-env",
      group: "user",
      name: "管理员邮箱白名单",
      status: env.adminEmails.length > 0 || !hasSupabaseConfig() || isMySqlDatabase() ? "ready" : "warning",
      detail: isMySqlDatabase()
        ? "当前使用 MySQL 持久化数据，暂用内置管理员进入系统；后续可再接企业微信、钉钉或飞书登录。"
        : !hasSupabaseConfig()
          ? "当前为演示模式，使用内置演示管理员。接入 Supabase 后再配置管理员邮箱。"
        : env.adminEmails.length > 0
          ? `已配置 ${env.adminEmails.length} 个管理员邮箱。`
          : "未配置 SUPABASE_ADMIN_EMAILS，真实登录后可能无法进入管理端。",
      action: env.adminEmails.length > 0 ? undefined : { label: "查看权限说明", href: "/admin/settings#setup" }
    },
    {
      id: "current-admin",
      group: "user",
      name: "当前管理员身份",
      status: user?.role === "admin" ? "ready" : "error",
      detail: user
        ? `${user.email} 当前角色为 ${user.role}${user.adminByEnv ? "，命中管理员邮箱白名单" : ""}。`
        : "当前未登录，无法确认管理员身份。"
    },
    {
      id: "sso-provider",
      group: "user",
      name: "企业统一登录",
      status: hasUnifiedIdentityConfig ? "ready" : "warning",
      detail: hasSsoConfig()
        ? "已配置 OIDC 统一登录。登录页会显示企业统一登录入口，首次登录员工会自动建号。"
        : hasLdapConfig()
          ? "已配置 LDAP / AD 直连登录。员工可通过企业目录账号登录。"
          : env.ssoProvider === "oidc"
            ? "SSO_PROVIDER 为 oidc 时，需要填写授权地址、Token 地址、用户信息地址、Client ID 和 Client Secret。"
            : "未启用企业统一登录，当前使用系统内账号密码。正式上线建议接入 OIDC、LDAP 或 AD。",
      action: !hasUnifiedIdentityConfig
        ? { label: "配置统一登录", href: "/admin/settings#setup" }
        : undefined
    },
    {
      id: "ldap-provider",
      group: "user",
      name: "LDAP / AD 登录",
      status: hasLdapConfig() ? "ready" : hasSsoConfig() ? "ready" : "warning",
      detail: env.ldapProvider === "custom"
        ? hasSsoConfig()
          ? "OIDC 已覆盖统一身份入口；如还需要直连 LDAP / AD，可继续补充 LDAP 配置。"
          : hasLdapConfig()
            ? "已配置 LDAP / AD 直连登录。系统内账号密码失败后，会尝试使用企业目录校验员工身份并自动同步基础资料。"
            : "LDAP_PROVIDER 为 custom 时，需要填写 LDAP_URL，并配置服务账号搜索方式或用户 DN 模板。"
        : hasSsoConfig()
          ? "OIDC 已覆盖统一身份入口；当前未额外启用 LDAP / AD 直连。"
          : "未启用 LDAP / AD 直连登录，当前使用系统内账号密码。",
      action: !hasUnifiedIdentityConfig
        ? { label: "配置 LDAP", href: "/admin/settings#setup" }
        : undefined
    },
    {
      id: "openai-api-env",
      group: "openai",
      name: "OpenAI API Key",
      status: hasOpenAIConfig() ? "ready" : "warning",
      detail: hasOpenAIConfig()
        ? "OPENAI_API_KEY 已配置，可用于 Vector Store、File Search、TTS 和默认 OpenAI 模型能力。"
        : isLocalTextRag() && env.aiChatProvider === "custom"
          ? "未配置 OPENAI_API_KEY。当前员工问答可使用自定义模型和本地文本 RAG；OpenAI File Search、Vector Store 和 TTS 暂不可用。"
          : "未配置 OPENAI_API_KEY，OpenAI File Search、Vector Store 和 TTS 会使用演示/降级逻辑。",
      action: hasOpenAIConfig() ? undefined : { label: "查看 OpenAI 初始化", href: "/admin/settings#setup" }
    },
    {
      id: "ai-chat-provider",
      group: "openai",
      name: "对话模型供应商",
      status: hasAnyChatModelConfig() ? "ready" : "warning",
      detail: hasChatModelConfig()
        ? env.aiChatProvider === "custom"
          ? `已启用自定义 OpenAI-compatible 对话模型：${env.aiChatModel}。备用模型会在主模型失败时自动尝试。`
          : "当前使用 OpenAI 作为主对话模型供应商，备用模型会在主模型失败时自动尝试。"
        : hasAnyChatModelConfig()
          ? "主对话模型未完整配置，但已有备用模型可用于自动降级。建议补齐主模型或调整备用顺序。"
          : env.aiChatProvider === "custom"
            ? "AI_CHAT_PROVIDER 为 custom 时，需要同时填写 Base URL、API Key 和模型 ID。"
            : "当前使用 OpenAI 作为对话模型供应商。需要配置 OPENAI_API_KEY。",
      action: hasAnyChatModelConfig() ? undefined : { label: "配置对话模型", href: "/admin/settings#setup" }
    },
    {
      id: "rag-provider",
      group: "openai",
      name: "RAG 检索模式",
      status: ["openai_file_search", "local_text"].includes(env.ragProvider) ? "ready" : "error",
      detail: env.ragProvider === "local_text"
        ? "当前使用本地文本 RAG：资料文字切块存入当前数据库，通过轻量混合检索召回后再交给配置的对话模型生成答案。"
        : "当前使用 OpenAI File Search：资料同步到 OpenAI Vector Store 并由 Responses API 检索。",
      action: { label: "配置 RAG 模式", href: "/admin/settings#setup" }
    },
    {
      id: "ocr-provider",
      group: "openai",
      name: "OCR 扫描件识别",
      status: hasOcrConfig() ? "ready" : "warning",
      detail: env.ocrProvider === "custom"
        ? hasOcrConfig()
          ? `已配置自定义 OCR 接口${env.ocrModel ? `，模型：${env.ocrModel}` : ""}。PDF 扫描件解析失败时会自动尝试 OCR。`
          : "OCR_PROVIDER 为 custom 时，需要填写 OCR_API_URL 和 OCR_API_KEY。"
        : "未启用 OCR。普通文本 PDF 可直接解析；扫描件会提示配置 OCR 后重试。",
      action: !hasOcrConfig() ? { label: "配置 OCR", href: "/admin/settings#setup" } : undefined
    },
    {
      id: "tts-voice",
      group: "openai",
      name: "TTS 语音配置",
      status: hasTtsConfig() ? "ready" : "warning",
      detail: env.ttsProvider === "custom"
        ? hasTtsConfig()
          ? `已启用自定义 TTS 接口${env.ttsVoice ? `，音色：${env.ttsVoice}` : ""}${env.ttsModel ? `，模型：${env.ttsModel}` : ""}。`
          : "TTS_PROVIDER 为 custom 时，需要填写 TTS_API_URL 和 TTS_API_KEY；未配置前员工端会退回浏览器本地朗读。"
        : hasOpenAIConfig()
          ? `当前使用 OpenAI TTS：${env.openaiTtsModel} / ${env.openaiTtsVoice}。`
          : "当前使用 OpenAI TTS，但未配置 OPENAI_API_KEY；可改为 custom 接入第三方 TTS，未配置前员工端会退回浏览器本地朗读。"
    },
    {
      id: "digital-human-provider",
      group: "openai",
      name: "数字人视频服务",
      status: hasDigitalHumanConfig() ? "ready" : "warning",
      detail: env.digitalHumanProvider === "custom"
        ? hasDigitalHumanConfig()
          ? `已配置第三方数字人接口${env.digitalHumanAvatarId ? `，形象：${env.digitalHumanAvatarId}` : ""}${env.digitalHumanVoiceId ? `，音色：${env.digitalHumanVoiceId}` : ""}。`
          : "DIGITAL_HUMAN_PROVIDER 为 custom 时，需要填写生成 API URL 和 API Key。"
        : "未启用数字人视频。PPT 课程仍可使用逐页讲稿和 TTS 语音讲解。",
      action: !hasDigitalHumanConfig()
        ? { label: "配置数字人", href: "/admin/settings#setup" }
        : undefined
    }
  ];

  if (isMySqlDatabase()) {
    checks.push(await checkMySqlDatabase());
  }

  if (!isMySqlDatabase()) {
    checks.push(await checkSupabaseSchema());
    checks.push(await checkStorageBucket());
  }

  if (env.aiChatProvider !== "custom") {
    checks.push(await checkOpenAIModel("openai-chat-model", "OpenAI 对话模型", env.openaiChatModel));
  }

  if (env.ttsProvider !== "custom") {
    checks.push(await checkOpenAIModel("openai-tts-model", "OpenAI TTS 模型", env.openaiTtsModel));
  }
  checks.push(...await checkWorkflowReadiness());

  return {
    checkedAt: new Date().toISOString(),
    mode: hasSupabaseConfig() || hasMySqlConfig() || hasOpenAIConfig() || hasAnyChatModelConfig() ? "connected" : "demo",
    summary: summarize(checks),
    user,
    config: {
      supabaseUrl: Boolean(env.supabaseUrl),
      supabaseAnonKey: Boolean(env.supabaseAnonKey),
      supabaseServiceRoleKey: Boolean(env.supabaseServiceRoleKey),
      supabaseAdminEmails: env.adminEmails.length,
      openaiApiKey: Boolean(env.openaiApiKey),
      openaiChatModel: env.openaiChatModel,
      openaiTtsModel: env.openaiTtsModel,
      openaiTtsVoice: env.openaiTtsVoice,
      ttsProvider: env.ttsProvider,
      ttsApiUrl: Boolean(env.ttsApiUrl),
      ttsStatusUrl: Boolean(env.ttsStatusUrl),
      ttsApiKey: Boolean(env.ttsApiKey),
      ttsModel: env.ttsModel,
      ttsVoice: env.ttsVoice,
      aiChatProvider: env.aiChatProvider,
      aiChatBaseUrl: Boolean(env.aiChatBaseUrl),
      aiChatApiKey: Boolean(env.aiChatApiKey),
      aiChatModel: env.aiChatModel,
      ocrProvider: env.ocrProvider,
      ocrApiUrl: Boolean(env.ocrApiUrl),
      ocrApiKey: Boolean(env.ocrApiKey),
      ocrModel: env.ocrModel,
      ragProvider: env.ragProvider,
      digitalHumanProvider: env.digitalHumanProvider,
      digitalHumanApiUrl: Boolean(env.digitalHumanApiUrl),
      digitalHumanStatusUrl: Boolean(env.digitalHumanStatusUrl),
      digitalHumanApiKey: Boolean(env.digitalHumanApiKey),
      digitalHumanModel: env.digitalHumanModel,
      digitalHumanAvatarId: env.digitalHumanAvatarId,
      digitalHumanVoiceId: env.digitalHumanVoiceId,
      ssoProvider: env.ssoProvider,
      ssoAuthorizeUrl: Boolean(env.ssoAuthorizeUrl),
      ssoTokenUrl: Boolean(env.ssoTokenUrl),
      ssoUserinfoUrl: Boolean(env.ssoUserinfoUrl),
      ssoClientId: Boolean(env.ssoClientId),
      ssoScopes: env.ssoScopes,
      ldapProvider: env.ldapProvider,
      ldapUrl: Boolean(env.ldapUrl),
      ldapBindDn: Boolean(env.ldapBindDn),
      ldapSearchBase: Boolean(env.ldapSearchBase),
      ldapUserDnTemplate: Boolean(env.ldapUserDnTemplate),
      ldapEmailAttribute: env.ldapEmailAttribute,
      ldapNameAttribute: env.ldapNameAttribute,
      ldapDepartmentAttribute: env.ldapDepartmentAttribute,
      ldapPositionAttribute: env.ldapPositionAttribute,
      ldapDefaultDomain: env.ldapDefaultDomain,
      databaseProvider: env.databaseProvider,
      mysqlHost: Boolean(env.mysqlHost),
      mysqlDatabase: Boolean(env.mysqlDatabase),
      mysqlUser: Boolean(env.mysqlUser)
    },
    checks
  };
}
