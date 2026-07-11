"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ChevronRight,
  CheckCircle2,
  CircleAlert,
  ExternalLink,
  FileText,
  Loader2,
  MessageSquare,
  RefreshCw,
  Save,
  Settings,
  ShieldCheck,
  Video,
  Volume2,
  XCircle
} from "lucide-react";
import { fetchWithRetry } from "@/lib/client-fetch";
import type { HealthCheck, HealthStatus, SystemHealth } from "@/lib/health";
import type { EditableEnvSettings } from "@/lib/env-settings";
import { ErrorRetry, PanelSkeleton, useToast } from "@/components/ui-feedback";

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
    provider: string;
    model: string;
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
  cover_url: string | null;
  model: string;
  avatar_id: string;
  voice_id: string;
  error: string | null;
};

const emptySettings: EditableEnvSettings = {
  NEXT_PUBLIC_SUPABASE_URL: "",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "",
  SUPABASE_SERVICE_ROLE_KEY: "",
  SUPABASE_ADMIN_EMAILS: "",
  OPENAI_API_KEY: "",
  OPENAI_CHAT_MODEL: "gpt-5.5",
  OPENAI_TTS_MODEL: "gpt-4o-mini-tts",
  OPENAI_TTS_VOICE: "coral",
  TTS_PROVIDER: "openai",
  TTS_API_URL: "",
  TTS_STATUS_URL: "",
  TTS_API_KEY: "",
  TTS_AUTH_HEADER: "Authorization",
  TTS_HEADERS: "",
  TTS_PAYLOAD_TEMPLATE: "",
  TTS_MODEL: "",
  TTS_VOICE: "",
  AI_CHAT_PROVIDER: "openai",
  AI_CHAT_BASE_URL: "",
  AI_CHAT_API_KEY: "",
  AI_CHAT_MODEL: "",
  AI_CHAT_FALLBACK_1_PROVIDER: "none",
  AI_CHAT_FALLBACK_1_BASE_URL: "",
  AI_CHAT_FALLBACK_1_API_KEY: "",
  AI_CHAT_FALLBACK_1_MODEL: "",
  AI_CHAT_FALLBACK_2_PROVIDER: "none",
  AI_CHAT_FALLBACK_2_BASE_URL: "",
  AI_CHAT_FALLBACK_2_API_KEY: "",
  AI_CHAT_FALLBACK_2_MODEL: "",
  OCR_PROVIDER: "none",
  OCR_API_URL: "",
  OCR_API_KEY: "",
  OCR_AUTH_HEADER: "Authorization",
  OCR_HEADERS: "",
  OCR_REQUEST_FORMAT: "multipart",
  OCR_FILE_FIELD: "file",
  OCR_MODEL_FIELD: "model",
  OCR_PROVIDER_FIELD: "provider",
  OCR_PAYLOAD_TEMPLATE: "",
  OCR_MODEL: "",
  RAG_PROVIDER: "openai_file_search",
  RAG_RETRIEVAL_STRATEGY: "balanced",
  DIGITAL_HUMAN_PROVIDER: "none",
  DIGITAL_HUMAN_API_URL: "",
  DIGITAL_HUMAN_STATUS_URL: "",
  DIGITAL_HUMAN_API_KEY: "",
  DIGITAL_HUMAN_AUTH_HEADER: "Authorization",
  DIGITAL_HUMAN_HEADERS: "",
  DIGITAL_HUMAN_PAYLOAD_TEMPLATE: "",
  DIGITAL_HUMAN_MODEL: "",
  DIGITAL_HUMAN_AVATAR_ID: "",
  DIGITAL_HUMAN_VOICE_ID: "",
  SSO_PROVIDER: "none",
  SSO_AUTHORIZE_URL: "",
  SSO_TOKEN_URL: "",
  SSO_USERINFO_URL: "",
  SSO_CLIENT_ID: "",
  SSO_CLIENT_SECRET: "",
  SSO_SCOPES: "openid profile email",
  SSO_DEFAULT_DEPARTMENT: "",
  LDAP_PROVIDER: "none",
  LDAP_URL: "",
  LDAP_BIND_DN: "",
  LDAP_BIND_PASSWORD: "",
  LDAP_SEARCH_BASE: "",
  LDAP_SEARCH_FILTER: "(|(mail={{login}})(uid={{login}})(sAMAccountName={{login}}))",
  LDAP_USER_DN_TEMPLATE: "",
  LDAP_EMAIL_ATTRIBUTE: "mail",
  LDAP_NAME_ATTRIBUTE: "displayName",
  LDAP_DEPARTMENT_ATTRIBUTE: "department",
  LDAP_POSITION_ATTRIBUTE: "title",
  LDAP_DEFAULT_DOMAIN: "",
  DATABASE_PROVIDER: "memory",
  MYSQL_HOST: "",
  MYSQL_PORT: "3306",
  MYSQL_DATABASE: "",
  MYSQL_USER: "",
  MYSQL_PASSWORD: "",
  AUTH_SECRET: "",
  APP_BASE_URL: "http://localhost:3000",
  MAX_UPLOAD_MB: "20"
};

