"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Database,
  ExternalLink,
  FileText,
  KeyRound,
  Loader2,
  MessageSquare,
  RefreshCw,
  Save,
  ScanText,
  ServerCog,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  UserRoundCog,
  Video,
  Volume2,
  XCircle
} from "lucide-react";
import { ErrorRetry, PanelSkeleton, useToast } from "@/components/ui-feedback";
import { fetchWithRetry } from "@/lib/client-fetch";
import type { EditableEnvSettings } from "@/lib/env-settings";
import type { HealthCheck, HealthStatus, SystemHealth } from "@/lib/health";

type SettingsResponse = {
  envFile: {
    path: string;
    exists: boolean;
    settings: EditableEnvSettings;
  };
};

type ModelTestResult = {
  ok: boolean;
  provider: string;
  model: string;
  modelLabel: string | null;
  latency_ms: number;
  answer: string | null;
  error: string | null;
  attempts: Array<{
    label: string;
    role: "primary" | "fallback";
    index: number;
    ok: boolean;
    error: string | null;
  }>;
};

type OcrTestResult = {
  ok: boolean;
  latency_ms: number;
  sections: number;
  characters: number;
  preview: string;
  model: string;
  error: string | null;
};

type DigitalHumanTestResult = {
  ok: boolean;
  latency_ms: number;
  provider_job_id: string | null;
  status: string | null;
  video_url: string | null;
  model: string;
  avatar_id: string;
  voice_id: string;
  error: string | null;
};

type ConfigField = {
  key: keyof EditableEnvSettings;
  label: string;
  placeholder?: string;
  secret?: boolean;
  multiline?: boolean;
};

type ConfigGroup = {
  title: string;
  description: string;
  fields: ConfigField[];
};

const f = (
  key: keyof EditableEnvSettings,
  label: string,
  options: Omit<ConfigField, "key" | "label"> = {}
): ConfigField => ({ key, label, ...options });

