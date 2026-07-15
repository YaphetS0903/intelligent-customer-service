"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ChevronDown, Clock3, ClipboardCheck, Coins, ExternalLink, FilePlus2, ListTodo, Loader2, Lock, MessageSquare, RefreshCw, Send, ShieldAlert, ThumbsDown, ThumbsUp, TrendingUp, UserRound } from "lucide-react";
import type { AdminInsights, ConversationInsight, FeedbackInsight, KnowledgeGap, OperationAlert, QaRemediationTask, SecurityEventInsight, ServiceTicketInsight } from "@/lib/insights";
import type { Citation, KnowledgeBase, KnowledgeTask, ServiceTicketPriority, WorkStatus } from "@/lib/types";
import { fetchWithRetry } from "@/lib/client-fetch";
import { ErrorRetry, PanelSkeleton, useToast } from "@/components/ui-feedback";

type TabKey = "conversations" | "popular" | "feedback" | "tickets" | "security" | "usage" | "gaps" | "qa";
const INITIAL_VISIBLE_ITEMS = 8;

type SupplementInput = {
  knowledge_base_id: string;
  title: string;
  content: string;
  retest?: boolean;
};

const statusLabel: Record<WorkStatus, string> = {
  pending: "待处理",
  processing: "处理中",
  resolved: "已处理",
  ignored: "忽略"
};

const priorityLabel: Record<ServiceTicketPriority, string> = {
  low: "低",
  normal: "普通",
  high: "高",
  urgent: "紧急"
};

const ticketStatusLabel: Record<WorkStatus, string> = {
  pending: "待分派",
  processing: "处理中",
  resolved: "已解决",
  ignored: "已关闭"
};

const securityCoverageItems: Array<{
  category: SecurityEventInsight["category"];
  description: string;
}> = [
  { category: "sensitive_input", description: "员工提问中的手机号、身份证、银行卡等敏感信息" },
  { category: "sensitive_output", description: "模型回答中可能泄露的敏感片段" },
  { category: "prompt_injection", description: "绕过权限、忽略规则、诱导泄密等提示词攻击" },
  { category: "abnormal_access", description: "越权知识访问、连续风险触发和异常行为聚合" }
];

type SecurityCategoryFilter = "all" | SecurityEventInsight["category"];
type SecuritySeverityFilter = "all" | SecurityEventInsight["severity"];
type SecurityStatusFilter = "all" | WorkStatus;

function isInsightsTab(value: string | null): value is TabKey {
  return value === "conversations" ||
    value === "popular" ||
    value === "feedback" ||
    value === "tickets" ||
    value === "security" ||
    value === "usage" ||
    value === "gaps" ||
    value === "qa";
}

