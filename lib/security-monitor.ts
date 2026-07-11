import { createSecurityEvent, listSecurityEvents } from "@/lib/db";
import { buildAbnormalAccessEvent } from "@/lib/security-audit";
import type { SecurityEvent, UserProfile } from "@/lib/types";

const detectorName = "security_event_burst";
const windowMinutes = 15;
const alertCooldownMinutes = 15;
const riskThreshold = 3;

export async function detectSecurityEventBurst(input: {
  user: UserProfile;
  conversation_id?: string | null;
  message_id?: string | null;
}) {
  const events = await listSecurityEvents();
  const now = Date.now();
  const windowStartedAt = now - windowMinutes * 60 * 1000;
  const cooldownStartedAt = now - alertCooldownMinutes * 60 * 1000;

  const recentUserEvents = events.filter((event) =>
    event.user_id === input.user.id &&
    new Date(event.created_at).getTime() >= windowStartedAt &&
    isRiskEvent(event)
  );

  if (recentUserEvents.length < riskThreshold) {
    return null;
  }

  const recentDetectorAlert = events.some((event) =>
    event.user_id === input.user.id &&
    event.category === "abnormal_access" &&
    event.status !== "resolved" &&
    event.status !== "ignored" &&
    event.metadata?.detector === detectorName &&
    new Date(event.created_at).getTime() >= cooldownStartedAt
  );

  if (recentDetectorAlert) {
    return null;
  }

  const criticalCount = recentUserEvents.filter((event) => event.severity === "critical").length;
  const promptInjectionCount = recentUserEvents.filter((event) => event.category === "prompt_injection").length;
  const sensitiveCount = recentUserEvents.filter((event) =>
    event.category === "sensitive_input" || event.category === "sensitive_output"
  ).length;
  const abnormalCount = recentUserEvents.filter((event) => event.category === "abnormal_access").length;

  return createSecurityEvent(buildAbnormalAccessEvent({
    user: input.user,
    severity: criticalCount > 0 || promptInjectionCount >= 2 ? "critical" : "high",
    title: "短时间内连续触发安全事件",
    detail: `员工在 ${windowMinutes} 分钟内触发 ${recentUserEvents.length} 次安全事件，系统已生成异常访问告警。`,
    conversation_id: input.conversation_id ?? null,
    message_id: input.message_id ?? null,
    metadata: {
      detector: detectorName,
      window_minutes: windowMinutes,
      event_count: recentUserEvents.length,
      critical_count: criticalCount,
      prompt_injection_count: promptInjectionCount,
      sensitive_count: sensitiveCount,
      abnormal_access_count: abnormalCount,
      event_ids: recentUserEvents.slice(0, 10).map((event) => event.id)
    }
  }));
}

function isRiskEvent(event: SecurityEvent) {
  if (event.status === "resolved" || event.status === "ignored") {
    return false;
  }

  if (event.category === "abnormal_access" && event.metadata?.detector === detectorName) {
    return false;
  }

  return (
    event.category === "prompt_injection" ||
    event.category === "sensitive_input" ||
    event.category === "sensitive_output" ||
    event.category === "abnormal_access"
  );
}