const configGroups: ConfigGroup[] = [
  {
    title: "自定义对话模型",
    description: "配置员工问答使用的主模型和自动降级模型。",
    fields: [
      f("AI_CHAT_PROVIDER", "主模型供应商"),
      f("AI_CHAT_BASE_URL", "主模型 Base URL", { placeholder: "https://api.example.com/v1" }),
      f("AI_CHAT_API_KEY", "主模型 API Key", { secret: true }),
      f("AI_CHAT_MODEL", "主模型 ID", { placeholder: "deepseek-chat / glm-4-plus / qwen-plus" }),
      f("AI_CHAT_FALLBACK_1_PROVIDER", "备用 1 供应商"),
      f("AI_CHAT_FALLBACK_1_BASE_URL", "备用 1 Base URL"),
      f("AI_CHAT_FALLBACK_1_API_KEY", "备用 1 API Key", { secret: true }),
      f("AI_CHAT_FALLBACK_1_MODEL", "备用 1 模型 ID"),
      f("AI_CHAT_FALLBACK_2_PROVIDER", "备用 2 供应商"),
      f("AI_CHAT_FALLBACK_2_BASE_URL", "备用 2 Base URL"),
      f("AI_CHAT_FALLBACK_2_API_KEY", "备用 2 API Key", { secret: true }),
      f("AI_CHAT_FALLBACK_2_MODEL", "备用 2 模型 ID")
    ]
  },
  {
    title: "RAG 检索模式",
    description: "选择知识库检索方式和本地文本召回策略。",
    fields: [
      f("RAG_PROVIDER", "检索方式"),
      f("RAG_RETRIEVAL_STRATEGY", "本地召回策略")
    ]
  },
  {
    title: "自定义数据库",
    description: "配置业务数据使用的 MySQL 和登录会话密钥。",
    fields: [
      f("DATABASE_PROVIDER", "数据库类型"),
      f("MYSQL_HOST", "MySQL 地址"),
      f("MYSQL_PORT", "MySQL 端口", { placeholder: "3306" }),
      f("MYSQL_DATABASE", "数据库名"),
      f("MYSQL_USER", "用户名"),
      f("MYSQL_PASSWORD", "密码", { secret: true }),
      f("AUTH_SECRET", "登录会话密钥", { secret: true })
    ]
  },
  {
    title: "OCR 扫描件识别",
    description: "配置图片和扫描件 PDF 的文字识别服务。",
    fields: [
      f("OCR_PROVIDER", "OCR 供应商"),
      f("OCR_API_URL", "OCR API URL"),
      f("OCR_API_KEY", "OCR API Key", { secret: true }),
      f("OCR_AUTH_HEADER", "认证头名", { placeholder: "Authorization / X-API-Key / api-key / none" }),
      f("OCR_HEADERS", "额外请求头 JSON", { multiline: true }),
      f("OCR_REQUEST_FORMAT", "请求格式"),
      f("OCR_FILE_FIELD", "文件字段名"),
      f("OCR_MODEL_FIELD", "模型字段名"),
      f("OCR_PROVIDER_FIELD", "供应商字段名"),
      f("OCR_PAYLOAD_TEMPLATE", "JSON 请求体模板", { multiline: true }),
      f("OCR_MODEL", "OCR 模型")
    ]
  },
  {
    title: "自定义语音 TTS",
    description: "配置课程讲解和员工端语音播放使用的语音服务。",
    fields: [
      f("TTS_PROVIDER", "TTS 供应商"),
      f("TTS_API_URL", "TTS API URL"),
      f("TTS_STATUS_URL", "任务状态 URL"),
      f("TTS_API_KEY", "TTS API Key", { secret: true }),
      f("TTS_AUTH_HEADER", "认证头名"),
      f("TTS_HEADERS", "额外请求头 JSON", { multiline: true }),
      f("TTS_PAYLOAD_TEMPLATE", "请求体模板 JSON", { multiline: true }),
      f("TTS_MODEL", "TTS 模型"),
      f("TTS_VOICE", "音色 ID")
    ]
  },
  {
    title: "数字人视频",
    description: "配置把课程讲稿生成数字人视频的第三方服务。",
    fields: [
      f("DIGITAL_HUMAN_PROVIDER", "数字人供应商"),
      f("DIGITAL_HUMAN_API_URL", "生成 API URL"),
      f("DIGITAL_HUMAN_STATUS_URL", "任务状态 URL"),
      f("DIGITAL_HUMAN_API_KEY", "API Key", { secret: true }),
      f("DIGITAL_HUMAN_AUTH_HEADER", "认证头名"),
      f("DIGITAL_HUMAN_HEADERS", "额外请求头 JSON", { multiline: true }),
      f("DIGITAL_HUMAN_PAYLOAD_TEMPLATE", "请求体模板 JSON", { multiline: true }),
      f("DIGITAL_HUMAN_MODEL", "模型 ID"),
      f("DIGITAL_HUMAN_AVATAR_ID", "形象 ID"),
      f("DIGITAL_HUMAN_VOICE_ID", "音色 ID")
    ]
  },
  {
    title: "统一身份认证",
    description: "通过标准 OIDC 接入企业统一身份平台；企业微信登录请在“业务集成”中配置。",
    fields: [
      f("SSO_PROVIDER", "登录方式"),
      f("SSO_AUTHORIZE_URL", "授权地址"),
      f("SSO_TOKEN_URL", "Token 地址"),
      f("SSO_USERINFO_URL", "用户信息地址"),
      f("SSO_CLIENT_ID", "Client ID"),
      f("SSO_CLIENT_SECRET", "Client Secret", { secret: true }),
      f("SSO_SCOPES", "Scopes"),
      f("SSO_DEFAULT_DEPARTMENT", "默认部门")
    ]
  },
  {
    title: "LDAP / AD 登录",
    description: "直连企业 LDAP 或 Active Directory 校验员工身份。",
    fields: [
      f("LDAP_PROVIDER", "LDAP 登录"),
      f("LDAP_URL", "LDAP URL"),
      f("LDAP_BIND_DN", "服务账号 DN"),
      f("LDAP_BIND_PASSWORD", "服务账号密码", { secret: true }),
      f("LDAP_SEARCH_BASE", "搜索 Base DN"),
      f("LDAP_SEARCH_FILTER", "搜索 Filter"),
      f("LDAP_USER_DN_TEMPLATE", "用户 DN 模板"),
      f("LDAP_EMAIL_ATTRIBUTE", "邮箱属性"),
      f("LDAP_NAME_ATTRIBUTE", "姓名属性"),
      f("LDAP_DEPARTMENT_ATTRIBUTE", "部门属性"),
      f("LDAP_POSITION_ATTRIBUTE", "岗位属性"),
      f("LDAP_DEFAULT_DOMAIN", "默认邮箱域")
    ]
  },
  {
    title: "应用参数",
    description: "配置系统访问地址、员工注册和文件上传限制。",
    fields: [
      f("APP_BASE_URL", "应用地址"),
      f("ALLOW_SELF_REGISTRATION", "员工自助注册"),
      f("MAX_UPLOAD_MB", "上传上限 MB")
    ]
  },
  {
    title: "OpenAI",
    description: "仅在使用 OpenAI 模型、File Search 或 OpenAI TTS 时配置。",
    fields: [
      f("OPENAI_API_KEY", "API Key", { secret: true }),
      f("OPENAI_CHAT_MODEL", "对话模型"),
      f("OPENAI_TTS_MODEL", "TTS 模型"),
      f("OPENAI_TTS_VOICE", "TTS 音色")
    ]
  },
  {
    title: "Supabase",
    description: "仅在使用 Supabase 数据库、认证或存储时配置。",
    fields: [
      f("NEXT_PUBLIC_SUPABASE_URL", "Project URL"),
      f("NEXT_PUBLIC_SUPABASE_ANON_KEY", "Anon Key", { secret: true }),
      f("SUPABASE_SERVICE_ROLE_KEY", "Service Role Key", { secret: true }),
      f("SUPABASE_ADMIN_EMAILS", "管理员邮箱")
    ]
  }
];