export function InsightsAdmin() {
  const { pushToast } = useToast();
  const [insights, setInsights] = useState<AdminInsights | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>("conversations");
  const [selectedConversationId, setSelectedConversationId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [securityCategoryFilter, setSecurityCategoryFilter] = useState<SecurityCategoryFilter>("all");
  const [securitySeverityFilter, setSecuritySeverityFilter] = useState<SecuritySeverityFilter>("all");
  const [securityStatusFilter, setSecurityStatusFilter] = useState<SecurityStatusFilter>("all");
  const [visibleItems, setVisibleItems] = useState(INITIAL_VISIBLE_ITEMS);

  useEffect(() => {
    const tab = new URLSearchParams(window.location.search).get("tab");
    if (isInsightsTab(tab)) {
      setActiveTab(tab);
    }
    void loadInsights();
  }, []);

  useEffect(() => {
    setVisibleItems(INITIAL_VISIBLE_ITEMS);
  }, [activeTab, securityCategoryFilter, securitySeverityFilter, securityStatusFilter]);

  const selectedConversation = useMemo(() => {
    return insights?.conversations.find((conversation) => conversation.id === selectedConversationId)
      ?? insights?.conversations[0]
      ?? null;
  }, [insights, selectedConversationId]);
  const securityOverview = useMemo(
    () => buildSecurityOverview(insights?.securityEvents ?? []),
    [insights?.securityEvents]
  );
  const filteredSecurityEvents = useMemo(
    () => filterSecurityEvents(insights?.securityEvents ?? [], {
      category: securityCategoryFilter,
      severity: securitySeverityFilter,
      status: securityStatusFilter
    }),
    [insights?.securityEvents, securityCategoryFilter, securitySeverityFilter, securityStatusFilter]
  );

  function pushSuccess(title: string, description?: string) {
    pushToast({
      tone: "success",
      title,
      description
    });
  }

  function pushActionError(error: unknown, fallback: string) {
    pushToast({
      tone: "error",
      title: fallback,
      description: error instanceof Error ? error.message : "请稍后重试。"
    });
  }

  async function loadInsights() {
    setLoading(true);
    setLoadError(null);

    try {
      const response = await fetchWithRetry("/api/admin/insights", { cache: "no-store" });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "获取运营数据失败");
      }

      setInsights(data.insights);
      setSelectedConversationId((current) => current || data.insights.conversations[0]?.id || "");
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "获取运营数据失败");
    } finally {
      setLoading(false);
    }
  }

  async function updateFeedback(item: FeedbackInsight, input: {
    status?: WorkStatus;
    resolution_note?: string | null;
    needs_knowledge_update?: boolean;
  }) {
    setSavingId(item.id);
    setLoadError(null);

    try {
      const response = await fetch(`/api/admin/feedback/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: input.status ?? item.status,
          resolution_note: input.resolution_note ?? item.resolution_note,
          needs_knowledge_update: input.needs_knowledge_update ?? item.needs_knowledge_update
        })
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "更新反馈失败");
      }

      await loadInsights();
      pushSuccess("反馈处理状态已更新");
    } catch (error) {
      pushActionError(error, "更新反馈失败");
    } finally {
      setSavingId(null);
    }
  }

  async function createTask(gap: KnowledgeGap) {
    setSavingId(gap.id);
    setLoadError(null);

    try {
      const response = await fetch("/api/admin/knowledge-tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: gap.source === "dislike" ? "feedback" : "no_citation",
          source_id: gap.source_id,
          conversation_id: gap.conversation_id,
          question: gap.question,
          answer: gap.answer,
          status: "pending",
          note: gap.note
        })
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "创建任务失败");
      }

      await loadInsights();
      pushSuccess("已创建待补充知识任务");
    } catch (error) {
      pushActionError(error, "创建任务失败");
    } finally {
      setSavingId(null);
    }
  }

  async function createTaskFromFeedback(item: FeedbackInsight) {
    if (!item.message || !item.conversation) {
      pushToast({
        tone: "warning",
        title: "无法创建整改任务",
        description: "该反馈缺少对应会话消息。"
      });
      return;
    }

    setSavingId(item.id);
    setLoadError(null);

    try {
      const response = await fetch("/api/admin/knowledge-tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: "feedback",
          source_id: item.id,
          conversation_id: item.conversation.id,
          question: item.question ?? "未找到对应问题",
          answer: item.message.content,
          status: "pending",
          note: item.comment ? `员工反馈：${item.comment}` : "员工点选需改进，请复核该回答。"
        })
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "创建整改任务失败");
      }

      await loadInsights();
      pushSuccess("已从反馈创建整改任务");
    } catch (error) {
      pushActionError(error, "创建整改任务失败");
    } finally {
      setSavingId(null);
    }
  }

  async function updateTask(gap: KnowledgeGap, input: { status?: WorkStatus; note?: string | null }) {
    if (!gap.task_id) {
      return;
    }

    setSavingId(gap.task_id);
    setLoadError(null);

    try {
      const response = await fetch(`/api/admin/knowledge-tasks/${gap.task_id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: input.status ?? gap.status,
          note: input.note ?? gap.note
        })
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "更新任务失败");
      }

      await loadInsights();
      pushSuccess("任务状态已更新");
    } catch (error) {
      pushActionError(error, "更新任务失败");
    } finally {
      setSavingId(null);
    }
  }

  async function updateKnowledgeTask(task: KnowledgeTask, input: { status?: WorkStatus; note?: string | null }) {
    setSavingId(task.id);
    setLoadError(null);

    try {
      const response = await fetch(`/api/admin/knowledge-tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: input.status ?? task.status,
          note: input.note ?? task.note
        })
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "更新任务失败");
      }

      await loadInsights();
      pushSuccess("整改任务已更新");
    } catch (error) {
      pushActionError(error, "更新任务失败");
    } finally {
      setSavingId(null);
    }
  }

  async function retestKnowledgeTask(taskId: string) {
    setSavingId(`retest:${taskId}`);
    setLoadError(null);

    try {
      const response = await fetch(`/api/admin/knowledge-tasks/${taskId}/retest`, {
        method: "POST"
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "复测失败");
      }

      await loadInsights();
      pushSuccess("复测完成", data.status === "resolved" ? "已通过" : "仍需整改");
    } catch (error) {
      pushActionError(error, "复测失败");
    } finally {
      setSavingId(null);
    }
  }

  async function supplementKnowledgeTask(taskId: string, input: SupplementInput) {
    setSavingId(`supplement:${taskId}`);
    setLoadError(null);

    try {
      const response = await fetch(`/api/admin/knowledge-tasks/${taskId}/supplement`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input)
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "补充知识失败");
      }

      await loadInsights();
      if (data.retest) {
        pushSuccess("已补充到知识库并完成复测", data.retest.status === "resolved" ? "已通过" : "仍需整改");
      } else {
        pushSuccess("已补充到知识库", `生成 ${data.chunks ?? 0} 个可检索片段，可继续自动复测。`);
      }
    } catch (error) {
      pushActionError(error, "补充知识失败");
    } finally {
      setSavingId(null);
    }
  }

  async function updateTicket(ticket: ServiceTicketInsight, input: {
    status?: WorkStatus;
    priority?: ServiceTicketPriority;
    assignee_id?: string | null;
    resolution_note?: string | null;
    due_at?: string | null;
  }) {
    setSavingId(ticket.id);
    setLoadError(null);

    try {
      const response = await fetch(`/api/admin/tickets/${ticket.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input)
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "更新工单失败");
      }

      await loadInsights();
      pushSuccess("工单状态已更新");
    } catch (error) {
      pushActionError(error, "更新工单失败");
    } finally {
      setSavingId(null);
    }
  }

  async function addTicketComment(ticket: ServiceTicketInsight, input: { body: string; is_internal: boolean }) {
    setSavingId(`comment:${ticket.id}`);
    setLoadError(null);

    try {
      const response = await fetch(`/api/tickets/${ticket.id}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input)
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "添加处理记录失败");
      }

      await loadInsights();
      pushSuccess("处理记录已添加");
    } catch (error) {
      pushActionError(error, "添加处理记录失败");
    } finally {
      setSavingId(null);
    }
  }

  async function updateSecurityEvent(event: SecurityEventInsight, input: { status: WorkStatus }) {
    setSavingId(event.id);
    setLoadError(null);

    try {
      const response = await fetch(`/api/admin/security-events/${event.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input)
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "更新安全事件失败");
      }

      await loadInsights();
      pushSuccess("安全事件状态已更新");
    } catch (error) {
      pushActionError(error, "更新安全事件失败");
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div className="space-y-3 pb-6">
      <header className="flex flex-col gap-3 border-b border-line pb-3 sm:flex-row sm:items-center sm:justify-between" data-testid="insights-header">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-cyan/10 text-brand">
              <MessageSquare size={18} />
            </span>
            <div className="min-w-0">
              <h1 className="text-xl font-semibold text-ink">会话与反馈</h1>
              <p className="truncate text-sm text-slate-500">会话审计、反馈、工单与知识整改</p>
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void loadInsights()}
          disabled={loading}
          className="ui-button-secondary h-9 self-start px-3 sm:self-auto"
        >
          {loading ? <Loader2 className="animate-spin" size={16} /> : <RefreshCw size={16} />}
          刷新
        </button>
      </header>

      {loadError && (
        <ErrorRetry
          title="运营数据加载失败"
          message={loadError}
          retrying={loading}
          onRetry={() => void loadInsights()}
        />
      )}

      {loading && !insights && (
        <section className="grid gap-3 lg:grid-cols-2">
          <PanelSkeleton rows={4} />
          <PanelSkeleton rows={4} />
        </section>
      )}

      {insights && insights.securityAlerts.length > 0 && (
        <SecurityAlertPanel
          alerts={insights.securityAlerts}
          criticalCount={insights.totals.criticalSecurityEvents}
          highCount={insights.totals.highRiskSecurityEvents}
          onOpenSecurity={() => setActiveTab("security")}
        />
      )}

      {insights && insights.operationAlerts.length > 0 && (
        <OperationAlertPanel
          alerts={insights.operationAlerts}
          onOpenQa={() => setActiveTab("qa")}
          onOpenQaTests={() => {
            window.location.href = "/admin/qa-tests";
          }}
        />
      )}

      <section className="ui-card p-1.5">
        <label className="sr-only" htmlFor="insights-tab">审计与工单视图</label>
        <select
          id="insights-tab"
          value={activeTab}
          onChange={(event) => setActiveTab(event.target.value as TabKey)}
          className="h-10 w-full rounded-md border-0 bg-slate-50 px-3 text-sm font-semibold text-ink outline-none focus:ring-2 focus:ring-brand/30 sm:hidden"
        >
          <option value="conversations">会话审计</option>
          <option value="popular">热门问题</option>
          <option value="feedback">反馈记录</option>
          <option value="tickets">人工工单</option>
          <option value="security">安全审计</option>
          <option value="usage">模型用量</option>
          <option value="gaps">待补充知识</option>
          <option value="qa">QA 整改</option>
        </select>
        <div className="hidden gap-1 sm:grid sm:grid-cols-4 xl:grid-cols-8">
          <TabButton active={activeTab === "conversations"} onClick={() => setActiveTab("conversations")}>
            会话审计
          </TabButton>
          <TabButton active={activeTab === "popular"} onClick={() => setActiveTab("popular")}>
            热门问题
            {insights && insights.totals.popularQuestions > 0 ? ` · ${insights.totals.popularQuestions}` : ""}
          </TabButton>
          <TabButton active={activeTab === "feedback"} onClick={() => setActiveTab("feedback")}>
            反馈记录
          </TabButton>
          <TabButton active={activeTab === "tickets"} onClick={() => setActiveTab("tickets")}>
            人工工单
          </TabButton>
          <TabButton active={activeTab === "security"} onClick={() => setActiveTab("security")}>
            安全审计
            {insights && insights.totals.openSecurityEvents > 0 ? ` · ${insights.totals.openSecurityEvents}` : ""}
          </TabButton>
          <TabButton active={activeTab === "usage"} onClick={() => setActiveTab("usage")}>
            模型用量
            {insights && insights.totals.modelUsageEvents > 0 ? ` · ${insights.totals.modelUsageEvents}` : ""}
          </TabButton>
          <TabButton active={activeTab === "gaps"} onClick={() => setActiveTab("gaps")}>
            待补充知识
          </TabButton>
          <TabButton active={activeTab === "qa"} onClick={() => setActiveTab("qa")}>
            QA 整改
          </TabButton>
        </div>
      </section>

      {insights && (
        <>
          <section className="space-y-2" data-testid="metrics-overview">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <PrimaryMetric
                testId="primary-metric-pending-work"
                icon={ListTodo}
                label="待处理事项"
                value={insights.totals.pendingWork}
                helper={`已处理 ${insights.totals.resolvedWork} 项`}
                tone="warn"
              />
              <PrimaryMetric
                testId="primary-metric-ticket-risk"
                icon={Clock3}
                label="待办工单"
                value={insights.totals.pendingTickets}
                helper={`其中超时 ${insights.totals.overdueTickets} 项`}
                tone={insights.totals.overdueTickets > 0 ? "bad" : "good"}
              />
              <PrimaryMetric
                testId="primary-metric-security-risk"
                icon={ShieldAlert}
                label="待审安全事件"
                value={insights.totals.openSecurityEvents}
                helper={`高危及严重 ${insights.totals.highRiskSecurityEvents + insights.totals.criticalSecurityEvents} 项`}
                tone={insights.totals.openSecurityEvents > 0 ? "bad" : "good"}
              />
              <PrimaryMetric
                testId="primary-metric-knowledge-quality"
                icon={ClipboardCheck}
                label="待完善知识"
                value={insights.totals.knowledgeGaps + insights.totals.qaRemediationTasks}
                helper={`知识缺口 ${insights.totals.knowledgeGaps} · QA 整改 ${insights.totals.qaRemediationTasks}`}
                tone={insights.totals.knowledgeGaps + insights.totals.qaRemediationTasks > 0 ? "warn" : "good"}
              />
            </div>

            <details className="ui-card group overflow-hidden" data-testid="metrics-details">
              <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between gap-3 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand/40 [&::-webkit-details-marker]:hidden">
                <span>查看全部指标</span>
                <ChevronDown className="size-4 shrink-0 text-slate-500 transition-transform duration-200 group-open:rotate-180" aria-hidden="true" />
              </summary>
              <div className="grid border-t border-line md:grid-cols-2 xl:grid-cols-4">
                <MetricGroup title="业务规模" testId="metric-group-business">
                  <Metric label="会话" value={insights.totals.conversations} />
                  <Metric label="消息" value={insights.totals.messages} />
                  <Metric label="反馈" value={insights.totals.feedback} />
                  <Metric label="工单" value={insights.totals.tickets} />
                  <Metric label="热门问题" value={insights.totals.popularQuestions} />
                </MetricGroup>
                <MetricGroup title="问答质量" testId="metric-group-quality">
                  <Metric label="点赞" value={insights.totals.likes} tone="good" />
                  <Metric label="点踩" value={insights.totals.dislikes} tone="bad" />
                  <Metric label="无引用回答" value={insights.totals.unreferencedAnswers} tone="warn" />
                  <Metric label="待补充知识" value={insights.totals.knowledgeGaps} tone="warn" />
                  <Metric label="QA 整改" value={insights.totals.qaRemediationTasks} tone="warn" />
                </MetricGroup>
                <MetricGroup title="模型用量" testId="metric-group-usage">
                  <Metric label="模型调用" value={insights.totals.modelUsageEvents} />
                  <Metric label="Token" value={formatTokenNumber(insights.totals.modelTokens)} />
                  <Metric label="估算用量" value={insights.totals.estimatedModelUsageEvents} tone={insights.totals.estimatedModelUsageEvents > 0 ? "warn" : "good"} />
                  <Metric label="成本" value={formatUsd(insights.totals.modelCostUsd)} />
                </MetricGroup>
                <MetricGroup title="整改闭环" testId="metric-group-remediation">
                  <Metric label="待办工单" value={insights.totals.pendingTickets} tone="warn" />
                  <Metric label="超时工单" value={insights.totals.overdueTickets} tone={insights.totals.overdueTickets > 0 ? "bad" : "good"} />
                  <Metric label="安全事件" value={insights.totals.securityEvents} tone="bad" />
                  <Metric label="待审安全" value={insights.totals.openSecurityEvents} tone="warn" />
                  <Metric label="高危告警" value={insights.totals.highRiskSecurityEvents + insights.totals.criticalSecurityEvents} tone="bad" />
                  <Metric label="运营告警" value={insights.totals.operationAlerts} tone={insights.totals.operationAlerts > 0 ? "warn" : "good"} />
                  <Metric label="待处理" value={insights.totals.pendingWork} tone="warn" />
                  <Metric label="已处理" value={insights.totals.resolvedWork} tone="good" />
                </MetricGroup>
              </div>
            </details>
          </section>

          {activeTab === "conversations" && (
            <section className="grid min-w-0 gap-5 xl:grid-cols-[360px_minmax(0,1fr)]">
              <div className="min-w-0 space-y-2">
                {insights.conversations.slice(0, visibleItems).map((conversation) => (
                  <button
                    key={conversation.id}
                    type="button"
                    onClick={() => setSelectedConversationId(conversation.id)}
                    className={`w-full rounded-lg border bg-white px-4 py-3 text-left transition ${
                      selectedConversation?.id === conversation.id
                        ? "border-cyan bg-cyan/10"
                        : "border-line hover:bg-slate-50"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-ink">{conversation.title}</p>
                        <p className="mt-1 text-xs text-slate-500">{conversation.user?.email ?? "未知用户"}</p>
                      </div>
                      {conversation.dislikes > 0 && (
                        <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs text-red-700">
                          {conversation.dislikes} 点踩
                        </span>
                      )}
                    </div>
                    <p className="mt-2 text-xs text-slate-500">
                      {conversation.message_count} 条消息 · {new Date(conversation.updated_at).toLocaleString("zh-CN")}
                    </p>
                  </button>
                ))}
                {insights.conversations.length === 0 && (
                  <EmptyState text="暂无员工会话。" />
                )}
                <ListPager
                  total={insights.conversations.length}
                  visible={visibleItems}
                  onChange={setVisibleItems}
                />
              </div>

              <ConversationDetail conversation={selectedConversation} />
            </section>
          )}

          {activeTab === "popular" && (
            <section className="space-y-3">
              <PopularQuestionsPanel
                questions={insights.popularQuestions.slice(0, visibleItems)}
                onOpenConversation={(conversationId) => {
                  setSelectedConversationId(conversationId);
                  setActiveTab("conversations");
                }}
              />
              <ListPager total={insights.popularQuestions.length} visible={visibleItems} onChange={setVisibleItems} />
            </section>
          )}

          {activeTab === "feedback" && (
            <section className="grid gap-3">
              {insights.feedback.slice(0, visibleItems).map((item) => (
                <FeedbackCard
                  key={item.id}
                  item={item}
                  saving={savingId === item.id || (item.task_id ? savingId === `retest:${item.task_id}` : false)}
                  onUpdate={(input) => void updateFeedback(item, input)}
                  onCreateTask={() => void createTaskFromFeedback(item)}
                  onRetestTask={item.task_id ? () => void retestKnowledgeTask(item.task_id as string) : undefined}
                />
              ))}
              {insights.feedback.length === 0 && <EmptyState text="暂无反馈记录。" />}
              <ListPager total={insights.feedback.length} visible={visibleItems} onChange={setVisibleItems} />
            </section>
          )}

          {activeTab === "tickets" && (
            <section className="grid gap-3">
              {insights.tickets.slice(0, visibleItems).map((ticket) => (
                <TicketCard
                  key={ticket.id}
                  ticket={ticket}
                  users={insights.users}
                  saving={savingId === ticket.id}
                  commentSaving={savingId === `comment:${ticket.id}`}
                  onUpdate={(input) => void updateTicket(ticket, input)}
                  onComment={(input) => void addTicketComment(ticket, input)}
                />
              ))}
              {insights.tickets.length === 0 && <EmptyState text="暂无人工工单。" />}
              <ListPager total={insights.tickets.length} visible={visibleItems} onChange={setVisibleItems} />
            </section>
          )}

          {activeTab === "security" && (
            <section className="grid gap-3">
              <SecurityAuditSummary
                overview={securityOverview}
                filteredCount={filteredSecurityEvents.length}
              />
              <SecurityAuditFilters
                category={securityCategoryFilter}
                severity={securitySeverityFilter}
                status={securityStatusFilter}
                onCategoryChange={setSecurityCategoryFilter}
                onSeverityChange={setSecuritySeverityFilter}
                onStatusChange={setSecurityStatusFilter}
                onReset={() => {
                  setSecurityCategoryFilter("all");
                  setSecuritySeverityFilter("all");
                  setSecurityStatusFilter("all");
                }}
              />
              <SecurityCoverageLegend />
              {filteredSecurityEvents.slice(0, visibleItems).map((event) => (
                <SecurityEventCard
                  key={event.id}
                  event={event}
                  saving={savingId === event.id}
                  onUpdate={(input) => void updateSecurityEvent(event, input)}
                  onOpenConversation={(conversationId) => {
                    setSelectedConversationId(conversationId);
                    setActiveTab("conversations");
                  }}
                />
              ))}
              {insights.securityEvents.length === 0 && <EmptyState text="暂无安全审计事件。" />}
              {insights.securityEvents.length > 0 && filteredSecurityEvents.length === 0 && (
                <EmptyState text="没有符合筛选条件的安全审计事件。" />
              )}
              <ListPager total={filteredSecurityEvents.length} visible={visibleItems} onChange={setVisibleItems} />
            </section>
          )}

          {activeTab === "usage" && (
            <UsagePanel usage={insights.modelUsage} />
          )}

          {activeTab === "gaps" && (
            <section className="grid gap-3">
              {insights.knowledgeGaps.slice(0, visibleItems).map((gap) => (
                <GapCard
                  key={gap.id}
                  gap={gap}
                  knowledgeBases={insights.knowledgeBases}
                  saving={savingId === gap.id || (gap.task_id !== null && (savingId === gap.task_id || savingId === `retest:${gap.task_id}` || savingId === `supplement:${gap.task_id}`))}
                  onCreateTask={() => void createTask(gap)}
                  onUpdateTask={(input) => void updateTask(gap, input)}
                  onRetestTask={gap.task_id ? () => void retestKnowledgeTask(gap.task_id as string) : undefined}
                  onSupplementTask={gap.task_id ? (input) => void supplementKnowledgeTask(gap.task_id as string, input) : undefined}
                />
              ))}
              {insights.knowledgeGaps.length === 0 && <EmptyState text="暂无待补充知识线索。" />}
              <ListPager total={insights.knowledgeGaps.length} visible={visibleItems} onChange={setVisibleItems} />
            </section>
          )}

          {activeTab === "qa" && (
            <section className="grid gap-3">
              {insights.qaRemediationTasks.slice(0, visibleItems).map((task) => (
                <QaRemediationCard
                  key={task.id}
                  task={task}
                  knowledgeBases={insights.knowledgeBases}
                  saving={savingId === task.id || savingId === `retest:${task.id}` || savingId === `supplement:${task.id}`}
                  onUpdate={(input) => void updateKnowledgeTask(task, input)}
                  onRetest={() => void retestKnowledgeTask(task.id)}
                  onSupplement={(input) => void supplementKnowledgeTask(task.id, input)}
                />
              ))}
              {insights.qaRemediationTasks.length === 0 && <EmptyState text="暂无 QA 整改任务。" />}
              <ListPager total={insights.qaRemediationTasks.length} visible={visibleItems} onChange={setVisibleItems} />
            </section>
          )}
        </>
      )}
    </div>
  );
}

function formatTokenNumber(value: number) {
  if (value < 10000) {
    return value.toLocaleString("zh-CN");
  }

  return new Intl.NumberFormat("zh-CN", {
    notation: "compact",
    maximumFractionDigits: 1
  }).format(value);
}

function formatUsd(value: number | null) {
  if (value === null || !Number.isFinite(value)) {
    return "未配置";
  }

  const digits = value > 0 && value < 0.01 ? 4 : 2;
  return `$${value.toFixed(digits)}`;
}

function formatProviderModel(provider: string | null, model: string | null) {
  if (provider && model) {
    return `${provider} / ${model}`;
  }

  return model ?? provider ?? "未记录";
}

function usageModeLabel(metadata: Record<string, unknown>) {
  const mode = typeof metadata.mode === "string" ? metadata.mode : "";
  const ragProvider = typeof metadata.rag_provider === "string" ? metadata.rag_provider : "";

  if (mode === "stream") {
    return ragProvider ? `流式 · ${ragProvider}` : "流式";
  }

  if (mode === "non_stream") {
    return ragProvider ? `非流式 · ${ragProvider}` : "非流式";
  }

  return "";
}

function PopularQuestionsPanel({
  questions,
  onOpenConversation
}: {
  questions: AdminInsights["popularQuestions"];
  onOpenConversation: (conversationId: string) => void;
}) {
  if (questions.length === 0) {
    return <EmptyState text="暂无重复或风险较高的问题。员工问答积累后会在这里显示高频问题。" />;
  }

  return (
    <section className="grid gap-3">
      {questions.map((item, index) => {
        const riskCount = item.no_citation_answers + item.disliked_answers;
        return (
          <article key={item.id} className="ui-card p-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1 rounded-full bg-cyan/10 px-2.5 py-1 text-xs font-semibold text-brand">
                    <TrendingUp size={13} />
                    TOP {index + 1}
                  </span>
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
                    {item.count} 次提问
                  </span>
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
                    {item.user_count} 名员工
                  </span>
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
                    {item.conversation_count} 个会话
                  </span>
                  {riskCount > 0 && (
                    <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700 ring-1 ring-amber-200">
                      {riskCount} 次需复核
                    </span>
                  )}
                </div>
                <h2 className="mt-3 text-base font-semibold leading-6 text-ink">{item.question}</h2>
                <p className="mt-2 text-xs text-slate-500">
                  最近：{new Date(item.last_asked_at).toLocaleString("zh-CN")} · {item.latest_user_email}
                  {item.departments.length > 0 ? ` · 部门：${item.departments.join("、")}` : ""}
                </p>
              </div>
              <button
                type="button"
                onClick={() => onOpenConversation(item.latest_conversation_id)}
                className="ui-button-secondary h-9 shrink-0 px-3 text-xs"
              >
                <ExternalLink size={14} />
                查看会话
              </button>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-4">
              <MiniStat label="无引用回答" value={item.no_citation_answers} tone={item.no_citation_answers > 0 ? "warn" : "good"} />
              <MiniStat label="点踩回答" value={item.disliked_answers} tone={item.disliked_answers > 0 ? "bad" : "good"} />
              <MiniStat label="首次出现" value={new Date(item.first_asked_at).toLocaleDateString("zh-CN")} />
              <MiniStat label="归一化" value={item.normalized_question.slice(0, 18) || "-"} />
            </div>

            {item.latest_answer && (
              <div className="mt-4 rounded-lg border border-line bg-slate-50 px-3 py-3">
                <p className="text-xs font-medium text-slate-500">最近回答摘要</p>
                <p className="mt-2 text-sm leading-6 text-slate-700">{item.latest_answer}</p>
              </div>
            )}
          </article>
        );
      })}
    </section>
  );
}

function MiniStat({
  label,
  value,
  tone
}: {
  label: string;
  value: string | number;
  tone?: "good" | "warn" | "bad";
}) {
  const toneClass = tone === "good"
    ? "text-emerald-700"
    : tone === "warn"
      ? "text-amber-700"
      : tone === "bad"
        ? "text-red-700"
        : "text-ink";

  return (
    <div className="rounded-lg border border-line bg-white px-3 py-2">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className={`mt-1 truncate text-sm font-semibold ${toneClass}`}>{value}</p>
    </div>
  );
}

function UsagePanel({ usage }: { usage: AdminInsights["modelUsage"] }) {
  if (usage.total_events === 0) {
    return <EmptyState text="暂无模型用量记录。" />;
  }

  return (
    <section className="space-y-4">
      <div className="grid gap-3 md:grid-cols-4">
        <UsageStat
          icon={<Coins size={18} />}
          label="今日 Token"
          value={formatTokenNumber(usage.today_tokens)}
          helper={formatUsd(usage.today_cost_usd)}
        />
        <UsageStat
          icon={<Coins size={18} />}
          label="近 7 天 Token"
          value={formatTokenNumber(usage.seven_day_tokens)}
          helper={formatUsd(usage.seven_day_cost_usd)}
        />
        <UsageStat
          icon={<MessageSquare size={18} />}
          label="总调用"
          value={usage.total_events.toLocaleString("zh-CN")}
          helper={`${usage.estimated_events.toLocaleString("zh-CN")} 条估算`}
        />
        <UsageStat
          icon={<ClipboardCheck size={18} />}
          label="累计成本"
          value={formatUsd(usage.cost_usd)}
          helper={`${formatTokenNumber(usage.total_tokens)} Token`}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <UsageAggregatePanel title="按来源" rows={usage.by_source} />
        <UsageAggregatePanel title="按用户" rows={usage.by_user} />
      </div>

      <div className="ui-card overflow-hidden">
        <div className="border-b border-line px-5 py-4">
          <h2 className="text-base font-semibold text-ink">最近调用明细</h2>
          <p className="mt-1 text-sm text-slate-500">真实 usage 和估算 usage 会分开标记，成本取决于环境变量单价配置。</p>
        </div>
        <div className="grid gap-3 p-4 lg:hidden">
          {usage.recent.map((event) => (
            <UsageRecentCard key={event.id} event={event} />
          ))}
          {usage.recent.length === 0 && (
            <p className="rounded-lg border border-dashed border-line px-3 py-4 text-sm text-slate-500">
              暂无最近调用明细。
            </p>
          )}
        </div>
        <div className="hidden overflow-x-auto lg:block">
          <table className="min-w-[880px] w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-5 py-3 font-semibold">时间</th>
                <th className="px-5 py-3 font-semibold">来源</th>
                <th className="px-5 py-3 font-semibold">模型</th>
                <th className="px-5 py-3 font-semibold">用户</th>
                <th className="px-5 py-3 text-right font-semibold">输入</th>
                <th className="px-5 py-3 text-right font-semibold">输出</th>
                <th className="px-5 py-3 text-right font-semibold">总 Token</th>
                <th className="px-5 py-3 text-right font-semibold">成本</th>
                <th className="px-5 py-3 font-semibold">口径</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {usage.recent.map((event) => (
                <tr key={event.id} className="hover:bg-slate-50">
                  <td className="px-5 py-3 text-slate-500">{new Date(event.created_at).toLocaleString("zh-CN")}</td>
                  <td className="px-5 py-3">
                    <span className="rounded-full bg-cyan/10 px-2.5 py-1 text-xs font-medium text-brand">
                      {event.source_label}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-slate-700">
                    {formatProviderModel(event.provider, event.model)}
                  </td>
                  <td className="px-5 py-3 text-slate-600">
                    {event.user?.email ?? event.user_id ?? "系统"}
                  </td>
                  <td className="px-5 py-3 text-right tabular-nums text-slate-700">
                    {event.input_tokens.toLocaleString("zh-CN")}
                  </td>
                  <td className="px-5 py-3 text-right tabular-nums text-slate-700">
                    {event.output_tokens.toLocaleString("zh-CN")}
                  </td>
                  <td className="px-5 py-3 text-right tabular-nums font-semibold text-ink">
                    {event.total_tokens.toLocaleString("zh-CN")}
                  </td>
                  <td className="px-5 py-3 text-right tabular-nums text-slate-700">
                    {formatUsd(event.cost_usd)}
                  </td>
                  <td className="px-5 py-3">
                    <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                      event.estimated ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700"
                    }`}>
                      {event.estimated ? "估算" : "真实"}
                    </span>
                    <span className="ml-2 text-xs text-slate-400">{usageModeLabel(event.metadata)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function UsageRecentCard({ event }: { event: AdminInsights["modelUsage"]["recent"][number] }) {
  return (
    <article className="rounded-lg border border-line bg-white p-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-cyan/10 px-2.5 py-1 text-xs font-medium text-brand">
              {event.source_label}
            </span>
            <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${
              event.estimated ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700"
            }`}>
              {event.estimated ? "估算" : "真实"}
            </span>
          </div>
          <p className="mt-2 break-words text-sm font-semibold text-ink">
            {formatProviderModel(event.provider, event.model)}
          </p>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            {new Date(event.created_at).toLocaleString("zh-CN")} · {event.user?.email ?? event.user_id ?? "系统"}
          </p>
        </div>
        <div className="shrink-0 rounded-lg bg-slate-50 px-3 py-2 text-left sm:text-right">
          <p className="text-sm font-semibold tabular-nums text-ink">
            {event.total_tokens.toLocaleString("zh-CN")} Token
          </p>
          <p className="mt-1 text-xs text-slate-500">{formatUsd(event.cost_usd)}</p>
        </div>
      </div>
      <div className="mt-3 grid gap-2 text-xs text-slate-600 sm:grid-cols-3">
        <span className="rounded-lg bg-slate-50 px-3 py-2">输入：{event.input_tokens.toLocaleString("zh-CN")}</span>
        <span className="rounded-lg bg-slate-50 px-3 py-2">输出：{event.output_tokens.toLocaleString("zh-CN")}</span>
        <span className="rounded-lg bg-slate-50 px-3 py-2">口径：{usageModeLabel(event.metadata) || "未记录"}</span>
      </div>
    </article>
  );
}

function UsageStat({
  icon,
  label,
  value,
  helper
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  helper: string;
}) {
  return (
    <div className="ui-card p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-medium text-slate-500">{label}</p>
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-cyan/10 text-brand">
          {icon}
        </span>
      </div>
      <p className="mt-2 text-2xl font-semibold text-ink">{value}</p>
      <p className="mt-1 text-xs text-slate-500">{helper}</p>
    </div>
  );
}

function UsageAggregatePanel({
  title,
  rows
}: {
  title: string;
  rows: AdminInsights["modelUsage"]["by_source"];
}) {
  const maxTokens = Math.max(...rows.map((row) => row.total_tokens), 1);

  return (
    <div className="ui-card p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-ink">{title}</h2>
        <span className="text-xs text-slate-400">{rows.length} 项</span>
      </div>
      <div className="mt-4 space-y-3">
        {rows.map((row) => (
          <div key={row.key} className="rounded-lg border border-line px-3 py-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-ink">{row.label}</p>
                <p className="mt-1 text-xs text-slate-500">
                  {row.events.toLocaleString("zh-CN")} 次 · {row.estimated_events.toLocaleString("zh-CN")} 条估算
                </p>
              </div>
              <div className="text-right">
                <p className="text-sm font-semibold tabular-nums text-ink">{formatTokenNumber(row.total_tokens)}</p>
                <p className="mt-1 text-xs text-slate-500">{formatUsd(row.cost_usd)}</p>
              </div>
            </div>
            <div className="mt-3 h-2 rounded-full bg-slate-100">
              <div
                className="h-2 rounded-full bg-brand"
                style={{ width: `${Math.max(4, Math.round(row.total_tokens / maxTokens * 100))}%` }}
              />
            </div>
          </div>
        ))}
        {rows.length === 0 && <p className="rounded-lg border border-dashed border-line px-3 py-4 text-sm text-slate-500">暂无数据。</p>}
      </div>
    </div>
  );
}

function TicketCard({
  ticket,
  users,
  saving,
  commentSaving,
  onUpdate,
  onComment
}: {
  ticket: ServiceTicketInsight;
  users: AdminInsights["users"];
  saving: boolean;
  commentSaving: boolean;
  onUpdate: (input: {
    status?: WorkStatus;
    priority?: ServiceTicketPriority;
    assignee_id?: string | null;
    resolution_note?: string | null;
    due_at?: string | null;
  }) => void;
  onComment: (input: { body: string; is_internal: boolean }) => void;
}) {
  const [note, setNote] = useState(ticket.resolution_note ?? "");
  const [comment, setComment] = useState("");
  const [internalComment, setInternalComment] = useState(false);

  useEffect(() => {
    setNote(ticket.resolution_note ?? "");
  }, [ticket.resolution_note]);

  const adminUsers = users.filter((user) => user.role === "admin");
  const dueAt = ticket.due_at ? new Date(ticket.due_at) : null;
  const resolvedAt = ticket.resolved_at ? new Date(ticket.resolved_at) : null;
  const dueLabel = dueAt ? dueAt.toLocaleString("zh-CN") : "未设置";
  const assigneeValue = ticket.assignee_id ?? "";

  return (
    <article className="ui-card p-4">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1 rounded-full bg-cyan/10 px-2.5 py-1 text-xs font-medium text-brand">
              <MessageSquare size={13} />
              人工工单
            </span>
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
              {ticketStatusLabel[ticket.status]}
            </span>
            <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700">
              {priorityLabel[ticket.priority]}
            </span>
            {ticket.overdue && (
              <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-700">
                <Clock3 size={13} />
                已超时
              </span>
            )}
            <span className="text-xs text-slate-500">{new Date(ticket.updated_at).toLocaleString("zh-CN")}</span>
          </div>
          <h3 className="mt-3 text-sm font-semibold leading-6 text-ink">{ticket.title}</h3>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-600">{ticket.description}</p>
          <div className="mt-3 grid gap-3 lg:grid-cols-4">
            <div className="rounded-lg bg-slate-50 p-3">
              <p className="text-xs font-medium text-slate-500">提交员工</p>
              <p className="mt-1 text-sm text-slate-700">
                {ticket.user?.name ?? "未知用户"} · {ticket.user?.department || "未设置部门"}
              </p>
              <p className="mt-1 text-xs text-slate-500">{ticket.user?.email ?? ticket.user_id}</p>
            </div>
            <div className="rounded-lg bg-slate-50 p-3">
              <p className="text-xs font-medium text-slate-500">处理人</p>
              <p className="mt-1 text-sm text-slate-700">{ticket.assignee?.name ?? "未指派"}</p>
              <p className="mt-1 text-xs text-slate-500">{ticket.assignee?.email ?? ticket.assignee_id ?? "可在下方分派"}</p>
            </div>
            <div className="rounded-lg bg-slate-50 p-3">
              <p className="text-xs font-medium text-slate-500">SLA 到期</p>
              <p className={`mt-1 text-sm ${ticket.overdue ? "font-semibold text-red-700" : "text-slate-700"}`}>{dueLabel}</p>
              <p className="mt-1 text-xs text-slate-500">{resolvedAt ? `完成：${resolvedAt.toLocaleString("zh-CN")}` : "未完成"}</p>
            </div>
            <div className="rounded-lg bg-slate-50 p-3">
              <p className="text-xs font-medium text-slate-500">关联会话</p>
              <p className="mt-1 text-sm text-slate-700">{ticket.conversation?.title ?? ticket.conversation_id}</p>
              <p className="mt-1 text-xs text-slate-500">消息：{ticket.message_id ?? "未关联具体回答"}</p>
            </div>
          </div>
          {ticket.message && (
            <div className="mt-3 ui-card-muted p-3">
              <p className="text-xs font-medium text-slate-500">员工转人工时关联的回答</p>
              <p className="mt-2 line-clamp-4 text-sm leading-6 text-slate-600">{ticket.message.content}</p>
            </div>
          )}
          <div className="mt-4 grid gap-3 md:grid-cols-[140px_120px_180px_1fr_120px]">
            <select
              value={ticket.status}
              onChange={(event) => onUpdate({ status: event.target.value as WorkStatus })}
              disabled={saving}
              className="h-10 rounded-lg border border-line px-3 text-sm outline-none focus:border-brand disabled:bg-slate-50"
            >
              {Object.entries(ticketStatusLabel).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <select
              value={ticket.priority}
              onChange={(event) => onUpdate({ priority: event.target.value as ServiceTicketPriority })}
              disabled={saving}
              className="h-10 rounded-lg border border-line px-3 text-sm outline-none focus:border-brand disabled:bg-slate-50"
            >
              {Object.entries(priorityLabel).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <select
              value={assigneeValue}
              onChange={(event) => onUpdate({ assignee_id: event.target.value || null })}
              disabled={saving}
              className="h-10 rounded-lg border border-line px-3 text-sm outline-none focus:border-brand disabled:bg-slate-50"
            >
              <option value="">未指派</option>
              {adminUsers.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name || user.email}
                </option>
              ))}
              {ticket.assignee_id && !adminUsers.some((user) => user.id === ticket.assignee_id) && (
                <option value={ticket.assignee_id}>{ticket.assignee?.name ?? ticket.assignee_id}</option>
              )}
            </select>
            <input
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="处理备注，例如：已联系员工并转 HR 复核"
              className="h-10 rounded-lg border border-line px-3 text-sm outline-none focus:border-brand"
            />
            <button
              type="button"
              onClick={() => onUpdate({ resolution_note: note })}
              disabled={saving}
              className="inline-flex h-10 items-center justify-center rounded-lg border border-line px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:text-slate-300"
            >
              {saving ? <Loader2 className="animate-spin" size={15} /> : "保存工单"}
            </button>
          </div>

          <div className="mt-4 rounded-lg border border-line bg-white p-3">
            <div className="flex items-center justify-between gap-3">
              <p className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600">
                <MessageSquare size={14} />
                处理记录
              </p>
              <span className="text-xs text-slate-400">{ticket.comments.length} 条</span>
            </div>
            <div className="mt-3 space-y-2">
              {ticket.comments.map((item) => (
                <div key={item.id} className="rounded-lg bg-slate-50 px-3 py-2">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    <span className="inline-flex items-center gap-1 font-medium text-slate-700">
                      {item.author_role === "admin" ? <UserRound size={12} /> : <MessageSquare size={12} />}
                      {item.author_role === "admin" ? "管理员" : "员工"}
                    </span>
                    {item.is_internal && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-slate-200 px-2 py-0.5 text-slate-600">
                        <Lock size={11} />
                        内部
                      </span>
                    )}
                    <span>{new Date(item.created_at).toLocaleString("zh-CN")}</span>
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-700">{item.body}</p>
                </div>
              ))}
              {ticket.comments.length === 0 && (
                <p className="rounded-lg border border-dashed border-line px-3 py-3 text-sm text-slate-500">暂无处理记录。</p>
              )}
            </div>
            <div className="mt-3 grid gap-2 md:grid-cols-[1fr_auto_auto]">
              <input
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                placeholder="添加处理记录，例如：已电话联系员工确认问题背景"
                className="h-10 rounded-lg border border-line px-3 text-sm outline-none focus:border-brand"
              />
              <label className="inline-flex h-10 items-center gap-2 rounded-lg border border-line px-3 text-sm text-slate-600">
                <input
                  type="checkbox"
                  checked={internalComment}
                  onChange={(event) => setInternalComment(event.target.checked)}
                />
                内部
              </label>
              <button
                type="button"
                onClick={() => {
                  const body = comment.trim();
                  if (!body) {
                    return;
                  }
                  onComment({ body, is_internal: internalComment });
                  setComment("");
                  setInternalComment(false);
                }}
                disabled={commentSaving || !comment.trim()}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-brand px-3 text-sm font-semibold text-white hover:bg-brand-strong disabled:bg-slate-200"
              >
                {commentSaving ? <Loader2 className="animate-spin" size={15} /> : <Send size={15} />}
                添加记录
              </button>
            </div>
          </div>
        </div>
        <a
          href="/admin/insights"
          className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-lg border border-line px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          会话审计
          <ExternalLink size={15} />
        </a>
      </div>
    </article>
  );
}

function SecurityCoverageLegend() {
  return (
    <div className="ui-card p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h2 className="text-sm font-semibold text-ink">安全审计覆盖范围</h2>
          <p className="mt-1 text-sm text-slate-500">系统会记录风险事件、保留脱敏片段，并支持管理员复核处理。</p>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {securityCoverageItems.map((item) => (
            <div key={item.category} className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
              <p className="text-xs font-semibold text-slate-700">{securityCategoryLabel(item.category)}</p>
              <p className="mt-1 text-xs leading-5 text-slate-500">{item.description}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

type SecurityOverview = {
  total: number;
  open: number;
  highOrCriticalOpen: number;
  critical: number;
  promptInjectionOpen: number;
  sensitiveOpen: number;
  abnormalOpen: number;
  byCategory: Record<SecurityEventInsight["category"], number>;
  bySeverity: Record<SecurityEventInsight["severity"], number>;
  byStatus: Record<WorkStatus, number>;
  latestAt: string | null;
};

function buildSecurityOverview(events: SecurityEventInsight[]): SecurityOverview {
  const emptyCategoryCount: Record<SecurityEventInsight["category"], number> = {
    sensitive_input: 0,
    sensitive_output: 0,
    prompt_injection: 0,
    abnormal_access: 0
  };
  const emptySeverityCount: Record<SecurityEventInsight["severity"], number> = {
    low: 0,
    medium: 0,
    high: 0,
    critical: 0
  };
  const emptyStatusCount: Record<WorkStatus, number> = {
    pending: 0,
    processing: 0,
    resolved: 0,
    ignored: 0
  };
  const openEvents = events.filter((event) => isOpenWorkStatus(event.status));
  const latest = events.reduce<SecurityEventInsight | null>((current, event) => {
    if (!current) {
      return event;
    }

    return new Date(event.created_at).getTime() > new Date(current.created_at).getTime() ? event : current;
  }, null);

  return events.reduce<SecurityOverview>((overview, event) => {
    overview.byCategory[event.category] += 1;
    overview.bySeverity[event.severity] += 1;
    overview.byStatus[event.status] += 1;
    return overview;
  }, {
    total: events.length,
    open: openEvents.length,
    highOrCriticalOpen: openEvents.filter((event) => event.severity === "high" || event.severity === "critical").length,
    critical: events.filter((event) => event.severity === "critical").length,
    promptInjectionOpen: openEvents.filter((event) => event.category === "prompt_injection").length,
    sensitiveOpen: openEvents.filter((event) => event.category === "sensitive_input" || event.category === "sensitive_output").length,
    abnormalOpen: openEvents.filter((event) => event.category === "abnormal_access").length,
    byCategory: emptyCategoryCount,
    bySeverity: emptySeverityCount,
    byStatus: emptyStatusCount,
    latestAt: latest?.created_at ?? null
  });
}

function filterSecurityEvents(
  events: SecurityEventInsight[],
  filters: {
    category: SecurityCategoryFilter;
    severity: SecuritySeverityFilter;
    status: SecurityStatusFilter;
  }
) {
  return events.filter((event) => {
    if (filters.category !== "all" && event.category !== filters.category) {
      return false;
    }

    if (filters.severity !== "all" && event.severity !== filters.severity) {
      return false;
    }

    if (filters.status !== "all" && event.status !== filters.status) {
      return false;
    }

    return true;
  });
}

function isOpenWorkStatus(status: WorkStatus) {
  return status === "pending" || status === "processing";
}

function SecurityAuditSummary({
  overview,
  filteredCount
}: {
  overview: SecurityOverview;
  filteredCount: number;
}) {
  return (
    <section className="grid gap-3 md:grid-cols-4">
      <Metric label="安全事件" value={overview.total} tone={overview.total > 0 ? "warn" : "good"} />
      <Metric label="待处理" value={overview.open} tone={overview.open > 0 ? "warn" : "good"} />
      <Metric label="高危待处理" value={overview.highOrCriticalOpen} tone={overview.highOrCriticalOpen > 0 ? "bad" : "good"} />
      <Metric label="筛选命中" value={filteredCount} />
      <div className="ui-card p-4 md:col-span-4">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div>
            <p className="text-xs font-medium text-slate-500">待处理风险构成</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <SecurityCountPill label="提示词注入" value={overview.promptInjectionOpen} tone={overview.promptInjectionOpen > 0 ? "bad" : "neutral"} />
              <SecurityCountPill label="敏感信息" value={overview.sensitiveOpen} tone={overview.sensitiveOpen > 0 ? "warn" : "neutral"} />
              <SecurityCountPill label="异常访问" value={overview.abnormalOpen} tone={overview.abnormalOpen > 0 ? "bad" : "neutral"} />
              <SecurityCountPill label="严重风险" value={overview.critical} tone={overview.critical > 0 ? "bad" : "neutral"} />
            </div>
          </div>
          <div>
            <p className="text-xs font-medium text-slate-500">最近事件</p>
            <p className="mt-3 text-sm font-semibold text-ink">
              {overview.latestAt ? new Date(overview.latestAt).toLocaleString("zh-CN") : "暂无记录"}
            </p>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              高危与严重事件会在页面顶部形成告警，建议先处理“提示词注入、异常访问、敏感输出”。
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

function SecurityCountPill({
  label,
  value,
  tone
}: {
  label: string;
  value: number;
  tone: "bad" | "warn" | "neutral";
}) {
  const toneClass = tone === "bad"
    ? "bg-red-50 text-red-700 ring-red-200"
    : tone === "warn"
      ? "bg-amber-50 text-amber-700 ring-amber-200"
      : "bg-slate-50 text-slate-600 ring-slate-200";

  return (
    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${toneClass}`}>
      {label} {value}
    </span>
  );
}

function SecurityAuditFilters({
  category,
  severity,
  status,
  onCategoryChange,
  onSeverityChange,
  onStatusChange,
  onReset
}: {
  category: SecurityCategoryFilter;
  severity: SecuritySeverityFilter;
  status: SecurityStatusFilter;
  onCategoryChange: (value: SecurityCategoryFilter) => void;
  onSeverityChange: (value: SecuritySeverityFilter) => void;
  onStatusChange: (value: SecurityStatusFilter) => void;
  onReset: () => void;
}) {
  return (
    <section className="ui-card p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="text-sm font-semibold text-ink">安全事件筛选</h2>
          <p className="mt-1 text-sm text-slate-500">按事件类型、风险等级和处理状态缩小范围，优先处置高危待处理项。</p>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[150px_150px_150px_88px]">
          <label className="grid gap-1 text-xs font-medium text-slate-500">
            类型
            <select
              value={category}
              onChange={(event) => onCategoryChange(event.target.value as SecurityCategoryFilter)}
              className="h-11 rounded-lg border border-line bg-white px-3 text-sm text-ink outline-none focus:border-brand"
            >
              <option value="all">全部类型</option>
              {securityCoverageItems.map((item) => (
                <option key={item.category} value={item.category}>{securityCategoryLabel(item.category)}</option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-xs font-medium text-slate-500">
            等级
            <select
              value={severity}
              onChange={(event) => onSeverityChange(event.target.value as SecuritySeverityFilter)}
              className="h-11 rounded-lg border border-line bg-white px-3 text-sm text-ink outline-none focus:border-brand"
            >
              <option value="all">全部等级</option>
              <option value="critical">严重风险</option>
              <option value="high">高风险</option>
              <option value="medium">中风险</option>
              <option value="low">低风险</option>
            </select>
          </label>
          <label className="grid gap-1 text-xs font-medium text-slate-500">
            状态
            <select
              value={status}
              onChange={(event) => onStatusChange(event.target.value as SecurityStatusFilter)}
              className="h-11 rounded-lg border border-line bg-white px-3 text-sm text-ink outline-none focus:border-brand"
            >
              <option value="all">全部状态</option>
              {Object.entries(statusLabel).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={onReset}
            className="ui-button-secondary h-11 self-end px-3"
          >
            重置
          </button>
        </div>
      </div>
    </section>
  );
}

function SecurityAlertPanel({
  alerts,
  criticalCount,
  highCount,
  onOpenSecurity
}: {
  alerts: SecurityEventInsight[];
  criticalCount: number;
  highCount: number;
  onOpenSecurity: () => void;
}) {
  const latest = alerts[0];

  return (
    <section className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5" role="alert">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-red-100 text-red-700">
          <AlertTriangle size={17} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h2 className="text-sm font-semibold text-red-950">安全告警 · {alerts.length} 条待处理</h2>
            {criticalCount > 0 && <span className="text-xs font-semibold text-red-800">严重 {criticalCount}</span>}
            {highCount > 0 && <span className="text-xs font-semibold text-red-700">高风险 {highCount}</span>}
          </div>
          {latest && (
            <p className="mt-0.5 truncate text-xs text-red-800" title={`${securityCategoryLabel(latest.category)} · ${latest.title} · ${latest.user?.email ?? "未知用户"}`}>
              最近：{securityCategoryLabel(latest.category)} · {latest.title} · {latest.user?.email ?? "未知用户"} · {new Date(latest.created_at).toLocaleString("zh-CN")}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={onOpenSecurity}
          className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-lg bg-red-700 px-3 text-sm font-semibold text-white hover:bg-red-800"
        >
          处理安全告警
          <ExternalLink size={15} />
        </button>
      </div>
    </section>
  );
}

function OperationAlertPanel({
  alerts,
  onOpenQa,
  onOpenQaTests
}: {
  alerts: OperationAlert[];
  onOpenQa: () => void;
  onOpenQaTests: () => void;
}) {
  const latest = alerts[0];
  const criticalCount = alerts.filter((alert) => alert.severity === "critical").length;
  const warningCount = alerts.filter((alert) => alert.severity === "warning").length;

  if (!latest) {
    return null;
  }

  return (
    <section className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-amber-100 text-amber-800">
          <AlertTriangle size={17} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h2 className="text-sm font-semibold text-amber-950">运营告警 · {latest.title}</h2>
            {criticalCount > 0 && <span className="text-xs font-semibold text-red-700">严重 {criticalCount}</span>}
            {warningCount > 0 && <span className="text-xs font-semibold text-amber-800">待跟进 {warningCount}</span>}
          </div>
          <p className="mt-0.5 truncate text-xs text-amber-800" title={latest.detail}>
            {latest.detail}
            {latest.metrics.map((metric) => ` · ${metric.label} ${metric.value}`).join("")}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={latest.category === "qa_strategy_anomaly_error" ? onOpenQaTests : onOpenQa}
            className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-amber-700 px-3 text-sm font-semibold text-white hover:bg-amber-800"
          >
            {latest.category === "qa_strategy_anomaly_error" ? <ExternalLink size={15} /> : <ListTodo size={15} />}
            {latest.action_label}
          </button>
          {latest.category !== "qa_strategy_anomaly_error" && (
            <button
              type="button"
              onClick={onOpenQaTests}
              className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-amber-300 bg-white px-3 text-sm font-semibold text-amber-800 hover:bg-amber-100"
            >
              巡检计划
              <ExternalLink size={15} />
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

function SecurityEventCard({
  event,
  saving,
  onUpdate,
  onOpenConversation
}: {
  event: SecurityEventInsight;
  saving: boolean;
  onUpdate: (input: { status: WorkStatus }) => void;
  onOpenConversation: (conversationId: string) => void;
}) {
  return (
    <article className="rounded-lg border border-red-100 bg-white p-4">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${severityClass(event.severity)}`}>
              <ShieldAlert size={13} />
              {severityLabel(event.severity)}
            </span>
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
              {securityCategoryLabel(event.category)}
            </span>
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
              {statusLabel[event.status]}
            </span>
            <span className="text-xs text-slate-500">{new Date(event.created_at).toLocaleString("zh-CN")}</span>
          </div>
          <h3 className="mt-3 text-sm font-semibold leading-6 text-ink">{event.title}</h3>
          <p className="mt-2 text-sm leading-6 text-slate-600">{event.detail}</p>
          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            <div className="rounded-lg bg-slate-50 p-3">
              <p className="text-xs font-medium text-slate-500">用户</p>
              <p className="mt-1 text-sm text-slate-700">
                {event.user?.name ?? "未知用户"} · {event.user?.department || "未设置部门"}
              </p>
              <p className="mt-1 text-xs text-slate-500">{event.user?.email ?? event.user_id ?? "无用户信息"}</p>
            </div>
            <div className="rounded-lg bg-slate-50 p-3">
              <p className="text-xs font-medium text-slate-500">命中规则</p>
              <p className="mt-1 text-sm text-slate-700">{securityRuleLabel(event)}</p>
              <p className="mt-1 text-xs text-slate-500">会话：{event.conversation?.title ?? event.conversation_id ?? "无"}</p>
            </div>
          </div>
          {(event.raw_excerpt || event.masked_excerpt) && (
            <div className="mt-3 grid gap-3 lg:grid-cols-2">
              <ExcerptBlock label="原始片段" value={event.raw_excerpt ?? ""} tone="bad" />
              <ExcerptBlock label="脱敏片段" value={event.masked_excerpt ?? ""} tone="good" />
            </div>
          )}
        </div>
        <div className="flex shrink-0 flex-col gap-2">
          <select
            value={event.status}
            onChange={(changeEvent) => onUpdate({ status: changeEvent.target.value as WorkStatus })}
            disabled={saving}
            className="h-9 rounded-lg border border-line px-3 text-sm outline-none focus:border-brand disabled:bg-slate-50"
          >
            {Object.entries(statusLabel).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          {event.conversation_id && (
            <button
              type="button"
              onClick={() => onOpenConversation(event.conversation_id as string)}
              className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-line px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              会话审计
              <ExternalLink size={15} />
            </button>
          )}
        </div>
      </div>
    </article>
  );
}

function securityCategoryLabel(category: SecurityEventInsight["category"]) {
  const labels: Record<SecurityEventInsight["category"], string> = {
    sensitive_input: "敏感输入",
    sensitive_output: "敏感输出",
    prompt_injection: "提示词注入",
    abnormal_access: "异常访问"
  };

  return labels[category];
}

function securityRuleLabel(event: SecurityEventInsight) {
  if (event.metadata.detector === "security_event_burst") {
    return `连续触发检测 · ${String(event.metadata.event_count ?? "-")} 次`;
  }

  return String(event.metadata.rule ?? event.metadata.detector ?? "未记录");
}

function severityLabel(severity: SecurityEventInsight["severity"]) {
  const labels: Record<SecurityEventInsight["severity"], string> = {
    low: "低风险",
    medium: "中风险",
    high: "高风险",
    critical: "严重风险"
  };

  return labels[severity];
}

function severityClass(severity: SecurityEventInsight["severity"]) {
  const classes: Record<SecurityEventInsight["severity"], string> = {
    low: "bg-cyan/10 text-brand",
    medium: "bg-amber-50 text-amber-700",
    high: "bg-red-50 text-red-700",
    critical: "bg-red-100 text-red-800"
  };

  return classes[severity];
}

function ExcerptBlock({ label, value, tone }: { label: string; value: string; tone: "good" | "bad" }) {
  return (
    <div className={`rounded-lg border p-3 ${
      tone === "good" ? "border-emerald-100 bg-emerald-50" : "border-red-100 bg-red-50"
    }`}>
      <p className={`text-xs font-medium ${tone === "good" ? "text-emerald-700" : "text-red-700"}`}>{label}</p>
      <p className="mt-2 whitespace-pre-wrap break-words text-xs leading-5 text-slate-700">{value || "无"}</p>
    </div>
  );
}

function QaRemediationCard({
  task,
  knowledgeBases,
  saving,
  onUpdate,
  onRetest,
  onSupplement
}: {
  task: QaRemediationTask;
  knowledgeBases: KnowledgeBase[];
  saving: boolean;
  onUpdate: (input: { status?: WorkStatus; note?: string | null }) => void;
  onRetest: () => void;
  onSupplement: (input: SupplementInput) => void;
}) {
  const [note, setNote] = useState(task.note ?? "");

  useEffect(() => {
    setNote(task.note ?? "");
  }, [task.note]);

  return (
    <article className="rounded-lg border border-amber-200 bg-white p-4">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700">
              <ClipboardCheck size={13} />
              QA 整改
            </span>
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
              {statusLabel[task.status]}
            </span>
            <span className="text-xs text-slate-500">测试 ID：{task.qa_test_id}</span>
          </div>
          <h3 className="mt-3 text-sm font-semibold leading-6 text-ink">{task.question}</h3>
          <p className="mt-2 line-clamp-3 text-sm leading-6 text-slate-600">当前回答：{task.answer}</p>
          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            <InfoBlock label="整改原因" value={task.reason} />
            <InfoBlock label="建议动作" value={task.suggestion} />
          </div>
          {task.missing_keywords.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {task.missing_keywords.map((keyword) => (
                <span key={keyword} className="rounded-full bg-red-50 px-2.5 py-1 text-xs font-medium text-red-700">
                  缺：{keyword}
                </span>
              ))}
            </div>
          )}
          {task.expected_answer && (
            <div className="mt-3 rounded-lg bg-slate-50 p-3 text-sm leading-6 text-slate-600">
              <span className="font-medium text-slate-700">期望答案：</span>
              {task.expected_answer}
            </div>
          )}
          <RetestSummaryBlock note={task.note} />
          <div className="mt-4 grid gap-3 md:grid-cols-[180px_1fr_160px]">
            <select
              value={task.status}
              onChange={(event) => onUpdate({ status: event.target.value as WorkStatus })}
              disabled={saving}
              className="h-10 rounded-lg border border-line px-3 text-sm outline-none focus:border-brand disabled:bg-slate-50"
            >
              {Object.entries(statusLabel).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <input
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="处理备注，例如：已补充安全培训 FAQ 并重新运行测试"
              className="h-10 rounded-lg border border-line px-3 text-sm outline-none focus:border-brand"
            />
            <button
              type="button"
              onClick={() => onUpdate({ note })}
              disabled={saving}
              className="inline-flex h-10 items-center justify-center rounded-lg border border-line px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:text-slate-300"
            >
              {saving ? <Loader2 className="animate-spin" size={15} /> : "保存任务"}
            </button>
          </div>
          <KnowledgeSupplementPanel
            taskId={task.id}
            question={task.question}
            suggestedContent={task.expected_answer ? `标准答案：${task.expected_answer}` : ""}
            knowledgeBases={knowledgeBases}
            saving={saving}
            onSubmit={onSupplement}
          />
        </div>
        <div className="flex shrink-0 flex-col gap-2">
          <a
            href="/admin/documents"
            className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-line px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            上传资料
            <ExternalLink size={15} />
          </a>
          <a
            href="/admin/qa-tests"
            className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-line px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            查看测试
            <ExternalLink size={15} />
          </a>
          <button
            type="button"
            onClick={onRetest}
            disabled={saving}
            className="ui-button-success h-9 px-3"
          >
            {saving ? <Loader2 className="animate-spin" size={15} /> : <RefreshCw size={15} />}
            自动复测
          </button>
        </div>
      </div>
    </article>
  );
}

function InfoBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-amber-50 p-3">
      <p className="text-xs font-medium text-amber-700">{label}</p>
      <p className="mt-1 text-sm leading-6 text-amber-950">{value}</p>
    </div>
  );
}

function RetestSummaryBlock({ note }: { note: string | null }) {
  const summary = parseLatestRetestSummary(note);

  if (!summary) {
    return null;
  }

  const resolved = summary.conclusion.includes("通过") && !summary.conclusion.includes("未通过");

  return (
    <div className={`mt-3 rounded-lg border p-3 ${
      resolved ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"
    }`}>
      <div className={`flex flex-wrap items-center gap-2 text-xs font-semibold ${
        resolved ? "text-emerald-700" : "text-amber-800"
      }`}>
        <RefreshCw size={14} />
        最近复测
        <span className="rounded-full bg-white px-2 py-0.5 ring-1 ring-current/10">
          {summary.time}
        </span>
      </div>
      <div className="mt-2 grid gap-2 text-xs leading-5 text-slate-700 md:grid-cols-3">
        <span>结论：{summary.conclusion}</span>
        {summary.citationCount && <span>引用：{summary.citationCount}</span>}
        {summary.coverage && <span>期望覆盖：{summary.coverage}</span>}
      </div>
      {summary.missingKeywords && (
        <p className="mt-2 text-xs leading-5 text-slate-600">仍缺关键词：{summary.missingKeywords}</p>
      )}
    </div>
  );
}

function parseLatestRetestSummary(note: string | null) {
  if (!note) {
    return null;
  }

  const index = note.lastIndexOf("复测时间：");
  if (index === -1) {
    return null;
  }

  const lines = note
    .slice(index)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const fields = new Map<string, string>();

  for (const line of lines) {
    const separatorIndex = line.indexOf("：");

    if (separatorIndex === -1) {
      continue;
    }

    fields.set(line.slice(0, separatorIndex), line.slice(separatorIndex + 1));
  }

  const conclusion = fields.get("复测结论");
  if (!conclusion) {
    return null;
  }

  return {
    time: fields.get("复测时间") ?? "未知时间",
    conclusion,
    citationCount: fields.get("引用数量"),
    coverage: fields.get("期望覆盖"),
    missingKeywords: normalizeMissingKeywords(fields.get("仍缺关键词") ?? fields.get("缺失关键词") ?? "")
  };
}

function normalizeMissingKeywords(value: string) {
  if (!value || value === "无") {
    return "";
  }

  return value;
}

type MetricTone = "good" | "bad" | "warn";

function PrimaryMetric({
  icon: Icon,
  label,
  value,
  helper,
  tone,
  testId
}: {
  icon: typeof ListTodo;
  label: string;
  value: React.ReactNode;
  helper: string;
  tone?: MetricTone;
  testId: string;
}) {
  const toneClass =
    tone === "good" ? "text-emerald-700" : tone === "bad" ? "text-red-700" : tone === "warn" ? "text-amber-700" : "text-ink";
  const iconClass =
    tone === "good" ? "bg-emerald-50 text-emerald-700" : tone === "bad" ? "bg-red-50 text-red-700" : tone === "warn" ? "bg-amber-50 text-amber-700" : "bg-slate-100 text-slate-700";

  return (
    <article className="ui-card flex min-w-0 items-center gap-3 px-3 py-3" data-testid={testId}>
      <span className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${iconClass}`}>
          <Icon className="size-4" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-slate-600">{label}</p>
        <p className="mt-0.5 truncate text-xs text-slate-500" title={helper}>{helper}</p>
      </div>
      <p className={`shrink-0 text-2xl font-semibold tabular-nums ${toneClass}`}>{value}</p>
    </article>
  );
}

function MetricGroup({ title, testId, children }: { title: string; testId: string; children: React.ReactNode }) {
  return (
    <section className="min-w-0 border-b border-line p-4 last:border-b-0 md:odd:border-r xl:border-b-0 xl:not-last:border-r" data-testid={testId}>
      <h3 className="mb-2 text-xs font-semibold text-slate-500">{title}</h3>
      <dl className="divide-y divide-line/70">{children}</dl>
    </section>
  );
}

function Metric({ label, value, tone }: { label: string; value: React.ReactNode; tone?: MetricTone }) {
  const toneClass =
    tone === "good" ? "text-emerald-700" : tone === "bad" ? "text-red-700" : tone === "warn" ? "text-amber-700" : "text-ink";

  return (
    <div className="flex min-w-0 items-center justify-between gap-3 py-2.5">
      <dt className="min-w-0 break-words text-sm text-slate-600">{label}</dt>
      <dd className={`shrink-0 text-sm font-semibold tabular-nums ${toneClass}`}>{value}</dd>
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-9 rounded-md px-2 text-sm font-semibold transition ${
        active ? "bg-brand text-white" : "text-slate-600 hover:bg-slate-100"
      }`}
    >
      {children}
    </button>
  );
}

function ListPager({
  total,
  visible,
  onChange
}: {
  total: number;
  visible: number;
  onChange: (value: number) => void;
}) {
  if (total <= INITIAL_VISIBLE_ITEMS) {
    return null;
  }

  const hasMore = visible < total;
  const nextCount = Math.min(total, visible + INITIAL_VISIBLE_ITEMS);

  return (
    <div className="flex items-center justify-center gap-2 border-t border-line pt-3">
      {hasMore && (
        <button
          type="button"
          onClick={() => onChange(nextCount)}
          className="ui-button-secondary h-9 px-3 text-xs"
        >
          再显示 {nextCount - visible} 条
          <ChevronDown size={14} />
        </button>
      )}
      {visible > INITIAL_VISIBLE_ITEMS && (
        <button
          type="button"
          onClick={() => onChange(INITIAL_VISIBLE_ITEMS)}
          className="ui-button-secondary h-9 px-3 text-xs"
        >
          收起列表
        </button>
      )}
      <span className="text-xs text-slate-500">共 {total} 条</span>
    </div>
  );
}

function ConversationDetail({ conversation }: { conversation: ConversationInsight | null }) {
  if (!conversation) {
    return <EmptyState text="选择一个会话查看详情。" />;
  }

  return (
    <article className="ui-card min-w-0">
      <div className="border-b border-line px-5 py-4">
        <h2 className="break-words text-base font-semibold text-ink">{conversation.title}</h2>
        <p className="mt-1 text-sm text-slate-500">
          {conversation.user?.email ?? "未知用户"} · {conversation.user?.department || "未设置部门"}
        </p>
      </div>
      <div className="space-y-4 p-5">
        {conversation.messages.map((message) => (
          <div key={message.id} className="rounded-lg border border-line p-4">
            <div className="mb-2 flex items-center justify-between gap-3">
              <span className="text-xs font-semibold text-slate-500">
                {message.role === "user" ? "员工提问" : "AI 回答"}
              </span>
              <span className="text-xs text-slate-400">{new Date(message.created_at).toLocaleString("zh-CN")}</span>
            </div>
            <p className="whitespace-pre-wrap break-words text-sm leading-6 text-ink">{message.content}</p>
            {message.role === "assistant" && (
              <div className="mt-3 border-t border-slate-100 pt-3">
                {message.citations.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {message.citations.map((citation) => (
                      <CitationPill key={`${message.id}-${citation.index}`} citation={citation} />
                    ))}
                  </div>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-xs text-amber-700">
                    <AlertTriangle size={13} />
                    无引用来源
                  </span>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </article>
  );
}

function FeedbackCard({
  item,
  saving,
  onUpdate,
  onCreateTask,
  onRetestTask
}: {
  item: FeedbackInsight;
  saving: boolean;
  onUpdate: (input: {
    status?: WorkStatus;
    resolution_note?: string | null;
    needs_knowledge_update?: boolean;
  }) => void;
  onCreateTask: () => void;
  onRetestTask?: () => void;
}) {
  const [note, setNote] = useState(item.resolution_note ?? "");
  const feedbackDetail = parseFeedbackComment(item.comment);

  return (
    <article className="ui-card p-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="flex items-center gap-2">
            {item.rating === "like" ? (
              <ThumbsUp size={17} className="text-emerald-600" />
            ) : (
              <ThumbsDown size={17} className="text-red-600" />
            )}
            <h3 className="text-sm font-semibold text-ink">{item.rating === "like" ? "有帮助" : "需改进"}</h3>
          </div>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            {item.message?.content ?? "对应消息已删除"}
          </p>
          {item.question && (
            <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-sm leading-6 text-slate-600">
              员工问题：{item.question}
            </p>
          )}
          {item.comment && (
            <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-amber-800 ring-1 ring-amber-200">
                  {feedbackDetail.reason}
                </span>
                <span className="text-xs text-amber-700">员工反馈原因</span>
              </div>
              {feedbackDetail.detail && (
                <p className="mt-2 text-sm leading-6 text-amber-950">{feedbackDetail.detail}</p>
              )}
            </div>
          )}
          {item.task_id && (
            <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-cyan/10 px-3 py-1 text-xs font-medium text-brand ring-1 ring-cyan/20">
              <ListTodo size={13} />
              已创建整改任务：{item.task_status ? statusLabel[item.task_status] : "待处理"}
            </div>
          )}
          <div className="mt-4 grid gap-3 md:grid-cols-[180px_1fr_160px]">
            <select
              value={item.status}
              onChange={(event) => onUpdate({ status: event.target.value as WorkStatus })}
              disabled={saving}
              className="h-10 rounded-lg border border-line px-3 text-sm outline-none focus:border-brand disabled:bg-slate-50"
            >
              {Object.entries(statusLabel).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <input
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="处理备注，例如：已补充报销 FAQ"
              className="h-10 rounded-lg border border-line px-3 text-sm outline-none focus:border-brand"
            />
            <button
              type="button"
              onClick={() => onUpdate({ resolution_note: note })}
              disabled={saving}
              className="inline-flex h-10 items-center justify-center rounded-lg border border-line px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:text-slate-300"
            >
              {saving ? <Loader2 className="animate-spin" size={15} /> : "保存备注"}
            </button>
          </div>
          <label className="mt-3 inline-flex items-center gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={item.needs_knowledge_update}
              onChange={(event) => onUpdate({ needs_knowledge_update: event.target.checked })}
              disabled={saving}
              className="size-4 rounded border-slate-300"
            />
            需要补充知识库资料
          </label>
        </div>
        <div className="flex shrink-0 flex-col gap-3 md:w-44">
          <div className="text-xs leading-6 text-slate-500">
            <p className="font-medium text-ink">{statusLabel[item.status]}</p>
            <p>{item.user?.email ?? "未知用户"}</p>
            <p>{new Date(item.created_at).toLocaleString("zh-CN")}</p>
          </div>
          {item.rating === "dislike" && !item.task_id && (
            <button
              type="button"
              onClick={onCreateTask}
              disabled={saving || !item.message || !item.conversation}
              className="ui-button-primary h-9 px-3"
            >
              {saving ? <Loader2 className="animate-spin" size={15} /> : <ListTodo size={15} />}
              创建整改任务
            </button>
          )}
          {item.rating === "dislike" && item.task_id && onRetestTask && (
            <button
              type="button"
              onClick={onRetestTask}
              disabled={saving}
              className="ui-button-success h-9 px-3"
            >
              {saving ? <Loader2 className="animate-spin" size={15} /> : <RefreshCw size={15} />}
              自动复测
            </button>
          )}
        </div>
      </div>
    </article>
  );
}

function parseFeedbackComment(comment: string | null) {
  if (!comment) {
    return {
      reason: "未填写原因",
      detail: ""
    };
  }

  const separatorIndex = comment.indexOf("：");

  if (separatorIndex === -1) {
    return {
      reason: comment,
      detail: ""
    };
  }

  return {
    reason: comment.slice(0, separatorIndex).trim() || "未填写原因",
    detail: comment.slice(separatorIndex + 1).trim()
  };
}

function GapCard({
  gap,
  knowledgeBases,
  saving,
  onCreateTask,
  onUpdateTask,
  onRetestTask,
  onSupplementTask
}: {
  gap: KnowledgeGap;
  knowledgeBases: KnowledgeBase[];
  saving: boolean;
  onCreateTask: () => void;
  onUpdateTask: (input: { status?: WorkStatus; note?: string | null }) => void;
  onRetestTask?: () => void;
  onSupplementTask?: (input: SupplementInput) => void;
}) {
  const [note, setNote] = useState(gap.note ?? "");

  return (
    <article className="rounded-lg border border-amber-200 bg-white p-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700">
              {gap.source === "dislike" ? "点踩反馈" : "无引用回答"}
            </span>
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
              {gap.task_id ? statusLabel[gap.status] : "未建任务"}
            </span>
            <span className="text-xs text-slate-500">{gap.user_email}</span>
          </div>
          <p className="mt-3 text-sm font-semibold text-ink">问题：{gap.question}</p>
          <p className="mt-2 line-clamp-3 text-sm leading-6 text-slate-600">回答：{gap.answer}</p>
          <RetestSummaryBlock note={gap.note} />
          {gap.task_id && (
            <>
              <div className="mt-4 grid gap-3 md:grid-cols-[180px_1fr_160px]">
                <select
                  value={gap.status}
                  onChange={(event) => onUpdateTask({ status: event.target.value as WorkStatus })}
                  disabled={saving}
                  className="h-10 rounded-lg border border-line px-3 text-sm outline-none focus:border-brand disabled:bg-slate-50"
                >
                  {Object.entries(statusLabel).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
                <input
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder="任务备注，例如：已补充到 HR 制度知识库"
                  className="h-10 rounded-lg border border-line px-3 text-sm outline-none focus:border-brand"
                />
                <button
                  type="button"
                  onClick={() => onUpdateTask({ note })}
                  disabled={saving}
                  className="inline-flex h-10 items-center justify-center rounded-lg border border-line px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:text-slate-300"
                >
                  {saving ? <Loader2 className="animate-spin" size={15} /> : "保存任务"}
                </button>
              </div>
              {onSupplementTask && (
                <KnowledgeSupplementPanel
                  taskId={gap.task_id}
                  question={gap.question}
                  knowledgeBases={knowledgeBases}
                  saving={saving}
                  onSubmit={onSupplementTask}
                />
              )}
            </>
          )}
        </div>
        <div className="flex shrink-0 flex-col gap-2">
          {!gap.task_id && (
            <button
              type="button"
              onClick={onCreateTask}
              disabled={saving}
              className="ui-button-primary h-9 px-3"
            >
              {saving ? <Loader2 className="animate-spin" size={15} /> : "创建任务"}
            </button>
          )}
          {gap.task_id && onRetestTask && (
            <button
              type="button"
              onClick={onRetestTask}
              disabled={saving}
              className="ui-button-success h-9 px-3"
            >
              {saving ? <Loader2 className="animate-spin" size={15} /> : <RefreshCw size={15} />}
              自动复测
            </button>
          )}
          <a
            href={`/admin/insights?conversation=${gap.conversation_id}`}
            className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-line px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            查看会话
            <ExternalLink size={15} />
          </a>
          <a
            href="/admin/documents"
            className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-line px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            上传资料
            <ExternalLink size={15} />
          </a>
        </div>
      </div>
    </article>
  );
}

function KnowledgeSupplementPanel({
  taskId,
  question,
  suggestedContent,
  knowledgeBases,
  saving,
  onSubmit
}: {
  taskId: string;
  question: string;
  suggestedContent?: string;
  knowledgeBases: KnowledgeBase[];
  saving: boolean;
  onSubmit: (input: SupplementInput) => void;
}) {
  const [knowledgeBaseId, setKnowledgeBaseId] = useState(knowledgeBases[0]?.id ?? "");
  const [title, setTitle] = useState(question);
  const [content, setContent] = useState(suggestedContent ?? "");

  useEffect(() => {
    setKnowledgeBaseId((current) => current || knowledgeBases[0]?.id || "");
  }, [knowledgeBases]);

  useEffect(() => {
    setTitle(question);
    setContent(suggestedContent ?? "");
  }, [question, suggestedContent, taskId]);

  return (
    <div className="mt-4 rounded-lg border border-cyan/20 bg-cyan/10 p-3">
      <div className="flex items-center gap-2 text-xs font-semibold text-brand">
        <FilePlus2 size={14} />
        补充到知识库
      </div>
      <div className="mt-3 grid gap-3 lg:grid-cols-[220px_1fr]">
        <select
          value={knowledgeBaseId}
          onChange={(event) => setKnowledgeBaseId(event.target.value)}
          disabled={saving || knowledgeBases.length === 0}
          className="h-10 rounded-lg border border-cyan/20 bg-white px-3 text-sm outline-none focus:border-brand disabled:bg-slate-50"
        >
          {knowledgeBases.map((kb) => (
            <option key={kb.id} value={kb.id}>
              {kb.name}
            </option>
          ))}
        </select>
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="知识标题"
          className="h-10 rounded-lg border border-cyan/20 bg-white px-3 text-sm outline-none focus:border-brand"
        />
      </div>
      <textarea
        value={content}
        onChange={(event) => setContent(event.target.value)}
        placeholder="填写可作为员工问答依据的制度、流程或标准答案。保存后会生成知识库资料，可直接自动复测。"
        className="mt-3 min-h-28 w-full rounded-lg border border-cyan/20 bg-white px-3 py-2 text-sm leading-6 outline-none focus:border-brand"
      />
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        <button
          type="button"
          onClick={() => onSubmit({
            knowledge_base_id: knowledgeBaseId,
            title,
            content,
            retest: false
          })}
          disabled={saving || !knowledgeBaseId || content.trim().length < 10}
          className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-cyan/30 bg-white px-3 text-sm font-semibold text-brand hover:bg-cyan/10 disabled:bg-slate-100 disabled:text-slate-300"
        >
          {saving ? <Loader2 className="animate-spin" size={15} /> : <FilePlus2 size={15} />}
          保存到知识库
        </button>
        <button
          type="button"
          onClick={() => onSubmit({
            knowledge_base_id: knowledgeBaseId,
            title,
            content,
            retest: true
          })}
          disabled={saving || !knowledgeBaseId || content.trim().length < 10}
          className="ui-button-primary h-9 px-3"
        >
          {saving ? <Loader2 className="animate-spin" size={15} /> : <RefreshCw size={15} />}
          保存并复测
        </button>
      </div>
    </div>
  );
}

function CitationPill({ citation }: { citation: Citation }) {
  const label = citation.file_name ?? citation.file_id ?? citation.url ?? "知识库文件";
  const meta = citationMeta(citation);

  return (
    <span className="inline-flex max-w-full rounded-full bg-cyan/10 px-2.5 py-1 text-xs text-brand">
      <span className="truncate">
        来源 {citation.index}：{label}
        {meta ? ` · ${meta}` : ""}
      </span>
    </span>
  );
}

function citationMeta(citation: Citation) {
  const parts: string[] = [];

  if (citation.page) {
    parts.push(`第 ${citation.page} 页`);
  }

  if (citation.section) {
    parts.push(citation.section);
  }

  if (citation.sheet) {
    parts.push(`工作表：${citation.sheet}`);
  }

  if (citation.cell_range) {
    parts.push(`范围：${citation.cell_range}`);
  }

  if (citation.score !== undefined) {
    parts.push(`相关度：${citation.score}`);
  }

  if (citation.score_reason) {
    parts.push(citation.score_reason);
  }

  return parts.join(" · ");
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="ui-card px-4 py-10 text-center text-sm text-slate-500">
      {text}
    </div>
  );
}