const configGroups: Array<{
  title: string;
  description: string;
  fields: Array<{
    key: keyof EditableEnvSettings;
    label: string;
    placeholder?: string;
    secret?: boolean;
  }>;
}> = [
  {
    title: "Supabase",
    description: "可选。用于登录、数据库、资料文件和语音缓存。",
    fields: [
      {
        key: "NEXT_PUBLIC_SUPABASE_URL",
        label: "Project URL",
        placeholder: "https://xxxxx.supabase.co"
      },
      {
        key: "NEXT_PUBLIC_SUPABASE_ANON_KEY",
        label: "Anon Key",
        secret: true
      },
      {
        key: "SUPABASE_SERVICE_ROLE_KEY",
        label: "Service Role Key",
        secret: true
      },
      {
        key: "SUPABASE_ADMIN_EMAILS",
        label: "管理员邮箱",
        placeholder: "admin@company.com,hr@company.com"
      }
    ]
  },
  {
    title: "自定义数据库",
    description: "使用自己的 MySQL 数据库保存业务数据。",
    fields: [
      {
        key: "DATABASE_PROVIDER",
        label: "Database Provider",
        placeholder: "mysql"
      },
      {
        key: "MYSQL_HOST",
        label: "MySQL Host"
      },
      {
        key: "MYSQL_PORT",
        label: "MySQL Port",
        placeholder: "3306"
      },
      {
        key: "MYSQL_DATABASE",
        label: "数据库名"
      },
      {
        key: "MYSQL_USER",
        label: "用户名"
      },
      {
        key: "MYSQL_PASSWORD",
        label: "密码",
        secret: true
      },
      {
        key: "AUTH_SECRET",
        label: "登录会话密钥",
        placeholder: "生产环境建议填写随机长字符串",
        secret: true
      }
    ]
  },
  {
    title: "统一身份认证",
    description: "可选。通过 OIDC 接入企业微信、钉钉、飞书或统一身份平台。",
    fields: [
      {
        key: "SSO_PROVIDER",
        label: "SSO Provider",
        placeholder: "none 或 oidc"
      },
      {
        key: "SSO_AUTHORIZE_URL",
        label: "授权地址",
        placeholder: "https://idp.example.com/oauth2/authorize"
      },
      {
        key: "SSO_TOKEN_URL",
        label: "Token 地址",
        placeholder: "https://idp.example.com/oauth2/token"
      },
      {
        key: "SSO_USERINFO_URL",
        label: "用户信息地址",
        placeholder: "https://idp.example.com/oauth2/userinfo"
      },
      {
        key: "SSO_CLIENT_ID",
        label: "Client ID"
      },
      {
        key: "SSO_CLIENT_SECRET",
        label: "Client Secret",
        secret: true
      },
      {
        key: "SSO_SCOPES",
        label: "Scopes",
        placeholder: "openid profile email"
      },
      {
        key: "SSO_DEFAULT_DEPARTMENT",
        label: "默认部门",
        placeholder: "身份平台未返回部门时使用"
      }
    ]
  },
  {
    title: "LDAP / AD 登录",
    description: "可选。直连企业 LDAP 或 Active Directory。支持服务账号搜索后绑定，也支持用户 DN 模板直接绑定。",
    fields: [
      {
        key: "LDAP_PROVIDER",
        label: "LDAP Provider",
        placeholder: "none 或 custom"
      },
      {
        key: "LDAP_URL",
        label: "LDAP URL",
        placeholder: "ldap://ad.company.local:389 或 ldaps://ad.company.local:636"
      },
      {
        key: "LDAP_BIND_DN",
        label: "服务账号 DN",
        placeholder: "cn=reader,ou=system,dc=company,dc=local"
      },
      {
        key: "LDAP_BIND_PASSWORD",
        label: "服务账号密码",
        secret: true
      },
      {
        key: "LDAP_SEARCH_BASE",
        label: "搜索 Base DN",
        placeholder: "ou=users,dc=company,dc=local"
      },
      {
        key: "LDAP_SEARCH_FILTER",
        label: "搜索 Filter",
        placeholder: "(|(mail={{login}})(uid={{login}})(sAMAccountName={{login}}))"
      },
      {
        key: "LDAP_USER_DN_TEMPLATE",
        label: "用户 DN 模板",
        placeholder: "可选，例如 uid={{login}},ou=users,dc=company,dc=local"
      },
      {
        key: "LDAP_EMAIL_ATTRIBUTE",
        label: "邮箱属性",
        placeholder: "mail"
      },
      {
        key: "LDAP_NAME_ATTRIBUTE",
        label: "姓名属性",
        placeholder: "displayName"
      },
      {
        key: "LDAP_DEPARTMENT_ATTRIBUTE",
        label: "部门属性",
        placeholder: "department"
      },
      {
        key: "LDAP_POSITION_ATTRIBUTE",
        label: "岗位属性",
        placeholder: "title"
      },
      {
        key: "LDAP_DEFAULT_DOMAIN",
        label: "默认邮箱域",
        placeholder: "company.com"
      }
    ]
  },
  {
    title: "OpenAI",
    description: "用于 Vector Store、File Search、默认模型能力，也可作为 TTS 供应商。",
    fields: [
      {
        key: "OPENAI_API_KEY",
        label: "API Key",
        secret: true
      },
      {
        key: "OPENAI_CHAT_MODEL",
        label: "对话模型",
        placeholder: "gpt-5.5"
      },
      {
        key: "OPENAI_TTS_MODEL",
        label: "TTS 模型",
        placeholder: "gpt-4o-mini-tts"
      },
      {
        key: "OPENAI_TTS_VOICE",
        label: "TTS 语音",
        placeholder: "coral"
      }
    ]
  },
  {
    title: "自定义语音 TTS",
    description: "用于接入国产或第三方文本转语音接口，替代 OpenAI TTS。",
    fields: [
      {
        key: "TTS_PROVIDER",
        label: "TTS Provider",
        placeholder: "openai 或 custom"
      },
      {
        key: "TTS_API_URL",
        label: "TTS API URL",
        placeholder: "https://api.example.com/tts"
      },
      {
        key: "TTS_STATUS_URL",
        label: "TTS 状态 URL",
        placeholder: "可选，例如 https://api.example.com/tts/{task_id}"
      },
      {
        key: "TTS_API_KEY",
        label: "TTS API Key",
        secret: true
      },
      {
        key: "TTS_AUTH_HEADER",
        label: "认证头名",
        placeholder: "Authorization / X-API-Key / api-key / none"
      },
      {
        key: "TTS_HEADERS",
        label: "额外请求头 JSON",
        placeholder: "{\"X-Client\":\"tianrui\",\"api-key\":\"{{api_key}}\"}"
      },
      {
        key: "TTS_PAYLOAD_TEMPLATE",
        label: "请求体模板 JSON",
        placeholder: "{\"text\":\"{{text}}\",\"voice\":\"{{voice}}\",\"model\":\"{{model}}\"}"
      },
      {
        key: "TTS_MODEL",
        label: "TTS 模型",
        placeholder: "可选，例如 cosyvoice-v1"
      },
      {
        key: "TTS_VOICE",
        label: "TTS 音色",
        placeholder: "可选，例如 female-1"
      }
    ]
  },
  {
    title: "自定义对话模型",
    description: "用于接入 DeepSeek、智谱、讯飞、阿里等 OpenAI-compatible 聊天接口。",
    fields: [
      {
        key: "AI_CHAT_PROVIDER",
        label: "Provider",
        placeholder: "openai 或 custom"
      },
      {
        key: "AI_CHAT_BASE_URL",
        label: "Base URL",
        placeholder: "https://api.example.com/v1"
      },
      {
        key: "AI_CHAT_API_KEY",
        label: "API Key",
        secret: true
      },
      {
        key: "AI_CHAT_MODEL",
        label: "模型 ID",
        placeholder: "deepseek-chat / glm-4-plus / qwen-plus"
      },
      {
        key: "AI_CHAT_FALLBACK_1_PROVIDER",
        label: "备用 1 Provider",
        placeholder: "none / openai / custom"
      },
      {
        key: "AI_CHAT_FALLBACK_1_BASE_URL",
        label: "备用 1 Base URL",
        placeholder: "custom 时填写，例如 https://api.example.com/v1"
      },
      {
        key: "AI_CHAT_FALLBACK_1_API_KEY",
        label: "备用 1 API Key",
        secret: true
      },
      {
        key: "AI_CHAT_FALLBACK_1_MODEL",
        label: "备用 1 模型 ID",
        placeholder: "主模型失败后自动尝试"
      },
      {
        key: "AI_CHAT_FALLBACK_2_PROVIDER",
        label: "备用 2 Provider",
        placeholder: "none / openai / custom"
      },
      {
        key: "AI_CHAT_FALLBACK_2_BASE_URL",
        label: "备用 2 Base URL",
        placeholder: "custom 时填写"
      },
      {
        key: "AI_CHAT_FALLBACK_2_API_KEY",
        label: "备用 2 API Key",
        secret: true
      },
      {
        key: "AI_CHAT_FALLBACK_2_MODEL",
        label: "备用 2 模型 ID",
        placeholder: "备用 1 失败后自动尝试"
      }
    ]
  },
  {
    title: "OCR 扫描件识别",
    description: "可选。用于 PDF 扫描件或图片型资料的文字识别。",
    fields: [
      {
        key: "OCR_PROVIDER",
        label: "OCR Provider",
        placeholder: "none 或 custom"
      },
      {
        key: "OCR_API_URL",
        label: "OCR API URL",
        placeholder: "https://api.example.com/ocr"
      },
      {
        key: "OCR_API_KEY",
        label: "OCR API Key",
        secret: true
      },
      {
        key: "OCR_AUTH_HEADER",
        label: "认证头名",
        placeholder: "Authorization / X-API-Key / api-key / none"
      },
      {
        key: "OCR_HEADERS",
        label: "额外请求头 JSON",
        placeholder: "{\"X-Client\":\"tianrui\",\"api-key\":\"{{api_key}}\"}"
      },
      {
        key: "OCR_REQUEST_FORMAT",
        label: "请求格式",
        placeholder: "multipart 或 json_base64"
      },
      {
        key: "OCR_FILE_FIELD",
        label: "文件字段名",
        placeholder: "file / image / image_file"
      },
      {
        key: "OCR_MODEL_FIELD",
        label: "模型字段名",
        placeholder: "model"
      },
      {
        key: "OCR_PROVIDER_FIELD",
        label: "供应商字段名",
        placeholder: "provider，可填 none 关闭"
      },
      {
        key: "OCR_PAYLOAD_TEMPLATE",
        label: "JSON 请求体模板",
        placeholder: "{\"image\":\"{{file_base64}}\",\"filename\":\"{{file_name}}\"}"
      },
      {
        key: "OCR_MODEL",
        label: "OCR 模型",
        placeholder: "可选"
      }
    ]
  },
  {
    title: "数字人视频",
    description: "可选。接入第三方数字人服务，把 PPT 讲稿生成讲解视频。",
    fields: [
      {
        key: "DIGITAL_HUMAN_PROVIDER",
        label: "Provider",
        placeholder: "none 或 custom"
      },
      {
        key: "DIGITAL_HUMAN_API_URL",
        label: "生成 API URL",
        placeholder: "https://api.example.com/avatar/videos"
      },
      {
        key: "DIGITAL_HUMAN_STATUS_URL",
        label: "状态 API URL",
        placeholder: "可选，例如 https://api.example.com/avatar/videos/{job_id}"
      },
      {
        key: "DIGITAL_HUMAN_API_KEY",
        label: "API Key",
        secret: true
      },
      {
        key: "DIGITAL_HUMAN_AUTH_HEADER",
        label: "认证头名",
        placeholder: "Authorization / X-API-Key / api-key / none"
      },
      {
        key: "DIGITAL_HUMAN_HEADERS",
        label: "额外请求头 JSON",
        placeholder: "{\"X-Client\":\"tianrui\",\"api-key\":\"{{api_key}}\"}"
      },
      {
        key: "DIGITAL_HUMAN_PAYLOAD_TEMPLATE",
        label: "请求体模板 JSON",
        placeholder: "{\"title\":\"{{title}}\",\"script\":\"{{script}}\",\"avatar_id\":\"{{avatar_id}}\"}"
      },
      {
        key: "DIGITAL_HUMAN_MODEL",
        label: "模型 ID",
        placeholder: "可选"
      },
      {
        key: "DIGITAL_HUMAN_AVATAR_ID",
        label: "形象 ID",
        placeholder: "可选"
      },
      {
        key: "DIGITAL_HUMAN_VOICE_ID",
        label: "音色 ID",
        placeholder: "可选"
      }
    ]
  },
  {
    title: "RAG 检索模式",
    description: "选择知识库检索方式，并为本地文本 RAG 灰度切换召回权重。",
    fields: [
      {
        key: "RAG_PROVIDER",
        label: "RAG Provider",
        placeholder: "openai_file_search 或 local_text"
      },
      {
        key: "RAG_RETRIEVAL_STRATEGY",
        label: "本地 RAG 召回策略",
        placeholder: "balanced / content_first / governance_enhanced / synonym_expanded"
      }
    ]
  },
  {
    title: "应用参数",
    description: "用于本地地址和上传限制。",
    fields: [
      {
        key: "APP_BASE_URL",
        label: "应用地址",
        placeholder: "http://localhost:3000"
      },
      {
        key: "MAX_UPLOAD_MB",
        label: "上传上限 MB",
        placeholder: "20"
      }
    ]
  }
];