const primaryConfigSections = [
  { title: "核心服务", groups: ["自定义对话模型", "RAG 检索模式", "自定义数据库"] },
  { title: "内容处理", groups: ["OCR 扫描件识别", "自定义语音 TTS", "数字人视频"] },
  { title: "应用设置", groups: ["应用参数"] }
];

const advancedConfigGroups = ["统一身份认证", "LDAP / AD 登录", "OpenAI", "Supabase"];

const groupIcons: Record<string, typeof Settings> = {
  "自定义对话模型": Bot,
  "RAG 检索模式": SlidersHorizontal,
  "自定义数据库": Database,
  "OCR 扫描件识别": ScanText,
  "自定义语音 TTS": Volume2,
  "数字人视频": Video,
  "统一身份认证": KeyRound,
  "LDAP / AD 登录": UserRoundCog,
  "应用参数": ServerCog,
  OpenAI: MessageSquare,
  Supabase: ShieldCheck
};

const groupLabel: Record<HealthCheck["group"], string> = {
  database: "数据库",
  supabase: "Supabase",
  openai: "AI 能力",
  user: "身份与权限",
  workflow: "业务流程"
};

const statusLabel: Record<HealthStatus, string> = {
  ready: "正常",
  warning: "待完善",
  error: "需处理"
};

const selectOptions: Partial<Record<keyof EditableEnvSettings, Array<{ value: string; label: string }>>> = {
  DATABASE_PROVIDER: [
    { value: "mysql", label: "MySQL" },
    { value: "memory", label: "内存演示模式" }
  ],
  AI_CHAT_PROVIDER: [
    { value: "custom", label: "自定义兼容模型" },
    { value: "openai", label: "OpenAI" }
  ],
  AI_CHAT_FALLBACK_1_PROVIDER: providerOptions(),
  AI_CHAT_FALLBACK_2_PROVIDER: providerOptions(),
  RAG_PROVIDER: [
    { value: "local_text", label: "本地文本 RAG" },
    { value: "openai_file_search", label: "OpenAI File Search" }
  ],
  RAG_RETRIEVAL_STRATEGY: [
    { value: "balanced", label: "均衡召回" },
    { value: "content_first", label: "正文优先" },
    { value: "governance_enhanced", label: "治理增强" },
    { value: "synonym_expanded", label: "同义词扩展" }
  ],
  TTS_PROVIDER: [
    { value: "custom", label: "自定义 TTS" },
    { value: "openai", label: "OpenAI TTS" }
  ],
  OCR_PROVIDER: toggleProviderOptions("启用自定义 OCR"),
  OCR_REQUEST_FORMAT: [
    { value: "multipart", label: "Multipart 文件上传" },
    { value: "json_base64", label: "JSON Base64" }
  ],
  DIGITAL_HUMAN_PROVIDER: toggleProviderOptions("启用数字人服务"),
  SSO_PROVIDER: [
    { value: "none", label: "不启用统一登录" },
    { value: "oidc", label: "OIDC 统一登录" }
  ],
  LDAP_PROVIDER: toggleProviderOptions("启用 LDAP / AD"),
  ALLOW_SELF_REGISTRATION: [
    { value: "false", label: "关闭" },
    { value: "true", label: "开放" }
  ]
};

function providerOptions() {
  return [
    { value: "none", label: "不启用" },
    { value: "custom", label: "自定义兼容模型" },
    { value: "openai", label: "OpenAI" }
  ];
}

function toggleProviderOptions(enabledLabel: string) {
  return [
    { value: "none", label: "不启用" },
    { value: "custom", label: enabledLabel }
  ];
}

type ConfigState = "ready" | "partial" | "off";

