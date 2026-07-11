import type { SecurityEvent, SecurityEventCategory, SecuritySeverity, UserProfile } from "@/lib/types";

type SecurityFinding = {
  category: SecurityEventCategory;
  severity: SecuritySeverity;
  rule: string;
  title: string;
  detail: string;
  raw_excerpt: string;
  masked_excerpt: string;
};

const sensitiveRules: Array<{
  rule: string;
  title: string;
  severity: SecuritySeverity;
  pattern: RegExp;
  replacement: string;
}> = [
  {
    rule: "cn_mobile",
    title: "手机号脱敏",
    severity: "medium",
    pattern: /(?<!\d)1[3-9]\d{9}(?!\d)/g,
    replacement: "[手机号已脱敏]"
  },
  {
    rule: "cn_id_card",
    title: "身份证号脱敏",
    severity: "high",
    pattern: /(?<![0-9A-Za-z])\d{6}(?:18|19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx](?![0-9A-Za-z])/g,
    replacement: "[身份证号已脱敏]"
  },
  {
    rule: "bank_card",
    title: "银行卡号脱敏",
    severity: "high",
    pattern: /(?<!\d)(?:\d[ -]?){16,19}(?!\d)/g,
    replacement: "[银行卡号已脱敏]"
  },
  {
    rule: "email",
    title: "邮箱脱敏",
    severity: "low",
    pattern: /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,
    replacement: "[邮箱已脱敏]"
  },
  {
    rule: "api_key",
    title: "密钥脱敏",
    severity: "critical",
    pattern: /\b(?:sk-[A-Za-z0-9_-]{16,}|[A-Za-z0-9_-]{32,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,})\b/g,
    replacement: "[密钥已脱敏]"
  }
];

const injectionRules: Array<{
  rule: string;
  title: string;
  severity: SecuritySeverity;
  pattern: RegExp;
}> = [
  {
    rule: "ignore_previous_instruction",
    title: "疑似忽略系统规则",
    severity: "high",
    pattern: /(忽略|无视|绕过|覆盖).{0,12}(以上|之前|系统|开发者|安全|规则|指令|限制)/i
  },
  {
    rule: "reveal_prompt",
    title: "疑似索要系统提示词",
    severity: "high",
    pattern: /(系统提示词|system prompt|developer message|隐藏指令|初始指令|内部规则|prompt)/i
  },
  {
    rule: "exfiltrate_secret",
    title: "疑似索要密钥或隐私",
    severity: "critical",
    pattern: /(api[_ -]?key|密钥|token|密码|数据库连接|connection string|环境变量|\.env)/i
  },
  {
    rule: "roleplay_escape",
    title: "疑似越权角色扮演",
    severity: "medium",
    pattern: /(你现在是|扮演|假设你是).{0,16}(管理员|root|系统|开发者|安全审计|数据库)/i
  }
];

export function maskSensitiveText(text: string) {
  return sensitiveRules.reduce((current, rule) => current.replace(rule.pattern, rule.replacement), text);
}

export function analyzeUserInput(text: string): { maskedText: string; findings: SecurityFinding[] } {
  const findings: SecurityFinding[] = [];
  const maskedText = maskSensitiveText(text);

  for (const rule of sensitiveRules) {
    const matches = [...text.matchAll(rule.pattern)];

    if (matches.length === 0) {
      continue;
    }

    const raw = matches[0]?.[0] ?? "";
    findings.push({
      category: "sensitive_input",
      severity: rule.severity,
      rule: rule.rule,
      title: rule.title,
      detail: `用户输入命中 ${matches.length} 处敏感信息，系统已在入模和入库前进行脱敏。`,
      raw_excerpt: excerpt(text, raw),
      masked_excerpt: excerpt(maskedText, rule.replacement)
    });
  }

  for (const rule of injectionRules) {
    const match = text.match(rule.pattern);

    if (!match) {
      continue;
    }

    findings.push({
      category: "prompt_injection",
      severity: rule.severity,
      rule: rule.rule,
      title: rule.title,
      detail: "用户输入疑似包含提示词注入或越权探测，已记录审计事件并继续按系统规则处理。",
      raw_excerpt: excerpt(text, match[0]),
      masked_excerpt: excerpt(maskedText, match[0])
    });
  }

  return { maskedText, findings };
}

export function analyzeModelOutput(text: string): { maskedText: string; findings: SecurityFinding[] } {
  const maskedText = maskSensitiveText(text);
  const findings: SecurityFinding[] = [];

  for (const rule of sensitiveRules) {
    const matches = [...text.matchAll(rule.pattern)];

    if (matches.length === 0) {
      continue;
    }

    findings.push({
      category: "sensitive_output",
      severity: rule.severity,
      rule: rule.rule,
      title: `模型输出${rule.title}`,
      detail: `模型回答命中 ${matches.length} 处敏感信息，系统已在保存前进行脱敏。`,
      raw_excerpt: excerpt(text, matches[0]?.[0] ?? ""),
      masked_excerpt: excerpt(maskedText, rule.replacement)
    });
  }

  return { maskedText, findings };
}

export function buildSecurityEvent(input: {
  finding: SecurityFinding;
  user: UserProfile | null;
  conversation_id: string | null;
  message_id: string | null;
}): Omit<SecurityEvent, "id" | "created_at" | "status" | "resolved_at"> {
  return {
    category: input.finding.category,
    severity: input.finding.severity,
    user_id: input.user?.id ?? null,
    conversation_id: input.conversation_id,
    message_id: input.message_id,
    title: input.finding.title,
    detail: input.finding.detail,
    raw_excerpt: input.finding.raw_excerpt,
    masked_excerpt: input.finding.masked_excerpt,
    metadata: {
      rule: input.finding.rule,
      user_email: input.user?.email ?? null,
      department: input.user?.department ?? null
    }
  };
}

export function buildAbnormalAccessEvent(input: {
  user: UserProfile;
  title: string;
  detail: string;
  severity?: SecuritySeverity;
  conversation_id?: string | null;
  message_id?: string | null;
  metadata?: Record<string, unknown>;
}): Omit<SecurityEvent, "id" | "created_at" | "status" | "resolved_at"> {
  return {
    category: "abnormal_access",
    severity: input.severity ?? "high",
    user_id: input.user.id,
    conversation_id: input.conversation_id ?? null,
    message_id: input.message_id ?? null,
    title: input.title,
    detail: input.detail,
    raw_excerpt: null,
    masked_excerpt: null,
    metadata: {
      user_email: input.user.email,
      department: input.user.department,
      ...input.metadata
    }
  };
}

function excerpt(text: string, match: string) {
  if (!match) {
    return text.slice(0, 160);
  }

  const index = text.indexOf(match);
  if (index === -1) {
    return text.slice(0, 160);
  }

  return text.slice(Math.max(0, index - 40), Math.min(text.length, index + match.length + 40));
}