const multilineConfigKeys = new Set<keyof EditableEnvSettings>([
  "TTS_HEADERS",
  "TTS_PAYLOAD_TEMPLATE",
  "OCR_HEADERS",
  "OCR_PAYLOAD_TEMPLATE",
  "DIGITAL_HUMAN_HEADERS",
  "DIGITAL_HUMAN_PAYLOAD_TEMPLATE"
]);

type ProviderPreset = {
  title: string;
  description: string;
  settings: Partial<EditableEnvSettings>;
};

const providerPresets: ProviderPreset[] = [
  {
    title: "TTS Bearer JSON",
    description: "适合多数以 Authorization Bearer 鉴权的语音接口。",
    settings: {
      TTS_PROVIDER: "custom",
      TTS_AUTH_HEADER: "Authorization",
      TTS_HEADERS: "",
      TTS_PAYLOAD_TEMPLATE: "{\"text\":\"{{text}}\",\"input\":\"{{input}}\",\"voice\":\"{{voice}}\",\"model\":\"{{model}}\",\"format\":\"mp3\"}"
    }
  },
  {
    title: "TTS X-API-Key",
    description: "适合要求 X-API-Key 或 api-key 鉴权的语音接口。",
    settings: {
      TTS_PROVIDER: "custom",
      TTS_AUTH_HEADER: "X-API-Key",
      TTS_HEADERS: "",
      TTS_PAYLOAD_TEMPLATE: "{\"text\":\"{{text}}\",\"voice\":\"{{voice}}\",\"model\":\"{{model}}\",\"format\":\"mp3\"}"
    }
  },
  {
    title: "讯飞在线语音合成",
    description: "适合科大讯飞 WebSocket TTS，填写 AppID、APIKey、APISecret 和发音人。",
    settings: {
      TTS_PROVIDER: "custom",
      TTS_API_URL: "wss://tts-api.xfyun.cn/v2/tts",
      TTS_STATUS_URL: "",
      TTS_AUTH_HEADER: "none",
      TTS_HEADERS: "{\"XFYUN_APP_ID\":\"\",\"XFYUN_API_SECRET\":\"\"}",
      TTS_PAYLOAD_TEMPLATE: "",
      TTS_MODEL: "xfyun-online-tts",
      TTS_VOICE: "x4_yezi"
    }
  },
  {
    title: "OCR Multipart",
    description: "适合上传图片或 PDF 文件字段的 OCR 接口。",
    settings: {
      OCR_PROVIDER: "custom",
      OCR_AUTH_HEADER: "Authorization",
      OCR_REQUEST_FORMAT: "multipart",
      OCR_FILE_FIELD: "file",
      OCR_MODEL_FIELD: "model",
      OCR_PROVIDER_FIELD: "none",
      OCR_PAYLOAD_TEMPLATE: ""
    }
  },
  {
    title: "OCR JSON Base64",
    description: "适合要求把图片转 base64 放进 JSON 的 OCR 接口。",
    settings: {
      OCR_PROVIDER: "custom",
      OCR_AUTH_HEADER: "Authorization",
      OCR_REQUEST_FORMAT: "json_base64",
      OCR_FILE_FIELD: "file",
      OCR_MODEL_FIELD: "model",
      OCR_PROVIDER_FIELD: "none",
      OCR_PAYLOAD_TEMPLATE: "{\"image\":\"{{file_base64}}\",\"filename\":\"{{file_name}}\",\"mime_type\":\"{{mime_type}}\",\"model\":\"{{model}}\"}"
    }
  },
  {
    title: "多模态文件识别 JSON",
    description: "适合 OpenAI-compatible 多模态接口识别图片或 PDF，返回 choices/message/content。",
    settings: {
      OCR_PROVIDER: "custom",
      OCR_AUTH_HEADER: "Authorization",
      OCR_HEADERS: "",
      OCR_REQUEST_FORMAT: "json_base64",
      OCR_FILE_FIELD: "file",
      OCR_MODEL_FIELD: "model",
      OCR_PROVIDER_FIELD: "none",
      OCR_PAYLOAD_TEMPLATE: "{\"model\":\"{{model}}\",\"messages\":[{\"role\":\"user\",\"content\":[{\"type\":\"text\",\"text\":\"请识别这个文件中的全部文字，按页输出，保留标题、表格、编号和关键字段。只返回可入库的正文，不要解释过程。文件名：{{file_name}}，MIME：{{mime_type}}\"},{\"type\":\"file\",\"file\":{\"filename\":\"{{file_name}}\",\"file_data\":\"{{file_data_url}}\"}}]}]}"
    }
  },
  {
    title: "数字人 Bearer 异步",
    description: "适合提交讲稿后返回 task_id/job_id 的数字人生成接口。",
    settings: {
      DIGITAL_HUMAN_PROVIDER: "custom",
      DIGITAL_HUMAN_AUTH_HEADER: "Authorization",
      DIGITAL_HUMAN_HEADERS: "",
      DIGITAL_HUMAN_PAYLOAD_TEMPLATE: "{\"title\":\"{{title}}\",\"script\":\"{{script}}\",\"avatar_id\":\"{{avatar_id}}\",\"voice_id\":\"{{voice_id}}\",\"model\":\"{{model}}\",\"slides\":{{slides_json}}}"
    }
  },
  {
    title: "数字人 X-API-Key",
    description: "适合要求 X-API-Key 鉴权的数字人生成接口。",
    settings: {
      DIGITAL_HUMAN_PROVIDER: "custom",
      DIGITAL_HUMAN_AUTH_HEADER: "X-API-Key",
      DIGITAL_HUMAN_HEADERS: "",
      DIGITAL_HUMAN_PAYLOAD_TEMPLATE: "{\"title\":\"{{title}}\",\"text\":\"{{script}}\",\"avatar_id\":\"{{avatar_id}}\",\"voice_id\":\"{{voice_id}}\"}"
    }
  }
];

const groupLabel: Record<HealthCheck["group"], string> = {
  database: "数据库",
  supabase: "Supabase",
  openai: "OpenAI",
  user: "账号权限",
  workflow: "业务流程"
};

const statusLabel: Record<HealthStatus, string> = {
  ready: "已就绪",
  warning: "待完善",
  error: "需处理"
};

const statusClass: Record<HealthStatus, string> = {
  ready: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  warning: "bg-amber-50 text-amber-700 ring-amber-200",
  error: "bg-red-50 text-red-700 ring-red-200"
};

const iconClass: Record<HealthStatus, string> = {
  ready: "text-emerald-600",
  warning: "text-amber-600",
  error: "text-red-600"
};

function StatusIcon({ status }: { status: HealthStatus }) {
  if (status === "ready") {
    return <CheckCircle2 size={18} className={iconClass.ready} />;
  }

  if (status === "error") {
    return <XCircle size={18} className={iconClass.error} />;
  }

  return <CircleAlert size={18} className={iconClass.warning} />;
}

