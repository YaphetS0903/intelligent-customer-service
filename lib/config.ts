export const env = {
  get supabaseUrl() {
    return process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  },
  get supabaseAnonKey() {
    return process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  },
  get supabaseServiceRoleKey() {
    return process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  },
  get openaiApiKey() {
    return process.env.OPENAI_API_KEY ?? "";
  },
  get openaiChatModel() {
    return process.env.OPENAI_CHAT_MODEL ?? "gpt-5.5";
  },
  get openaiTtsModel() {
    return process.env.OPENAI_TTS_MODEL ?? "gpt-4o-mini-tts";
  },
  get openaiTtsVoice() {
    return process.env.OPENAI_TTS_VOICE ?? "coral";
  },
  get ttsProvider() {
    return process.env.TTS_PROVIDER ?? "openai";
  },
  get ttsApiUrl() {
    return process.env.TTS_API_URL ?? "";
  },
  get ttsStatusUrl() {
    return process.env.TTS_STATUS_URL ?? "";
  },
  get ttsApiKey() {
    return process.env.TTS_API_KEY ?? "";
  },
  get ttsAuthHeader() {
    return process.env.TTS_AUTH_HEADER ?? "Authorization";
  },
  get ttsHeaders() {
    return process.env.TTS_HEADERS ?? "";
  },
  get ttsPayloadTemplate() {
    return process.env.TTS_PAYLOAD_TEMPLATE ?? "";
  },
  get ttsModel() {
    return process.env.TTS_MODEL ?? "";
  },
  get ttsVoice() {
    return process.env.TTS_VOICE ?? "";
  },
  get aiChatProvider() {
    return process.env.AI_CHAT_PROVIDER ?? "openai";
  },
  get aiChatBaseUrl() {
    return process.env.AI_CHAT_BASE_URL ?? "";
  },
  get aiChatApiKey() {
    return process.env.AI_CHAT_API_KEY ?? "";
  },
  get aiChatModel() {
    return process.env.AI_CHAT_MODEL ?? "";
  },
  get aiChatFallback1Provider() {
    return process.env.AI_CHAT_FALLBACK_1_PROVIDER ?? "none";
  },
  get aiChatFallback1BaseUrl() {
    return process.env.AI_CHAT_FALLBACK_1_BASE_URL ?? "";
  },
  get aiChatFallback1ApiKey() {
    return process.env.AI_CHAT_FALLBACK_1_API_KEY ?? "";
  },
  get aiChatFallback1Model() {
    return process.env.AI_CHAT_FALLBACK_1_MODEL ?? "";
  },
  get aiChatFallback2Provider() {
    return process.env.AI_CHAT_FALLBACK_2_PROVIDER ?? "none";
  },
  get aiChatFallback2BaseUrl() {
    return process.env.AI_CHAT_FALLBACK_2_BASE_URL ?? "";
  },
  get aiChatFallback2ApiKey() {
    return process.env.AI_CHAT_FALLBACK_2_API_KEY ?? "";
  },
  get aiChatFallback2Model() {
    return process.env.AI_CHAT_FALLBACK_2_MODEL ?? "";
  },
  get ocrProvider() {
    return process.env.OCR_PROVIDER ?? "none";
  },
  get ocrApiUrl() {
    return process.env.OCR_API_URL ?? "";
  },
  get ocrApiKey() {
    return process.env.OCR_API_KEY ?? "";
  },
  get ocrAuthHeader() {
    return process.env.OCR_AUTH_HEADER ?? "Authorization";
  },
  get ocrHeaders() {
    return process.env.OCR_HEADERS ?? "";
  },
  get ocrRequestFormat() {
    return process.env.OCR_REQUEST_FORMAT ?? "multipart";
  },
  get ocrFileField() {
    return process.env.OCR_FILE_FIELD ?? "file";
  },
  get ocrModelField() {
    return process.env.OCR_MODEL_FIELD ?? "model";
  },
  get ocrProviderField() {
    return process.env.OCR_PROVIDER_FIELD ?? "provider";
  },
  get ocrPayloadTemplate() {
    return process.env.OCR_PAYLOAD_TEMPLATE ?? "";
  },
  get ocrModel() {
    return process.env.OCR_MODEL ?? "";
  },
  get ragProvider() {
    return process.env.RAG_PROVIDER ?? "openai_file_search";
  },
  get ragRetrievalStrategy() {
    return process.env.RAG_RETRIEVAL_STRATEGY ?? "balanced";
  },
  get digitalHumanProvider() {
    return process.env.DIGITAL_HUMAN_PROVIDER ?? "none";
  },
  get digitalHumanApiUrl() {
    return process.env.DIGITAL_HUMAN_API_URL ?? "";
  },
  get digitalHumanStatusUrl() {
    return process.env.DIGITAL_HUMAN_STATUS_URL ?? "";
  },
  get digitalHumanApiKey() {
    return process.env.DIGITAL_HUMAN_API_KEY ?? "";
  },
  get digitalHumanAuthHeader() {
    return process.env.DIGITAL_HUMAN_AUTH_HEADER ?? "Authorization";
  },
  get digitalHumanHeaders() {
    return process.env.DIGITAL_HUMAN_HEADERS ?? "";
  },
  get digitalHumanPayloadTemplate() {
    return process.env.DIGITAL_HUMAN_PAYLOAD_TEMPLATE ?? "";
  },
  get digitalHumanModel() {
    return process.env.DIGITAL_HUMAN_MODEL ?? "";
  },
  get digitalHumanAvatarId() {
    return process.env.DIGITAL_HUMAN_AVATAR_ID ?? "";
  },
  get digitalHumanVoiceId() {
    return process.env.DIGITAL_HUMAN_VOICE_ID ?? "";
  },
  get ssoProvider() {
    return process.env.SSO_PROVIDER ?? "none";
  },
  get ssoAuthorizeUrl() {
    return process.env.SSO_AUTHORIZE_URL ?? "";
  },
  get ssoTokenUrl() {
    return process.env.SSO_TOKEN_URL ?? "";
  },
  get ssoUserinfoUrl() {
    return process.env.SSO_USERINFO_URL ?? "";
  },
  get ssoClientId() {
    return process.env.SSO_CLIENT_ID ?? "";
  },
  get ssoClientSecret() {
    return process.env.SSO_CLIENT_SECRET ?? "";
  },
  get ssoScopes() {
    return process.env.SSO_SCOPES ?? "openid profile email";
  },
  get ssoDefaultDepartment() {
    return process.env.SSO_DEFAULT_DEPARTMENT ?? "";
  },
  get ldapProvider() {
    return process.env.LDAP_PROVIDER ?? "none";
  },
  get ldapUrl() {
    return process.env.LDAP_URL ?? "";
  },
  get ldapBindDn() {
    return process.env.LDAP_BIND_DN ?? "";
  },
  get ldapBindPassword() {
    return process.env.LDAP_BIND_PASSWORD ?? "";
  },
  get ldapSearchBase() {
    return process.env.LDAP_SEARCH_BASE ?? "";
  },
  get ldapSearchFilter() {
    return process.env.LDAP_SEARCH_FILTER ?? "(|(mail={{login}})(uid={{login}})(sAMAccountName={{login}}))";
  },
  get ldapUserDnTemplate() {
    return process.env.LDAP_USER_DN_TEMPLATE ?? "";
  },
  get ldapEmailAttribute() {
    return process.env.LDAP_EMAIL_ATTRIBUTE ?? "mail";
  },
  get ldapNameAttribute() {
    return process.env.LDAP_NAME_ATTRIBUTE ?? "displayName";
  },
  get ldapDepartmentAttribute() {
    return process.env.LDAP_DEPARTMENT_ATTRIBUTE ?? "department";
  },
  get ldapPositionAttribute() {
    return process.env.LDAP_POSITION_ATTRIBUTE ?? "title";
  },
  get ldapDefaultDomain() {
    return process.env.LDAP_DEFAULT_DOMAIN ?? "";
  },
  get databaseProvider() {
    return process.env.DATABASE_PROVIDER ?? "memory";
  },
  get mysqlHost() {
    return process.env.MYSQL_HOST ?? "";
  },
  get mysqlPort() {
    return Number(process.env.MYSQL_PORT ?? "3306");
  },
  get mysqlDatabase() {
    return process.env.MYSQL_DATABASE ?? "";
  },
  get mysqlUser() {
    return process.env.MYSQL_USER ?? "";
  },
  get mysqlPassword() {
    return process.env.MYSQL_PASSWORD ?? "";
  },
  get authSecret() {
    return process.env.AUTH_SECRET ?? process.env.MYSQL_PASSWORD ?? "dev-auth-secret";
  },
  get appBaseUrl() {
    return process.env.APP_BASE_URL ?? "http://localhost:3000";
  },
  get allowSelfRegistration() {
    return process.env.ALLOW_SELF_REGISTRATION === "true";
  },
  get notificationWebhookUrl() {
    return process.env.NOTIFICATION_WEBHOOK_URL ?? "";
  },
  get notificationEmailWebhookUrl() {
    return process.env.NOTIFICATION_EMAIL_WEBHOOK_URL ?? "";
  },
  get notificationWecomWebhookUrl() {
    return process.env.NOTIFICATION_WECOM_WEBHOOK_URL ?? "";
  },
  get maxUploadMb() {
    return Number(process.env.MAX_UPLOAD_MB ?? "20");
  },
  get adminEmails() {
    return (process.env.SUPABASE_ADMIN_EMAILS ?? "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean);
  }
};

export function hasOpenAIConfig() {
  return Boolean(env.openaiApiKey);
}

export function hasCustomChatConfig() {
  return env.aiChatProvider === "custom" && Boolean(env.aiChatBaseUrl && env.aiChatApiKey && env.aiChatModel);
}

export function hasFallbackChatConfig(index: 1 | 2) {
  const provider = index === 1 ? env.aiChatFallback1Provider : env.aiChatFallback2Provider;
  const baseUrl = index === 1 ? env.aiChatFallback1BaseUrl : env.aiChatFallback2BaseUrl;
  const apiKey = index === 1 ? env.aiChatFallback1ApiKey : env.aiChatFallback2ApiKey;
  const model = index === 1 ? env.aiChatFallback1Model : env.aiChatFallback2Model;

  if (provider === "custom") {
    return Boolean(baseUrl && apiKey && model);
  }

  if (provider === "openai") {
    return Boolean(env.openaiApiKey && model);
  }

  return false;
}

export function hasOcrConfig() {
  return env.ocrProvider === "custom" && Boolean(env.ocrApiUrl && env.ocrApiKey);
}

export function hasTtsConfig() {
  if (env.ttsProvider === "custom") {
    return Boolean(env.ttsApiUrl && env.ttsApiKey);
  }

  return hasOpenAIConfig();
}

export function hasDigitalHumanConfig() {
  return env.digitalHumanProvider === "custom" && Boolean(env.digitalHumanApiUrl && env.digitalHumanApiKey);
}

export function hasSsoConfig() {
  return env.ssoProvider === "oidc" && Boolean(
    env.ssoAuthorizeUrl &&
    env.ssoTokenUrl &&
    env.ssoUserinfoUrl &&
    env.ssoClientId &&
    env.ssoClientSecret
  );
}

export function hasLdapConfig() {
  if (env.ldapProvider !== "custom" || !env.ldapUrl) {
    return false;
  }

  if (env.ldapUserDnTemplate) {
    return true;
  }

  return Boolean(env.ldapBindDn && env.ldapBindPassword && env.ldapSearchBase);
}

export function hasChatModelConfig() {
  if (env.aiChatProvider === "custom") {
    return hasCustomChatConfig();
  }

  return hasOpenAIConfig();
}

export function hasAnyChatModelConfig() {
  return hasChatModelConfig() || hasFallbackChatConfig(1) || hasFallbackChatConfig(2);
}

export function isLocalTextRag() {
  return env.ragProvider === "local_text";
}

export function isMySqlDatabase() {
  return env.databaseProvider === "mysql";
}

export function hasMySqlConfig() {
  return Boolean(env.mysqlHost && env.mysqlPort && env.mysqlDatabase && env.mysqlUser);
}

export function hasSupabaseConfig() {
  return Boolean(env.supabaseUrl && env.supabaseAnonKey);
}

export function hasSupabaseAdminConfig() {
  return Boolean(env.supabaseUrl && env.supabaseServiceRoleKey);
}