function configState(title: string, settings: EditableEnvSettings): ConfigState {
  const complete = (keys: Array<keyof EditableEnvSettings>) => keys.every((key) => settings[key].trim());
  const partial = (keys: Array<keyof EditableEnvSettings>) => keys.some((key) => settings[key].trim());

  const state = (enabled: boolean, keys: Array<keyof EditableEnvSettings>): ConfigState =>
    enabled && complete(keys) ? "ready" : partial(keys) ? "partial" : "off";

  switch (title) {
    case "自定义对话模型":
      return state(settings.AI_CHAT_PROVIDER === "custom", ["AI_CHAT_BASE_URL", "AI_CHAT_API_KEY", "AI_CHAT_MODEL"]);
    case "RAG 检索模式":
      return ["local_text", "openai_file_search"].includes(settings.RAG_PROVIDER) ? "ready" : "partial";
    case "自定义数据库":
      return state(settings.DATABASE_PROVIDER === "mysql", ["MYSQL_HOST", "MYSQL_DATABASE", "MYSQL_USER", "MYSQL_PASSWORD", "AUTH_SECRET"]);
    case "OCR 扫描件识别":
      return state(settings.OCR_PROVIDER === "custom", ["OCR_API_URL", "OCR_API_KEY"]);
    case "自定义语音 TTS":
      return state(settings.TTS_PROVIDER === "custom", ["TTS_API_URL", "TTS_API_KEY"]);
    case "数字人视频":
      return state(settings.DIGITAL_HUMAN_PROVIDER === "custom", ["DIGITAL_HUMAN_API_URL", "DIGITAL_HUMAN_API_KEY"]);
    case "统一身份认证":
      return state(settings.SSO_PROVIDER === "oidc", ["SSO_AUTHORIZE_URL", "SSO_TOKEN_URL", "SSO_USERINFO_URL", "SSO_CLIENT_ID", "SSO_CLIENT_SECRET"]);
    case "LDAP / AD 登录":
      return state(settings.LDAP_PROVIDER === "custom", ["LDAP_URL"]);
    case "应用参数":
      return complete(["APP_BASE_URL", "MAX_UPLOAD_MB"]) ? "ready" : "partial";
    case "OpenAI":
      return settings.OPENAI_API_KEY.trim() ? "ready" : "off";
    case "Supabase":
      return state(true, ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"]);
    default:
      return "off";
  }
}

function configStateLabel(state: ConfigState) {
  return state === "ready" ? "已启用" : state === "partial" ? "需补充" : "未启用";
}

function StatusIcon({ status }: { status: HealthStatus }) {
  if (status === "ready") return <CheckCircle2 size={18} className="text-emerald-600" />;
  if (status === "error") return <XCircle size={18} className="text-red-600" />;
  return <CircleAlert size={18} className="text-amber-600" />;
}

function StatusBadge({ status }: { status: HealthStatus }) {
  const className = status === "ready"
    ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
    : status === "error"
      ? "bg-red-50 text-red-700 ring-red-200"
      : "bg-amber-50 text-amber-700 ring-amber-200";

  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${className}`}>{statusLabel[status]}</span>;
}

export function SettingsWizard() {
  const { pushToast } = useToast();
  const [settings, setSettings] = useState<EditableEnvSettings | null>(null);
  const [health, setHealth] = useState<SystemHealth | null>(null);
  const [activeView, setActiveView] = useState<"configuration" | "health">("configuration");
  const [activeGroupTitle, setActiveGroupTitle] = useState("自定义对话模型");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [healthLoading, setHealthLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testingModel, setTestingModel] = useState(false);
  const [testingOcr, setTestingOcr] = useState(false);
  const [testingTts, setTestingTts] = useState(false);
  const [testingDigitalHuman, setTestingDigitalHuman] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [modelTest, setModelTest] = useState<ModelTestResult | null>(null);
  const [ocrTest, setOcrTest] = useState<OcrTestResult | null>(null);
  const [digitalHumanTest, setDigitalHumanTest] = useState<DigitalHumanTestResult | null>(null);
  const [ocrFile, setOcrFile] = useState<File | null>(null);
  const [ttsText, setTtsText] = useState("西安天瑞汽车内饰件有限公司智能客服语音试听正常。");
  const [ttsAudioUrl, setTtsAudioUrl] = useState<string | null>(null);

  useEffect(() => {
    void Promise.all([loadSettings(), loadHealth()]);
  }, []);

  const activeGroup = useMemo(
    () => configGroups.find((group) => group.title === activeGroupTitle) ?? configGroups[0],
    [activeGroupTitle]
  );
  const visibleChecks = useMemo(() => {
    if (!settings) return health?.checks ?? [];
    const mysqlStack = settings.DATABASE_PROVIDER === "mysql";
    const customAiStack = settings.AI_CHAT_PROVIDER === "custom" && settings.RAG_PROVIDER === "local_text";

    return (health?.checks ?? []).filter((check) => {
      if (mysqlStack && check.group === "supabase") return false;
      if (customAiStack && settings.TTS_PROVIDER === "custom" && check.id === "openai-api-env") return false;
      return true;
    });
  }, [health, settings]);
  const groupedChecks = useMemo(() => {
    const groups = new Map<HealthCheck["group"], HealthCheck[]>();
    for (const check of visibleChecks) groups.set(check.group, [...(groups.get(check.group) ?? []), check]);
    return groups;
  }, [visibleChecks]);
  const healthSummary = useMemo(() => visibleChecks.reduce(
    (summary, check) => ({ ...summary, [check.status]: summary[check.status] + 1 }),
    { ready: 0, warning: 0, error: 0 }
  ), [visibleChecks]);

  async function loadSettings() {
    setSettingsLoading(true);
    setSettingsError(null);
    try {
      const response = await fetchWithRetry("/api/system/settings", { cache: "no-store" }, { timeoutMs: 10000 });
      const data = await response.json() as SettingsResponse & { error?: string };
      if (!response.ok) throw new Error(data.error ?? "读取配置失败");
      setSettings(data.envFile.settings);
    } catch (error) {
      setSettingsError(error instanceof Error ? error.message : "读取配置失败");
    } finally {
      setSettingsLoading(false);
    }
  }

  async function loadHealth() {
    setHealthLoading(true);
    setHealthError(null);
    try {
      const response = await fetchWithRetry("/api/system/health", { cache: "no-store" });
      const data = await response.json() as { health?: SystemHealth; error?: string };
      if (!response.ok || !data.health) throw new Error(data.error ?? "运行检查失败");
      setHealth(data.health);
    } catch (error) {
      setHealthError(error instanceof Error ? error.message : "运行检查失败");
    } finally {
      setHealthLoading(false);
    }
  }

  function updateSetting(key: keyof EditableEnvSettings, value: string) {
    setSettings((current) => current ? { ...current, [key]: value } : current);
  }

  async function saveSettings() {
    if (!settings) return;
    setSaving(true);
    try {
      const response = await fetch("/api/system/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings })
      });
      const data = await response.json() as SettingsResponse & { error?: string; notice?: string };
      if (!response.ok) throw new Error(data.error ?? "保存配置失败");
      setSettings(data.envFile.settings);
      pushToast({ tone: "success", title: "配置已保存", description: data.notice ?? "建议重新检查系统状态。" });
    } catch (error) {
      pushToast({ tone: "error", title: "保存配置失败", description: error instanceof Error ? error.message : "请检查配置内容。" });
    } finally {
      setSaving(false);
    }
  }

  async function testModelConnectivity() {
    setTestingModel(true);
    setModelTest(null);
    try {
      const response = await fetch("/api/system/model-test", { method: "POST" });
      const data = await response.json() as { result?: ModelTestResult; error?: string };
      if (!data.result) throw new Error(data.error ?? "模型测试失败");
      setModelTest(data.result);
      pushToast({ tone: data.result.ok ? "success" : "warning", title: data.result.ok ? "对话模型可用" : "模型检测未通过", description: data.result.error ?? `${data.result.modelLabel ?? data.result.model} 已完成测试。` });
    } catch (error) {
      pushToast({ tone: "error", title: "模型测试失败", description: error instanceof Error ? error.message : "请检查模型配置。" });
    } finally {
      setTestingModel(false);
    }
  }

  async function testOcrConnectivity() {
    if (!ocrFile) {
      pushToast({ tone: "warning", title: "请选择测试文件", description: "支持图片或扫描件 PDF。" });
      return;
    }
    setTestingOcr(true);
    setOcrTest(null);
    try {
      const formData = new FormData();
      formData.append("file", ocrFile);
      const response = await fetch("/api/system/ocr-test", { method: "POST", body: formData });
      const data = await response.json() as { result?: OcrTestResult; error?: string };
      if (!data.result) throw new Error(data.error ?? "OCR 测试失败");
      setOcrTest(data.result);
      pushToast({ tone: data.result.ok ? "success" : "warning", title: data.result.ok ? "OCR 可用" : "OCR 检测未通过", description: data.result.error ?? `识别到 ${data.result.characters} 个字符。` });
    } catch (error) {
      pushToast({ tone: "error", title: "OCR 测试失败", description: error instanceof Error ? error.message : "请检查 OCR 配置。" });
    } finally {
      setTestingOcr(false);
    }
  }

  async function previewTts() {
    if (!ttsText.trim()) return;
    setTestingTts(true);
    try {
      const response = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: ttsText.trim() })
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(data.error ?? "语音试听失败");
      }
      const blob = await response.blob();
      if (ttsAudioUrl) URL.revokeObjectURL(ttsAudioUrl);
      setTtsAudioUrl(URL.createObjectURL(blob));
      pushToast({ tone: "success", title: "语音已生成", description: `音频大小 ${blob.size} bytes。` });
    } catch (error) {
      pushToast({ tone: "error", title: "语音试听失败", description: error instanceof Error ? error.message : "请检查 TTS 配置。" });
    } finally {
      setTestingTts(false);
    }
  }

  async function testDigitalHumanConnectivity() {
    setTestingDigitalHuman(true);
    setDigitalHumanTest(null);
    try {
      const response = await fetch("/api/system/digital-human-test", { method: "POST" });
      const data = await response.json() as { result?: DigitalHumanTestResult; error?: string };
      if (!data.result) throw new Error(data.error ?? "数字人测试失败");
      setDigitalHumanTest(data.result);
      pushToast({ tone: data.result.ok ? "success" : "warning", title: data.result.ok ? "数字人接口可用" : "数字人检测未通过", description: data.result.error ?? `任务状态：${data.result.status ?? "已返回"}。` });
    } catch (error) {
      pushToast({ tone: "error", title: "数字人测试失败", description: error instanceof Error ? error.message : "请检查数字人配置。" });
    } finally {
      setTestingDigitalHuman(false);
    }
  }

  return (
    <div className="min-w-0 space-y-4" data-testid="settings-console">
      <header className="ui-card overflow-hidden">
        <div className="flex flex-col gap-4 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-cyan/10 text-brand">
              <Settings size={20} />
            </span>
            <div className="min-w-0">
              <h1 className="text-lg font-semibold text-ink">系统配置</h1>
              <p className="mt-0.5 text-sm text-slate-500">管理服务接入参数并检查当前运行状态。</p>
            </div>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <button type="button" onClick={() => void loadHealth()} disabled={healthLoading} className="ui-button-secondary h-10">
              {healthLoading ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
              重新检查
            </button>
            <button type="button" onClick={() => void saveSettings()} disabled={saving || !settings} className="ui-button-primary h-10">
              {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
              保存配置
            </button>
          </div>
        </div>
        <div className="border-t border-line px-4 py-2">
          <div className="grid max-w-md grid-cols-2 rounded-lg bg-slate-100 p-1" role="tablist" aria-label="系统配置视图">
            <ViewTab active={activeView === "configuration"} onClick={() => setActiveView("configuration")} icon={SlidersHorizontal}>服务配置</ViewTab>
            <ViewTab active={activeView === "health"} onClick={() => setActiveView("health")} icon={Activity}>运行检查</ViewTab>
          </div>
        </div>
      </header>

      {settingsError && <ErrorRetry title="配置读取失败" message={settingsError} retrying={settingsLoading} onRetry={() => void loadSettings()} />}
      {healthError && activeView === "health" && <ErrorRetry title="运行检查失败" message={healthError} retrying={healthLoading} onRetry={() => void loadHealth()} />}

      {activeView === "configuration" && (
        settingsLoading && !settings ? <PanelSkeleton rows={8} /> : settings ? (
          <section id="setup" className="ui-card scroll-mt-24 overflow-hidden" data-testid="settings-configuration">
            <div className="border-b border-line p-4 md:hidden">
              <label htmlFor="settings-group-select" className="block">
                <span className="mb-1.5 block text-sm font-medium text-slate-700">配置类别</span>
                <select id="settings-group-select" value={activeGroupTitle} onChange={(event) => setActiveGroupTitle(event.target.value)} className="ui-input h-11 w-full bg-white">
                  {primaryConfigSections.map((section) => (
                    <optgroup key={section.title} label={section.title}>
                      {section.groups.map((title) => <option key={title} value={title}>{title}</option>)}
                    </optgroup>
                  ))}
                  <optgroup label="高级兼容设置（可选）">
                    {advancedConfigGroups.map((title) => <option key={title} value={title}>{title}</option>)}
                  </optgroup>
                </select>
              </label>
            </div>

            <div className="grid min-w-0 md:grid-cols-[260px_minmax(0,1fr)]">
              <aside className="hidden border-r border-line bg-slate-50/70 p-3 md:block" aria-label="配置导航">
                {primaryConfigSections.map((section) => (
                  <div key={section.title} className="mb-4 last:mb-0">
                    <p className="mb-1.5 px-2 text-xs font-semibold text-slate-500">{section.title}</p>
                    <div className="space-y-1">
                      {section.groups.map((title) => (
                        <ConfigNavButton key={title} title={title} active={activeGroupTitle === title} state={configState(title, settings)} onClick={() => setActiveGroupTitle(title)} />
                      ))}
                    </div>
                  </div>
                ))}
                <div className="mt-3 border-t border-line pt-3">
                  <button
                    type="button"
                    onClick={() => setAdvancedOpen((open) => !open)}
                    aria-expanded={advancedOpen}
                    className="flex min-h-10 w-full items-center gap-2 rounded-lg px-2 text-left text-slate-600 transition hover:bg-white/80 hover:text-ink"
                  >
                    <SlidersHorizontal size={16} className="text-slate-400" />
                    <span className="min-w-0 flex-1 text-sm font-semibold">高级兼容设置</span>
                    <span className="text-xs font-normal text-slate-400">可选</span>
                    <ChevronDown size={15} className={`text-slate-400 transition-transform ${advancedOpen ? "rotate-180" : ""}`} />
                  </button>
                  {advancedOpen && (
                    <div className="mt-1 space-y-1 pl-1">
                      {advancedConfigGroups.map((title) => (
                        <ConfigNavButton key={title} title={title} active={activeGroupTitle === title} state={configState(title, settings)} onClick={() => setActiveGroupTitle(title)} />
                      ))}
                    </div>
                  )}
                </div>
              </aside>

              <div className="min-w-0 p-4 sm:p-5">
                <div className="flex flex-col gap-3 border-b border-line pb-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-base font-semibold text-ink">{activeGroup.title}</h2>
                      <ConfigStateBadge state={configState(activeGroup.title, settings)} />
                    </div>
                    <p className="mt-1 text-sm leading-6 text-slate-600">{activeGroup.description}</p>
                  </div>
                  {activeGroup.title === "自定义对话模型" && (
                    <TestButton loading={testingModel} onClick={() => void testModelConnectivity()} icon={MessageSquare}>测试模型</TestButton>
                  )}
                  {activeGroup.title === "数字人视频" && (
                    <TestButton loading={testingDigitalHuman} onClick={() => void testDigitalHumanConnectivity()} icon={Video}>测试数字人</TestButton>
                  )}
                </div>

                <div className="grid gap-4 py-5 lg:grid-cols-2">
                  {activeGroup.fields.map((field) => (
                    <ConfigFieldInput key={field.key} field={field} value={settings[field.key]} disabled={saving} onChange={(value) => updateSetting(field.key, value)} />
                  ))}
                </div>

                {activeGroup.title === "自定义语音 TTS" && (
                  <div className="border-t border-line pt-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                      <label className="min-w-0 flex-1">
                        <span className="mb-1.5 block text-sm font-medium text-slate-700">试听文本</span>
                        <textarea value={ttsText} onChange={(event) => setTtsText(event.target.value)} rows={2} className="ui-input w-full py-2 leading-6" />
                      </label>
                      <TestButton loading={testingTts} onClick={() => void previewTts()} icon={Volume2}>试听语音</TestButton>
                    </div>
                    {ttsAudioUrl && <audio controls src={ttsAudioUrl} className="mt-3 w-full" />}
                  </div>
                )}

                {activeGroup.title === "OCR 扫描件识别" && (
                  <div className="flex flex-col gap-3 border-t border-line pt-4 sm:flex-row sm:items-end">
                    <label className="min-w-0 flex-1">
                      <span className="mb-1.5 block text-sm font-medium text-slate-700">测试文件</span>
                      <input type="file" accept="image/*,.pdf" onChange={(event) => setOcrFile(event.target.files?.[0] ?? null)} className="ui-input h-11 w-full py-2" />
                    </label>
                    <TestButton loading={testingOcr} onClick={() => void testOcrConnectivity()} icon={FileText}>测试 OCR</TestButton>
                  </div>
                )}

                <TestResult result={modelTest} title="模型测试" detail={modelTest?.ok ? `${modelTest.modelLabel ?? modelTest.model} 返回正常，耗时 ${modelTest.latency_ms}ms。` : modelTest?.error} />
                <TestResult result={ocrTest} title="OCR 测试" detail={ocrTest?.ok ? `识别到 ${ocrTest.characters} 个字符，耗时 ${ocrTest.latency_ms}ms。${ocrTest.preview ? ` 预览：${ocrTest.preview}` : ""}` : ocrTest?.error} />
                <TestResult result={digitalHumanTest} title="数字人测试" detail={digitalHumanTest?.ok ? `接口已返回任务 ${digitalHumanTest.provider_job_id ?? "-"}，状态 ${digitalHumanTest.status ?? "-"}。` : digitalHumanTest?.error} link={digitalHumanTest?.video_url} />
              </div>
            </div>
          </section>
        ) : null
      )}

      {activeView === "health" && (
        healthLoading && !health ? <PanelSkeleton rows={7} /> : health ? (
          <div className="space-y-4" data-testid="settings-health">
            <section className="ui-card grid divide-y divide-line sm:grid-cols-4 sm:divide-x sm:divide-y-0">
              <HealthMetric label="运行模式" value={health.mode === "demo" ? "演示" : "生产"} />
              <HealthMetric label="正常" value={healthSummary.ready} tone="good" />
              <HealthMetric label="待完善" value={healthSummary.warning} tone="warn" />
              <HealthMetric label="需处理" value={healthSummary.error} tone="bad" />
            </section>

            {Array.from(groupedChecks.entries()).map(([group, checks]) => (
              checks.length > 0 && (
                <section key={group} className="ui-card overflow-hidden">
                  <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
                    <h2 className="text-sm font-semibold text-ink">{groupLabel[group]}</h2>
                    <span className="text-xs text-slate-500">{checks.length} 项</span>
                  </div>
                  <div>{checks.map((check) => <HealthRow key={check.id} check={check} />)}</div>
                </section>
              )
            ))}
          </div>
        ) : <SettingsHealthEmptyState />
      )}
    </div>
  );
}

function ViewTab({ active, onClick, icon: Icon, children }: { active: boolean; onClick: () => void; icon: typeof Settings; children: React.ReactNode }) {
  return (
    <button type="button" role="tab" aria-selected={active} onClick={onClick} className={`flex min-h-10 items-center justify-center gap-2 rounded-lg px-3 text-sm font-semibold transition ${active ? "bg-white text-ink shadow-sm" : "text-slate-500 hover:text-ink"}`}>
      <Icon size={16} />
      {children}
    </button>
  );
}

function ConfigNavButton({ title, active, state, onClick }: { title: string; active: boolean; state: ConfigState; onClick: () => void }) {
  const Icon = groupIcons[title] ?? Settings;
  return (
    <button type="button" onClick={onClick} aria-current={active ? "page" : undefined} className={`flex min-h-11 w-full items-center gap-2 rounded-lg px-2.5 text-left transition ${active ? "bg-white text-ink shadow-sm ring-1 ring-line" : "text-slate-600 hover:bg-white/80 hover:text-ink"}`}>
      <Icon size={16} className={active ? "text-brand" : "text-slate-400"} />
      <span className="min-w-0 flex-1 truncate text-sm font-medium">{title}</span>
      <span className={`size-2 shrink-0 rounded-full ${state === "ready" ? "bg-emerald-500" : state === "partial" ? "bg-amber-500" : "bg-slate-300"}`} title={configStateLabel(state)} />
      <ChevronRight size={14} className="text-slate-400" />
    </button>
  );
}

function ConfigStateBadge({ state }: { state: ConfigState }) {
  const className = state === "ready" ? "bg-emerald-50 text-emerald-700" : state === "partial" ? "bg-amber-50 text-amber-700" : "bg-slate-100 text-slate-500";
  return <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${className}`}>{configStateLabel(state)}</span>;
}