function StatusBadge({ status }: { status: HealthStatus }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${statusClass[status]}`}>
      {statusLabel[status]}
    </span>
  );
}

function CheckCard({ check }: { check: HealthCheck }) {
  return (
    <article className="ui-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="mt-0.5 shrink-0">
            <StatusIcon status={check.status} />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold text-ink">{check.name}</h3>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
                {groupLabel[check.group]}
              </span>
            </div>
            <p className="mt-2 text-sm leading-6 text-slate-600">{check.detail}</p>
          </div>
        </div>
        <StatusBadge status={check.status} />
      </div>
      {check.action && (
        <Link
          href={check.action.href}
          className="mt-4 ui-button-secondary h-9 px-3"
        >
          {check.action.label}
          <ExternalLink size={15} />
        </Link>
      )}
    </article>
  );
}

function ModelTestCard({ result }: { result: ModelTestResult }) {
  return (
    <section className={`rounded-lg border p-4 text-sm ${
      result.ok ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-red-200 bg-red-50 text-red-700"
    }`}>
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="flex items-start gap-3">
          {result.ok ? (
            <CheckCircle2 size={19} className="mt-0.5 shrink-0 text-emerald-700" />
          ) : (
            <AlertTriangle size={19} className="mt-0.5 shrink-0 text-red-700" />
          )}
          <div>
            <h2 className="font-semibold">{result.ok ? "模型连通正常" : "模型连通失败"}</h2>
            <p className="mt-1 leading-6">
              {result.ok
                ? `当前模型可以返回回答，耗时 ${result.latency_ms}ms。`
                : result.error ?? "模型测试失败，请检查 Base URL、API Key、模型 ID 或网络访问。"}
            </p>
            {result.answer && (
              <p className="mt-2 rounded-lg bg-white/70 px-3 py-2 leading-6 text-slate-700">
                返回：{result.answer}
              </p>
            )}
            {result.attempts.length > 0 && (
              <div className="mt-3 grid gap-2">
                {result.attempts.map((attempt) => (
                  <div
                    key={`${attempt.role}-${attempt.index}-${attempt.model}`}
                    className="flex flex-col gap-2 rounded-lg bg-white/75 px-3 py-2 text-xs text-slate-700 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <span className={`mr-2 inline-flex rounded-full px-2 py-0.5 font-semibold ${
                        attempt.ok ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"
                      }`}>
                        {attempt.ok ? "成功" : "失败"}
                      </span>
                      <span className="font-medium">
                        {attempt.role === "primary" ? "主模型" : `备用 ${attempt.index}`}
                      </span>
                      <span className="ml-2 break-all text-slate-500">{attempt.label}</span>
                    </div>
                    {attempt.error && (
                      <span className="break-all text-red-700 sm:max-w-[360px] sm:text-right">{attempt.error}</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="shrink-0 rounded-lg bg-white/70 px-3 py-2 text-xs leading-5 text-slate-600">
          <p>供应商：{result.provider}</p>
          <p>模型：{result.model || "-"}</p>
          <p>标签：{result.modelLabel ?? "-"}</p>
        </div>
      </div>
    </section>
  );
}

function OcrTestCard({ result }: { result: OcrTestResult }) {
  return (
    <section className={`rounded-lg border p-4 text-sm ${
      result.ok ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-red-200 bg-red-50 text-red-700"
    }`}>
      <div className="flex items-start gap-3">
        {result.ok ? (
          <CheckCircle2 size={19} className="mt-0.5 shrink-0 text-emerald-700" />
        ) : (
          <AlertTriangle size={19} className="mt-0.5 shrink-0 text-red-700" />
        )}
        <div>
          <h2 className="font-semibold">{result.ok ? "OCR 连通正常" : "OCR 连通失败"}</h2>
          <p className="mt-1 leading-6">
            {result.ok
              ? `识别到 ${result.sections} 段、${result.characters} 个字符，耗时 ${result.latency_ms}ms。`
              : result.error ?? "OCR 测试失败，请检查 API URL、API Key、模型或网络访问。"}
          </p>
          {result.preview && (
            <p className="mt-2 max-h-32 overflow-auto rounded-lg bg-white/70 px-3 py-2 leading-6 text-slate-700">
              预览：{result.preview}
            </p>
          )}
          <p className="mt-2 text-xs text-slate-600">模型：{result.model || "-"}</p>
        </div>
      </div>
    </section>
  );
}

function DigitalHumanTestCard({ result }: { result: DigitalHumanTestResult }) {
  return (
    <section className={`rounded-lg border p-4 text-sm ${
      result.ok ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-red-200 bg-red-50 text-red-700"
    }`}>
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="flex items-start gap-3">
          {result.ok ? (
            <CheckCircle2 size={19} className="mt-0.5 shrink-0 text-emerald-700" />
          ) : (
            <AlertTriangle size={19} className="mt-0.5 shrink-0 text-red-700" />
          )}
          <div>
            <h2 className="font-semibold">{result.ok ? "数字人接口连通正常" : "数字人接口连通失败"}</h2>
            <p className="mt-1 leading-6">
              {result.ok
                ? `接口已返回有效任务或视频信息，耗时 ${result.latency_ms}ms。`
                : result.error ?? "数字人测试失败，请检查生成 API URL、API Key、形象、音色或网络访问。"}
            </p>
            {result.video_url && (
              <a
                href={result.video_url}
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-flex items-center gap-1 rounded-lg bg-white/70 px-3 py-2 text-xs font-medium text-slate-700 underline-offset-4 hover:underline"
              >
                查看返回视频
                <ExternalLink size={14} />
              </a>
            )}
          </div>
        </div>
        <div className="shrink-0 rounded-lg bg-white/70 px-3 py-2 text-xs leading-5 text-slate-600">
          <p>任务号：{result.provider_job_id ?? "-"}</p>
          <p>状态：{result.status ?? "-"}</p>
          <p>模型：{result.model || "-"}</p>
          <p>形象：{result.avatar_id || "-"}</p>
          <p>音色：{result.voice_id || "-"}</p>
        </div>
      </div>
    </section>
  );
}

export function SettingsWizard() {
  const configSectionRef = useRef<HTMLElement | null>(null);
  const presetConfigRef = useRef<HTMLDivElement | null>(null);
  const configGroupPanelRef = useRef<HTMLDivElement | null>(null);
  const { pushToast } = useToast();
  const [health, setHealth] = useState<SystemHealth | null>(null);
  const [settings, setSettings] = useState<EditableEnvSettings>(emptySettings);
  const [envPath, setEnvPath] = useState("");
  const [loading, setLoading] = useState(true);
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testingModel, setTestingModel] = useState(false);
  const [testingOcr, setTestingOcr] = useState(false);
  const [testingTts, setTestingTts] = useState(false);
  const [testingDigitalHuman, setTestingDigitalHuman] = useState(false);
  const [modelTest, setModelTest] = useState<ModelTestResult | null>(null);
  const [ocrTest, setOcrTest] = useState<OcrTestResult | null>(null);
  const [digitalHumanTest, setDigitalHumanTest] = useState<DigitalHumanTestResult | null>(null);
  const [ocrFile, setOcrFile] = useState<File | null>(null);
  const [ttsText, setTtsText] = useState("西安天瑞汽车内饰件有限公司智能客服语音试听正常。");
  const [ttsAudioUrl, setTtsAudioUrl] = useState<string | null>(null);
  const [ttsResult, setTtsResult] = useState<{ contentType: string; bytes: number } | null>(null);
  const [healthLoadError, setHealthLoadError] = useState<string | null>(null);
  const [settingsLoadError, setSettingsLoadError] = useState<string | null>(null);
  const [activePresetTitle, setActivePresetTitle] = useState<string | null>(null);
  const [activeConfigGroupTitle, setActiveConfigGroupTitle] = useState<string | null>(null);

  useEffect(() => {
    void loadAll();
  }, []);

  const groupedChecks = useMemo(() => {
    const groups: Record<HealthCheck["group"], HealthCheck[]> = {
      database: [],
      supabase: [],
      openai: [],
      user: [],
      workflow: []
    };

    for (const check of health?.checks ?? []) {
      groups[check.group].push(check);
    }

    return groups;
  }, [health]);
  const activePreset = useMemo(
    () => providerPresets.find((preset) => preset.title === activePresetTitle) ?? null,
    [activePresetTitle]
  );
  const activeConfigGroup = useMemo(
    () => configGroups.find((group) => group.title === activeConfigGroupTitle) ?? null,
    [activeConfigGroupTitle]
  );
  const isOcrPreset = Boolean(activePreset?.settings.OCR_PROVIDER);
  const isTtsPreset = Boolean(activePreset?.settings.TTS_PROVIDER);
  const showSettingsSkeleton = settingsLoading && !settingsLoaded;
  const showSettingsForm = settingsLoaded || (!settingsLoading && !settingsLoadError);

  async function loadHealth() {
    setLoading(true);
    setHealthLoadError(null);

    try {
      const response = await fetchWithRetry("/api/system/health", { cache: "no-store" });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "配置检查失败");
      }

      setHealth(data.health);
    } catch (loadError) {
      setHealthLoadError(loadError instanceof Error ? loadError.message : "配置检查失败");
    } finally {
      setLoading(false);
    }
  }

  async function loadSettings() {
    setSettingsLoading(true);
    setSettingsLoadError(null);

    try {
      const response = await fetchWithRetry("/api/system/settings", { cache: "no-store" }, { timeoutMs: 10000 });
      const data = (await response.json()) as SettingsResponse & { error?: string };

      if (!response.ok) {
        throw new Error(data.error ?? "读取配置失败");
      }

      setSettings(data.envFile.settings);
      setEnvPath(data.envFile.path);
      setSettingsLoaded(true);
    } catch (loadError) {
      setSettingsLoadError(loadError instanceof Error ? loadError.message : "读取配置失败");
    } finally {
      setSettingsLoading(false);
    }
  }

  async function loadAll() {
    await Promise.all([loadSettings(), loadHealth()]);
  }

  function updateSetting(key: keyof EditableEnvSettings, value: string) {
    setSettings((current) => ({
      ...current,
      [key]: value
    }));
  }

  function applyProviderPreset(preset: ProviderPreset) {
    setSettings((current) => ({
      ...current,
      ...preset.settings
    }));
    setActivePresetTitle(preset.title);
    if (preset.settings.TTS_PROVIDER) {
      setActiveConfigGroupTitle("自定义语音 TTS");
    }
    if (preset.settings.OCR_PROVIDER) {
      setActiveConfigGroupTitle("OCR 扫描件识别");
    }
    pushToast({
      tone: "info",
      title: `已套用预设：${preset.title}`,
      description: "请在下方配置表单里补全真实参数，然后保存配置。"
    });

    window.setTimeout(() => {
      presetConfigRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 80);
  }

  function openConfigGroup(title: string) {
    setActiveConfigGroupTitle(title);

    window.setTimeout(() => {
      configGroupPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 80);
  }

  async function saveSettings() {
    setSaving(true);
    setSettingsLoadError(null);

    try {
      const response = await fetch("/api/system/settings", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ settings })
      });
      const data = (await response.json()) as SettingsResponse & { error?: string; notice?: string };

      if (!response.ok) {
        throw new Error(data.error ?? "保存配置失败");
      }

      setSettings(data.envFile.settings);
      setEnvPath(data.envFile.path);
      pushToast({
        tone: "success",
        title: "配置已保存",
        description: data.notice ?? (data.envFile.path ? `配置文件：${data.envFile.path}` : "建议重新检查一次系统状态。")
      });
    } catch (saveError) {
      pushToast({
        tone: "error",
        title: "保存配置失败",
        description: saveError instanceof Error ? saveError.message : "请检查配置内容后重试。"
      });
    } finally {
      setSaving(false);
    }
  }

  async function testModelConnectivity() {
    setTestingModel(true);
    setModelTest(null);

    try {
      const response = await fetch("/api/system/model-test", {
        method: "POST"
      });
      const data = (await response.json()) as { result?: ModelTestResult; error?: string };

      if (!response.ok && !data.result) {
        throw new Error(data.error ?? "模型连通性测试失败");
      }

      setModelTest(data.result ?? null);
      pushToast({
        tone: data.result?.ok ? "success" : "warning",
        title: data.result?.ok ? "对话模型可用" : "对话模型检测未通过",
        description: data.result?.error ?? `${data.result?.modelLabel ?? data.result?.model ?? "当前模型"} 已完成连通性测试。`
      });
    } catch (testError) {
      pushToast({
        tone: "error",
        title: "模型连通性测试失败",
        description: testError instanceof Error ? testError.message : "请检查模型配置后重试。"
      });
    } finally {
      setTestingModel(false);
    }
  }

  async function testOcrConnectivity() {
    setTestingOcr(true);
    setOcrTest(null);

    try {
      if (!ocrFile) {
        throw new Error("请先选择一张图片或扫描件 PDF。");
      }

      const formData = new FormData();
      formData.append("file", ocrFile);
      const response = await fetch("/api/system/ocr-test", {
        method: "POST",
        body: formData
      });
      const data = (await response.json()) as { result?: OcrTestResult; error?: string };

      if (!response.ok && !data.result) {
        throw new Error(data.error ?? "OCR 连通性测试失败");
      }

      setOcrTest(data.result ?? null);
      pushToast({
        tone: data.result?.ok ? "success" : "warning",
        title: data.result?.ok ? "OCR 测试完成" : "OCR 测试未通过",
        description: data.result?.error ?? `识别到 ${data.result?.characters ?? 0} 个字符。`
      });
    } catch (testError) {
      pushToast({
        tone: "error",
        title: "OCR 连通性测试失败",
        description: testError instanceof Error ? testError.message : "请选择文件并检查 OCR 配置。"
      });
    } finally {
      setTestingOcr(false);
    }
  }

  async function previewTts() {
    setTestingTts(true);
    setTtsResult(null);

    try {
      if (!ttsText.trim()) {
        throw new Error("请输入要试听的文本。");
      }

      const response = await fetch("/api/tts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ text: ttsText.trim() })
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(data.error ?? "语音试听失败");
      }

      const blob = await response.blob();
      if (ttsAudioUrl) {
        URL.revokeObjectURL(ttsAudioUrl);
      }

      const url = URL.createObjectURL(blob);
      setTtsAudioUrl(url);
      setTtsResult({
        contentType: response.headers.get("content-type") ?? blob.type,
        bytes: blob.size
      });
      pushToast({
        tone: "success",
        title: "语音试听已生成",
        description: `音频大小 ${blob.size} bytes，可直接播放试听。`
      });
    } catch (testError) {
      pushToast({
        tone: "error",
        title: "语音试听失败",
        description: testError instanceof Error ? testError.message : "请检查 TTS 配置后重试。"
      });
    } finally {
      setTestingTts(false);
    }
  }

  async function testDigitalHumanConnectivity() {
    setTestingDigitalHuman(true);
    setDigitalHumanTest(null);

    try {
      const response = await fetch("/api/system/digital-human-test", {
        method: "POST"
      });
      const data = (await response.json()) as { result?: DigitalHumanTestResult; error?: string };

      if (!response.ok && !data.result) {
        throw new Error(data.error ?? "数字人连通性测试失败");
      }

      setDigitalHumanTest(data.result ?? null);
      pushToast({
        tone: data.result?.ok ? "success" : "warning",
        title: data.result?.ok ? "数字人接口可用" : "数字人接口检测未通过",
        description: data.result?.error ?? `任务状态：${data.result?.status ?? "已返回测试结果"}。`
      });
    } catch (testError) {
      pushToast({
        tone: "error",
        title: "数字人连通性测试失败",
        description: testError instanceof Error ? testError.message : "请检查数字人服务配置后重试。"
      });
    } finally {
      setTestingDigitalHuman(false);
    }
  }

  return (
    <div className="space-y-5">
      <section className="ui-card p-5 shadow-soft">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-3">
            <span className="grid size-11 shrink-0 place-items-center rounded-lg bg-cyan/10 text-brand">
              <Settings size={22} />
            </span>
            <div>
              <h1 className="text-xl font-semibold text-ink">系统配置向导</h1>
              <p className="mt-1 text-sm text-slate-500">
                检查数据库、模型、权限和业务入口是否可用，适合上线前逐项核对。
              </p>
            </div>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <button
              type="button"
              onClick={() => void testModelConnectivity()}
              disabled={testingModel}
              className="ui-button-primary h-10"
            >
              {testingModel ? <Loader2 className="animate-spin" size={16} /> : <MessageSquare size={16} />}
              测试对话模型
            </button>
            <button
              type="button"
              onClick={() => void loadHealth()}
              disabled={loading}
              className="ui-button-secondary h-10"
            >
              {loading ? <Loader2 className="animate-spin" size={16} /> : <RefreshCw size={16} />}
              重新检查
            </button>
          </div>
        </div>
      </section>

      {healthLoadError && (
        <ErrorRetry
          title={health ? "配置检查刷新失败" : "配置检查加载失败"}
          message={healthLoadError}
          retrying={loading}
          onRetry={() => void loadHealth()}
        />
      )}

      {modelTest && <ModelTestCard result={modelTest} />}
      {ocrTest && <OcrTestCard result={ocrTest} />}
      {digitalHumanTest && <DigitalHumanTestCard result={digitalHumanTest} />}

      <section ref={configSectionRef} className="scroll-mt-24 ui-card p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-base font-semibold text-ink">页面配置</h2>
            <p className="mt-1 text-sm text-slate-500">
              保存后会写入本地 `.env.local`。服务端环境变量建议重启开发服务后再完整检查。
            </p>
          </div>
          <button
            type="button"
            onClick={() => void saveSettings()}
            disabled={saving || settingsLoading || !settingsLoaded}
            className="ui-button-primary h-10"
          >
            {saving ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />}
            保存配置
          </button>
        </div>

        {settingsLoadError && (
          <div className="mt-5">
            <ErrorRetry
              title={settingsLoaded ? "配置文件刷新失败" : "配置文件读取失败"}
              message={settingsLoadError}
              retrying={settingsLoading}
              onRetry={() => void loadSettings()}
            />
          </div>
        )}
        {showSettingsSkeleton && <PanelSkeleton rows={6} className="mt-5" />}
        {showSettingsForm && (
        <div>
        <div className="mt-5 ui-card-muted p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-start gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-white text-brand">
                <Video size={18} />
              </span>
              <div>
                <h3 className="text-sm font-semibold text-ink">数字人接口测试</h3>
                <p className="mt-1 text-sm text-slate-500">
                  调用当前数字人配置提交一段测试讲稿，验证是否返回任务编号或视频地址。
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => void testDigitalHumanConnectivity()}
              disabled={testingDigitalHuman}
              className="ui-button-secondary h-10"
            >
              {testingDigitalHuman ? <Loader2 className="animate-spin" size={16} /> : <Video size={16} />}
              测试数字人
            </button>
          </div>
          <p className="mt-3 text-xs leading-5 text-amber-700">
            注意：如果第三方接口按任务计费，此测试可能会创建一个短测试任务。
          </p>
        </div>

        <div className="mt-5 ui-card-muted p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-start gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-white text-brand">
                <Volume2 size={18} />
              </span>
              <div>
                <h3 className="text-sm font-semibold text-ink">TTS 语音试听</h3>
                <p className="mt-1 text-sm text-slate-500">
                  调用当前 TTS 配置生成音频，适合验证国产或第三方语音接口是否可用。
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => void previewTts()}
              disabled={testingTts}
              className="ui-button-secondary h-10"
            >
              {testingTts ? <Loader2 className="animate-spin" size={16} /> : <Volume2 size={16} />}
              试听语音
            </button>
          </div>
          <textarea
            value={ttsText}
            onChange={(event) => setTtsText(event.target.value)}
            rows={2}
            className="mt-4 ui-input w-full py-2 leading-6"
          />
          {ttsAudioUrl && (
            <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3">
              <audio controls src={ttsAudioUrl} className="w-full" />
              {ttsResult && (
                <p className="mt-2 text-xs text-emerald-700">
                  类型：{ttsResult.contentType || "-"}，大小：{ttsResult.bytes} bytes
                </p>
              )}
            </div>
          )}
        </div>

        <div className="mt-5 ui-card p-4">
          <div className="flex items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-cyan/10 text-brand">
              <ShieldCheck size={18} />
            </span>
            <div>
              <h3 className="text-sm font-semibold text-ink">服务商预设模板</h3>
              <p className="mt-1 text-sm leading-6 text-slate-500">
                先套用常见认证、请求格式和请求体模板，再填写真实 URL、Key、模型、音色或形象。
              </p>
            </div>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {providerPresets.map((preset) => {
              const isActive = activePresetTitle === preset.title;

              return (
                <button
                  key={preset.title}
                  type="button"
                  onClick={() => applyProviderPreset(preset)}
                  disabled={settingsLoading || saving}
                  className={`min-h-24 rounded-lg border p-3 text-left shadow-sm transition disabled:cursor-not-allowed disabled:opacity-60 ${
                    isActive
                      ? "border-brand bg-cyan/10 ring-2 ring-cyan/20"
                      : "border-line bg-surface/95 hover:border-cyan/30 hover:bg-cyan/10"
                  }`}
                >
                  <span className="flex items-center justify-between gap-3 text-sm font-semibold text-ink">
                    {preset.title}
                    {isActive && (
                      <span className="shrink-0 rounded-full bg-brand px-2 py-0.5 text-xs text-white">
                        已套用
                      </span>
                    )}
                  </span>
                  <span className="mt-1 block text-xs leading-5 text-slate-500">{preset.description}</span>
                </button>
              );
            })}
          </div>
          {isTtsPreset && (
            <div
              ref={presetConfigRef}
              className="mt-4 scroll-mt-24 rounded-lg border border-cyan/30 bg-cyan/10 p-4"
            >
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <div className="inline-flex items-center gap-2 rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-brand ring-1 ring-cyan/30">
                    {activePresetTitle}
                  </div>
                  <h4 className="mt-3 text-sm font-semibold text-ink">TTS 语音合成配置</h4>
                  <p className="mt-1 text-sm leading-6 text-slate-600">
                    这里填语音合成接口。讯飞在线语音合成需要 AppID、APIKey、APISecret 和发音人，保存后可直接试听。
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void saveSettings()}
                  disabled={saving || settingsLoading}
                  className="ui-button-primary h-10 shrink-0"
                >
                  {saving ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />}
                  保存配置
                </button>
              </div>
              <div className="mt-4 grid gap-3 lg:grid-cols-2">
                <label className="block">
                  <span className="mb-1.5 block text-xs font-medium text-slate-600">TTS API URL</span>
                  <input
                    value={settings.TTS_API_URL}
                    onChange={(event) => updateSetting("TTS_API_URL", event.target.value)}
                    placeholder="wss://tts-api.xfyun.cn/v2/tts"
                    disabled={settingsLoading || saving}
                    className="h-10 w-full rounded-lg border border-line bg-white px-3 text-sm outline-none transition focus:border-brand disabled:bg-slate-50 disabled:text-slate-400"
                  />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-xs font-medium text-slate-600">TTS API Key</span>
                  <input
                    value={settings.TTS_API_KEY}
                    onChange={(event) => updateSetting("TTS_API_KEY", event.target.value)}
                    type="password"
                    placeholder="讯飞控制台 APIKey"
                    disabled={settingsLoading || saving}
                    className="h-10 w-full rounded-lg border border-line bg-white px-3 text-sm outline-none transition focus:border-brand disabled:bg-slate-50 disabled:text-slate-400"
                  />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-xs font-medium text-slate-600">TTS 音色</span>
                  <input
                    value={settings.TTS_VOICE}
                    onChange={(event) => updateSetting("TTS_VOICE", event.target.value)}
                    placeholder="例如：x4_yezi / aisjinger"
                    disabled={settingsLoading || saving}
                    className="h-10 w-full rounded-lg border border-line bg-white px-3 text-sm outline-none transition focus:border-brand disabled:bg-slate-50 disabled:text-slate-400"
                  />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-xs font-medium text-slate-600">TTS 模型</span>
                  <input
                    value={settings.TTS_MODEL}
                    onChange={(event) => updateSetting("TTS_MODEL", event.target.value)}
                    placeholder="xfyun-online-tts"
                    disabled={settingsLoading || saving}
                    className="h-10 w-full rounded-lg border border-line bg-white px-3 text-sm outline-none transition focus:border-brand disabled:bg-slate-50 disabled:text-slate-400"
                  />
                </label>
                <label className="block lg:col-span-2">
                  <span className="mb-1.5 block text-xs font-medium text-slate-600">AppID / APISecret</span>
                  <textarea
                    value={settings.TTS_HEADERS}
                    onChange={(event) => updateSetting("TTS_HEADERS", event.target.value)}
                    rows={3}
                    placeholder='{"XFYUN_APP_ID":"你的 AppID","XFYUN_API_SECRET":"你的 APISecret"}'
                    disabled={settingsLoading || saving}
                    className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm leading-6 outline-none transition focus:border-brand disabled:bg-slate-50 disabled:text-slate-400"
                  />
                </label>
              </div>
              <div className="mt-4 rounded-lg border border-cyan/20 bg-white/85 p-3">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="flex min-w-0 flex-1 items-start gap-3">
                    <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-cyan/10 text-brand">
                      <Volume2 size={18} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <h5 className="text-sm font-semibold text-ink">立即试听当前 TTS</h5>
                      <textarea
                        value={ttsText}
                        onChange={(event) => setTtsText(event.target.value)}
                        rows={2}
                        className="mt-2 ui-input w-full py-2 leading-6"
                      />
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void previewTts()}
                    disabled={testingTts}
                    className="ui-button-secondary h-10 shrink-0"
                  >
                    {testingTts ? <Loader2 className="animate-spin" size={16} /> : <Volume2 size={16} />}
                    试听语音
                  </button>
                </div>
                {ttsAudioUrl && (
                  <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                    <audio controls src={ttsAudioUrl} className="w-full" />
                    {ttsResult && (
                      <p className="mt-2 text-xs text-emerald-700">
                        类型：{ttsResult.contentType || "-"}，大小：{ttsResult.bytes} bytes
                      </p>
                    )}
                  </div>
                )}
              </div>
              <div className="mt-3 rounded-lg border border-cyan/20 bg-white/80 px-3 py-2 text-xs leading-5 text-slate-600">
                讯飞模式会使用 TTS API Key 参与签名；AppID 和 APISecret 请写在上方 JSON 中。音色额度不足时，可切换为已开通的发音人。
              </div>
            </div>
          )}
          {isOcrPreset && (
            <div
              ref={presetConfigRef}
              className="mt-4 scroll-mt-24 rounded-lg border border-cyan/30 bg-cyan/10 p-4"
            >
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <div className="inline-flex items-center gap-2 rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-brand ring-1 ring-cyan/30">
                    {activePresetTitle}
                  </div>
                  <h4 className="mt-3 text-sm font-semibold text-ink">多模态文件识别配置</h4>
                  <p className="mt-1 text-sm leading-6 text-slate-600">
                    这里填你的多模态识别接口。保存后，扫描件 PDF 或图片会把文件转成 base64 发给该接口，并读取返回的正文入库。
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void saveSettings()}
                  disabled={saving || settingsLoading}
                  className="ui-button-primary h-10 shrink-0"
                >
                  {saving ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />}
                  保存配置
                </button>
              </div>
              <div className="mt-4 grid gap-3 lg:grid-cols-2">
                <label className="block">
                  <span className="mb-1.5 block text-xs font-medium text-slate-600">OCR API URL</span>
                  <input
                    value={settings.OCR_API_URL}
                    onChange={(event) => updateSetting("OCR_API_URL", event.target.value)}
                    placeholder="https://api.example.com/v1/chat/completions"
                    disabled={settingsLoading || saving}
                    className="h-10 w-full rounded-lg border border-line bg-white px-3 text-sm outline-none transition focus:border-brand disabled:bg-slate-50 disabled:text-slate-400"
                  />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-xs font-medium text-slate-600">OCR API Key</span>
                  <input
                    value={settings.OCR_API_KEY}
                    onChange={(event) => updateSetting("OCR_API_KEY", event.target.value)}
                    type="password"
                    placeholder="sk-..."
                    disabled={settingsLoading || saving}
                    className="h-10 w-full rounded-lg border border-line bg-white px-3 text-sm outline-none transition focus:border-brand disabled:bg-slate-50 disabled:text-slate-400"
                  />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-xs font-medium text-slate-600">OCR 模型</span>
                  <input
                    value={settings.OCR_MODEL}
                    onChange={(event) => updateSetting("OCR_MODEL", event.target.value)}
                    placeholder="例如：qwen-vl-max / glm-4v-plus / 你的模型 ID"
                    disabled={settingsLoading || saving}
                    className="h-10 w-full rounded-lg border border-line bg-white px-3 text-sm outline-none transition focus:border-brand disabled:bg-slate-50 disabled:text-slate-400"
                  />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-xs font-medium text-slate-600">鉴权 Header</span>
                  <input
                    value={settings.OCR_AUTH_HEADER}
                    onChange={(event) => updateSetting("OCR_AUTH_HEADER", event.target.value)}
                    placeholder="Authorization 或 X-API-Key"
                    disabled={settingsLoading || saving}
                    className="h-10 w-full rounded-lg border border-line bg-white px-3 text-sm outline-none transition focus:border-brand disabled:bg-slate-50 disabled:text-slate-400"
                  />
                </label>
                <label className="block lg:col-span-2">
                  <span className="mb-1.5 block text-xs font-medium text-slate-600">请求体模板</span>
                  <textarea
                    value={settings.OCR_PAYLOAD_TEMPLATE}
                    onChange={(event) => updateSetting("OCR_PAYLOAD_TEMPLATE", event.target.value)}
                    rows={6}
                    disabled={settingsLoading || saving}
                    className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm leading-6 outline-none transition focus:border-brand disabled:bg-slate-50 disabled:text-slate-400"
                  />
                </label>
              </div>
              <div className="mt-4 rounded-lg border border-cyan/20 bg-white/85 p-3">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div className="flex items-start gap-3">
                    <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-cyan/10 text-brand">
                      <FileText size={18} />
                    </span>
                    <div>
                      <h5 className="text-sm font-semibold text-ink">立即测试当前 OCR</h5>
                      <p className="mt-1 text-sm leading-5 text-slate-600">
                        选择图片或扫描件 PDF，直接调用上面的配置并返回识别预览。
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <input
                      type="file"
                      accept="image/*,.pdf"
                      onChange={(event) => setOcrFile(event.target.files?.[0] ?? null)}
                      className="h-10 ui-input py-2"
                    />
                    <button
                      type="button"
                      onClick={() => void testOcrConnectivity()}
                      disabled={testingOcr}
                      className="ui-button-secondary h-10 shrink-0"
                    >
                      {testingOcr ? <Loader2 className="animate-spin" size={16} /> : <FileText size={16} />}
                      测试 OCR
                    </button>
                  </div>
                </div>
              </div>
              <div className="mt-3 rounded-lg border border-cyan/20 bg-white/80 px-3 py-2 text-xs leading-5 text-slate-600">
                可用变量：{"{{file_base64}}"}、{"{{file_data_url}}"}、{"{{file_name}}"}、{"{{mime_type}}"}、{"{{model}}"}。
                返回内容支持传统 OCR 的 text/pages，也支持 OpenAI-compatible 的 choices/message/content。
              </div>
            </div>
          )}
        </div>

        <div className="mt-5 grid gap-4 xl:grid-cols-[340px_1fr]">
          <div className="rounded-lg border border-line bg-white p-3">
            <div className="px-1 pb-2">
              <h3 className="text-sm font-semibold text-ink">配置类别</h3>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                按当前要接入的能力打开配置框，填完保存后再做测试。
              </p>
            </div>
            <div className="space-y-2">
              {configGroups.map((group) => {
                const isActive = activeConfigGroupTitle === group.title;
                const filledFields = group.fields.filter((field) => String(settings[field.key] ?? "").trim().length > 0).length;

                return (
                  <button
                    key={group.title}
                    type="button"
                    onClick={() => openConfigGroup(group.title)}
                    disabled={settingsLoading || saving}
                    aria-expanded={isActive}
                    className={`flex min-h-16 w-full items-center gap-3 rounded-lg border p-3 text-left transition disabled:cursor-not-allowed disabled:opacity-60 ${
                      isActive
                        ? "border-brand bg-cyan/10 text-ink ring-2 ring-cyan/20"
                        : "border-transparent bg-slate-50 text-slate-700 hover:border-cyan/30 hover:bg-white"
                    }`}
                  >
                    <span className={`grid size-8 shrink-0 place-items-center rounded-lg ${isActive ? "bg-brand text-white" : "bg-white text-brand"}`}>
                      <Settings size={16} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold">{group.title}</span>
                      <span className="mt-0.5 block text-xs leading-5 text-slate-500">
                        {filledFields}/{group.fields.length} 项已填写
                      </span>
                    </span>
                    <ChevronRight size={16} className={`shrink-0 transition ${isActive ? "rotate-90 text-brand" : "text-slate-400"}`} />
                  </button>
                );
              })}
            </div>
          </div>

          <div ref={configGroupPanelRef} className="scroll-mt-24 rounded-lg border border-line bg-white p-4">
            {activeConfigGroup ? (
              <>
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <div className="inline-flex items-center gap-2 rounded-full bg-cyan/10 px-2.5 py-1 text-xs font-semibold text-brand ring-1 ring-cyan/30">
                      当前配置
                    </div>
                    <h3 className="mt-3 text-base font-semibold text-ink">{activeConfigGroup.title}</h3>
                    <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">{activeConfigGroup.description}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void saveSettings()}
                    disabled={saving || settingsLoading}
                    className="ui-button-primary h-10 shrink-0"
                  >
                    {saving ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />}
                    保存配置
                  </button>
                </div>

                <div className="mt-4 grid gap-3 lg:grid-cols-2">
                  {activeConfigGroup.fields.map((field) => {
                    const isMultiline = multilineConfigKeys.has(field.key);

                    return (
                      <label key={field.key} className={isMultiline ? "block lg:col-span-2" : "block"}>
                        <span className="mb-1.5 block text-xs font-medium text-slate-600">{field.label}</span>
                        {isMultiline ? (
                          <textarea
                            value={settings[field.key]}
                            onChange={(event) => updateSetting(field.key, event.target.value)}
                            rows={field.key.toString().includes("PAYLOAD_TEMPLATE") ? 6 : 3}
                            placeholder={field.placeholder}
                            disabled={settingsLoading || saving}
                            className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm leading-6 outline-none transition focus:border-brand disabled:bg-slate-50 disabled:text-slate-400"
                          />
                        ) : (
                          <input
                            value={settings[field.key]}
                            onChange={(event) => updateSetting(field.key, event.target.value)}
                            type={field.secret ? "password" : field.key === "MAX_UPLOAD_MB" ? "number" : "text"}
                            min={field.key === "MAX_UPLOAD_MB" ? 1 : undefined}
                            max={field.key === "MAX_UPLOAD_MB" ? 200 : undefined}
                            placeholder={field.placeholder}
                            disabled={settingsLoading || saving}
                            className="h-10 w-full rounded-lg border border-line bg-white px-3 text-sm outline-none transition focus:border-brand disabled:bg-slate-50 disabled:text-slate-400"
                          />
                        )}
                      </label>
                    );
                  })}
                </div>

                {(activeConfigGroup.title === "自定义语音 TTS" ||
                  activeConfigGroup.title === "OCR 扫描件识别" ||
                  activeConfigGroup.title === "数字人视频" ||
                  activeConfigGroup.title === "RAG 检索模式") && (
                  <div className="mt-4 rounded-lg border border-cyan/20 bg-cyan/10 px-3 py-2 text-xs leading-5 text-slate-600">
                    {activeConfigGroup.title === "自定义语音 TTS" &&
                      "填完 TTS 后可以使用上方“试听语音”，讯飞接口请确认 AppID、APIKey、APISecret 来自同一个应用。"}
                    {activeConfigGroup.title === "OCR 扫描件识别" &&
                      "填完 OCR 后可以使用服务商预设里的 OCR 测试区，上传图片或扫描件 PDF 验证识别效果。"}
                    {activeConfigGroup.title === "数字人视频" &&
                      "填完数字人服务后可以使用上方“数字人接口测试”，第三方平台可能会创建测试任务。"}
                    {activeConfigGroup.title === "RAG 检索模式" &&
                      "本地 RAG 策略可填 balanced、content_first、governance_enhanced、synonym_expanded。建议先在 QA 的“召回策略 A/B 对比”里验证，再保存为线上策略并重启服务。"}
                  </div>
                )}
              </>
            ) : (
              <div className="flex min-h-[320px] flex-col items-center justify-center rounded-lg border border-dashed border-line bg-slate-50 px-6 text-center">
                <span className="grid size-12 place-items-center rounded-lg bg-white text-brand shadow-sm">
                  <Settings size={20} />
                </span>
                <h3 className="mt-4 text-base font-semibold text-ink">选择一个配置类别</h3>
                <p className="mt-2 max-w-md text-sm leading-6 text-slate-500">
                  例如先点“自定义语音 TTS”配置讯飞语音，或点“OCR 扫描件识别”配置多模态文件识别。
                </p>
              </div>
            )}
          </div>
        </div>
        </div>
        )}
      </section>

      {loading && !health && (
        <section className="grid gap-3 md:grid-cols-4">
          <PanelSkeleton rows={1} className="md:col-span-2" />
          <PanelSkeleton rows={1} className="md:col-span-2" />
        </section>
      )}

      {!loading && !health && !healthLoadError && <SettingsHealthEmptyState />}

      {health && (
        <>
          <section className="grid gap-3 md:grid-cols-4">
            <div className="ui-card p-4">
              <p className="text-xs font-medium text-slate-500">运行模式</p>
              <p className="mt-2 text-2xl font-semibold text-ink">{health.mode === "demo" ? "演示" : "已接入"}</p>
            </div>
            <div className="ui-card p-4">
              <p className="text-xs font-medium text-slate-500">已就绪</p>
              <p className="mt-2 text-2xl font-semibold text-emerald-700">{health.summary.ready}</p>
            </div>
            <div className="ui-card p-4">
              <p className="text-xs font-medium text-slate-500">待完善</p>
              <p className="mt-2 text-2xl font-semibold text-amber-700">{health.summary.warning}</p>
            </div>
            <div className="ui-card p-4">
              <p className="text-xs font-medium text-slate-500">需处理</p>
              <p className="mt-2 text-2xl font-semibold text-red-700">{health.summary.error}</p>
            </div>
          </section>

          <section className="grid gap-5 xl:grid-cols-[360px_1fr]">
            <div className="space-y-5">
              <div className="ui-card p-5">
                <div className="flex items-center gap-2">
                  <ShieldCheck size={18} className="text-brand" />
                  <h2 className="text-base font-semibold text-ink">当前身份</h2>
                </div>
                <div className="mt-4 space-y-3 text-sm text-slate-600">
                  <div className="flex justify-between gap-3">
                    <span>邮箱</span>
                    <span className="truncate font-medium text-ink">{health.user?.email ?? "未登录"}</span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span>角色</span>
                    <span className="font-medium text-ink">{health.user?.role ?? "-"}</span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span>来源</span>
                    <span className="font-medium text-ink">
                      {health.user?.source === "mysql"
                        ? "MySQL"
                        : health.user?.source === "demo"
                          ? "演示账号"
                          : "Supabase"}
                    </span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span>检查时间</span>
                    <span className="font-medium text-ink">{new Date(health.checkedAt).toLocaleTimeString("zh-CN")}</span>
                  </div>
                </div>
              </div>

              <div id="setup" className="ui-card p-5">
                <h2 className="text-base font-semibold text-ink">推荐配置顺序</h2>
                <ol className="mt-4 space-y-3 text-sm leading-6 text-slate-600">
                  <li>1. 将 `DATABASE_PROVIDER` 设置为 `mysql`，填写 MySQL 地址、库名、用户名和密码。</li>
                  <li>2. 将 `RAG_PROVIDER` 设置为 `local_text`，资料会解析切块并写入 MySQL。</li>
                  <li>3. 填写 `AI_CHAT_*` 接入 DeepSeek、智谱、讯飞、阿里等兼容对话模型。</li>
                  <li>4. 如需 PPT 语音讲解，将 `TTS_PROVIDER` 设置为 `openai` 或 `custom`，并填写对应 TTS 配置。</li>
                  <li>5. 如需数字人视频，将 `DIGITAL_HUMAN_PROVIDER` 设置为 `custom`，填写生成接口、API Key、形象和音色。</li>
                  <li>6. 如需企业统一登录，将 `SSO_PROVIDER` 设置为 `oidc`，填写授权、Token、用户信息地址和 Client 凭证。</li>
                  <li>7. 保存配置并重启开发服务，然后重新检查数据库和模型状态。</li>
                  <li>8. 创建知识库、上传资料，用员工问答验证引用来源和回答质量。</li>
                </ol>
                <div className="mt-5 rounded-lg border border-cyan/20 bg-cyan/10 p-4 text-sm leading-6 text-steel">
                  完成基础配置后，以右侧“业务流程”检查项作为上线验证清单：知识库、本地文本 RAG、可检索资料、员工问答和 PPT 语音课程都通过后，再邀请员工试用。
                </div>
              </div>
            </div>

            <div className="space-y-5">
              {(Object.keys(groupedChecks) as Array<HealthCheck["group"]>).map((group) => (
                <section key={group}>
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <h2 className="text-base font-semibold text-ink">{groupLabel[group]}</h2>
                    <span className="text-xs text-slate-500">{groupedChecks[group].length} 项</span>
                  </div>
                  <div className="grid gap-3">
                    {groupedChecks[group].map((check) => (
                      <CheckCard key={check.id} check={check} />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function SettingsHealthEmptyState() {
  return (
    <section className="rounded-lg border border-dashed border-line bg-white p-6 text-center">
      <span className="mx-auto grid size-12 place-items-center rounded-lg bg-cyan/10 text-brand">
        <Settings size={20} />
      </span>
      <h2 className="mt-4 text-base font-semibold text-ink">暂无配置检查结果</h2>
      <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-slate-500">
        点击上方“重新检查”后会读取数据库、模型、语音、OCR、统一登录和业务流程状态。
      </p>
    </section>
  );
}