function ConfigFieldInput({ field, value, disabled, onChange }: { field: ConfigField; value: string; disabled: boolean; onChange: (value: string) => void }) {
  const options = selectOptions[field.key];
  const commonClass = "w-full rounded-lg border border-line bg-white text-sm text-ink outline-none transition focus:border-brand focus:ring-2 focus:ring-cyan/20 disabled:bg-slate-50 disabled:text-slate-400";
  return (
    <label className={field.multiline ? "block lg:col-span-2" : "block"}>
      <span className="mb-1.5 block text-sm font-medium text-slate-700">{field.label}</span>
      {options ? (
        <select value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled} className={`${commonClass} h-11 px-3`}>
          {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      ) : field.multiline ? (
        <textarea value={value} onChange={(event) => onChange(event.target.value)} rows={field.key.includes("PAYLOAD_TEMPLATE") ? 5 : 3} placeholder={field.placeholder} disabled={disabled} spellCheck={false} className={`${commonClass} px-3 py-2 font-mono leading-6`} />
      ) : (
        <input value={value} onChange={(event) => onChange(event.target.value)} type={field.secret ? "password" : field.key === "MAX_UPLOAD_MB" ? "number" : "text"} min={field.key === "MAX_UPLOAD_MB" ? 1 : undefined} max={field.key === "MAX_UPLOAD_MB" ? 200 : undefined} placeholder={field.placeholder} disabled={disabled} className={`${commonClass} h-11 px-3`} />
      )}
      <span className="mt-1 block text-xs text-slate-400">{field.key}</span>
    </label>
  );
}

function TestButton({ loading, onClick, icon: Icon, children }: { loading: boolean; onClick: () => void; icon: typeof Settings; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} disabled={loading} className="ui-button-secondary h-10 shrink-0">
      {loading ? <Loader2 size={16} className="animate-spin" /> : <Icon size={16} />}
      {children}
    </button>
  );
}

function TestResult({ result, title, detail, link }: { result: { ok: boolean } | null; title: string; detail?: string | null; link?: string | null }) {
  if (!result) return null;
  return (
    <div className={`mt-4 flex items-start gap-3 rounded-lg border px-3 py-3 text-sm ${result.ok ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-red-200 bg-red-50 text-red-700"}`}>
      {result.ok ? <CheckCircle2 size={18} className="mt-0.5 shrink-0" /> : <AlertTriangle size={18} className="mt-0.5 shrink-0" />}
      <div className="min-w-0">
        <p className="font-semibold">{title}{result.ok ? "通过" : "未通过"}</p>
        {detail && <p className="mt-1 break-words leading-6">{detail}</p>}
        {link && <a href={link} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 font-medium underline">查看视频 <ExternalLink size={14} /></a>}
      </div>
    </div>
  );
}

function HealthMetric({ label, value, tone }: { label: string; value: React.ReactNode; tone?: "good" | "warn" | "bad" }) {
  const toneClass = tone === "good" ? "text-emerald-700" : tone === "warn" ? "text-amber-700" : tone === "bad" ? "text-red-700" : "text-ink";
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3 sm:block">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className={`text-lg font-semibold tabular-nums sm:mt-1 ${toneClass}`}>{value}</p>
    </div>
  );
}

function HealthRow({ check }: { check: HealthCheck }) {
  return (
    <article className="flex flex-col gap-3 border-b border-line px-4 py-3 last:border-b-0 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex min-w-0 items-start gap-3">
        <span className="mt-0.5 shrink-0"><StatusIcon status={check.status} /></span>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-ink">{check.name}</h3>
          <p className="mt-1 text-sm leading-6 text-slate-600">{check.detail}</p>
          {check.action && (
            <Link href={check.action.href} className="mt-2 inline-flex min-h-8 items-center gap-1 text-sm font-medium text-brand hover:underline">
              {check.action.label}<ExternalLink size={14} />
            </Link>
          )}
        </div>
      </div>
      <div className="shrink-0 sm:pl-4"><StatusBadge status={check.status} /></div>
    </article>
  );
}

function SettingsHealthEmptyState() {
  return (
    <section className="rounded-lg border border-dashed border-line bg-white p-6 text-center">
      <Activity size={20} className="mx-auto text-brand" />
      <h2 className="mt-3 text-base font-semibold text-ink">暂无运行检查结果</h2>
      <p className="mt-1 text-sm text-slate-500">点击“重新检查”读取当前服务状态。</p>
    </section>
  );
}
