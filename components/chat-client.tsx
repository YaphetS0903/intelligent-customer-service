"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Archive,
  ArchiveRestore,
  Bot,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  CircleAlert,
  Clock3,
  Copy,
  Database,
  ExternalLink,
  History,
  Loader2,
  Mail,
  MessageSquare,
  MoreHorizontal,
  PencilLine,
  Pin,
  PinOff,
  Plus,
  RotateCcw,
  Save,
  Search,
  Send,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  Volume2,
  X
} from "lucide-react";
import { speakWithBrowserSpeech, stopBrowserSpeech } from "@/components/browser-speech";
import { useToast } from "@/components/ui-feedback";
import type { Citation, Conversation, KnowledgeBaseScope, Message, ServiceTicket, ServiceTicketComment } from "@/lib/types";

type ChatSearchScope = Pick<KnowledgeBaseScope, "id" | "name" | "ready_documents" | "searchable">;

type ChatStreamEvent =
  | {
      type: "meta";
      conversation: { id: string; title: string };
      user_message_id: string;
      knowledge_bases: ChatSearchScope[];
    }
  | { type: "heartbeat"; at: string }
  | { type: "delta"; text: string }
  | { type: "citations"; citations: Citation[] }
  | { type: "tool_result"; metadata: Record<string, unknown> }
  | { type: "done"; message_id: string; citations: Citation[]; model: string | null; knowledge_task_id?: string | null }
  | { type: "error"; error: string };

type FeedbackRating = "like" | "dislike";
type ConversationView = "recent" | "archived";
type FeedbackDraft = { messageId: string; rating: FeedbackRating; reason: string; comment: string };
type TicketDraft = { messageId: string; comment: string };
type WinmailBinding = { bound: boolean; email_masked: string; verified_at: string | null; encryption_ready: boolean };

const quickPromptGroups = [
  {
    title: "办公助手",
    prompts: ["我有多少封未读邮件？", "查一下最近 5 封邮件", "查找今天的未读邮件"]
  },
  {
    title: "入职与培训",
    prompts: ["新员工入职流程是什么？", "试用期员工需要完成哪些培训？", "公司培训资料里有哪些重点？"]
  },
  {
    title: "安全与生产",
    prompts: ["进入车间需要遵守哪些安全要求？", "设备异常时应该如何处理？", "首件确认流程是什么？"]
  },
  {
    title: "质量与制度",
    prompts: ["发现质量异常应该怎么反馈？", "员工对制度回答有疑问时怎么办？", "报销需要准备哪些材料？"]
  }
];

const positiveFeedbackReasons = ["解决了问题", "回答准确", "引用清楚", "表达清楚"];
const negativeFeedbackReasons = ["答案不准确", "查不到对应制度", "引用不清楚", "资料可能过期", "回答看不懂", "没有解决问题"];
const employeeTicketStatusLabel: Record<ServiceTicket["status"], string> = {
  pending: "待分派",
  processing: "处理中",
  resolved: "已解决",
  ignored: "已关闭"
};

export function ChatClient() {
  const { pushToast } = useToast();
  const [conversationId, setConversationId] = useState("");
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [archivedConversations, setArchivedConversations] = useState<Conversation[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBaseScope[]>([]);
  const [selectedKnowledgeBaseId, setSelectedKnowledgeBaseId] = useState("");
  const [contextLoading, setContextLoading] = useState(true);
  const [conversationsLoading, setConversationsLoading] = useState(true);
  const [archivedConversationsLoading, setArchivedConversationsLoading] = useState(false);
  const [archiveExpanded, setArchiveExpanded] = useState(false);
  const [conversationSearch, setConversationSearch] = useState("");
  const [editingConversationId, setEditingConversationId] = useState<string | null>(null);
  const [editingConversationTitle, setEditingConversationTitle] = useState("");
  const [conversationActionId, setConversationActionId] = useState<string | null>(null);
  const [deleteConfirmConversation, setDeleteConfirmConversation] = useState<Conversation | null>(null);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [openActionMenuId, setOpenActionMenuId] = useState<string | null>(null);
  const [failedRetryByMessage, setFailedRetryByMessage] = useState<Record<string, string>>({});
  const [feedbackByMessage, setFeedbackByMessage] = useState<Record<string, FeedbackRating>>({});
  const [feedbackDraft, setFeedbackDraft] = useState<FeedbackDraft | null>(null);
  const [feedbackSavingId, setFeedbackSavingId] = useState<string | null>(null);
  const [ticketSavingId, setTicketSavingId] = useState<string | null>(null);
  const [ticketDraft, setTicketDraft] = useState<TicketDraft | null>(null);
  const [ticketByMessage, setTicketByMessage] = useState<Record<string, string>>({});
  const [tickets, setTickets] = useState<ServiceTicket[]>([]);
  const [ticketCommentsByTicket, setTicketCommentsByTicket] = useState<Record<string, ServiceTicketComment[]>>({});
  const [ticketsLoading, setTicketsLoading] = useState(true);
  const [ticketCommentDraft, setTicketCommentDraft] = useState<Record<string, string>>({});
  const [ticketCommentSavingId, setTicketCommentSavingId] = useState<string | null>(null);
  const [ticketsExpanded, setTicketsExpanded] = useState(false);
  const [winmailBinding, setWinmailBinding] = useState<WinmailBinding | null>(null);
  const [mailboxDialogOpen, setMailboxDialogOpen] = useState(false);
  const [mailboxEmail, setMailboxEmail] = useState("");
  const [mailboxPassword, setMailboxPassword] = useState("");
  const [mailboxWorking, setMailboxWorking] = useState(false);
  const [mailboxUnbindConfirm, setMailboxUnbindConfirm] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const browserSpeechIdRef = useRef<string | null>(null);
  const messagesScrollRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const streamingRef = useRef(false);

  useEffect(() => {
    void loadContext();
    void loadTickets();
    void loadWinmailBinding();
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void loadConversations("recent", conversationSearch);

      if (archiveExpanded) {
        void loadConversations("archived", conversationSearch);
      }
    }, 240);

    return () => window.clearTimeout(timeout);
  }, [archiveExpanded, conversationSearch]);

  useEffect(() => {
    setFeedbackDraft(null);
    setTicketDraft(null);
    setOpenActionMenuId(null);
    setFailedRetryByMessage({});

    if (conversationId) {
      void loadMessages(conversationId);
    } else {
      setMessages([]);
    }
  }, [conversationId]);

  useEffect(() => {
    const container = messagesScrollRef.current;

    if (!container) {
      return;
    }

    container.scrollTo({
      top: container.scrollHeight,
      behavior: "smooth"
    });
  }, [messages, loading, feedbackDraft, ticketDraft]);

  useEffect(() => {
    return () => {
      audioRef.current?.pause();
      stopBrowserSpeech();
      if (audioUrlRef.current) {
        URL.revokeObjectURL(audioUrlRef.current);
      }
    };
  }, []);

  const canSend = useMemo(() => input.trim().length > 0 && !loading, [input, loading]);
  const selectedKnowledgeBase = useMemo(
    () => knowledgeBases.find((item) => item.id === selectedKnowledgeBaseId) ?? null,
    [knowledgeBases, selectedKnowledgeBaseId]
  );
  const activeConversation = useMemo(
    () =>
      conversations.find((item) => item.id === conversationId) ??
      archivedConversations.find((item) => item.id === conversationId) ??
      null,
    [archivedConversations, conversationId, conversations]
  );
  const currentScopes = selectedKnowledgeBase ? [selectedKnowledgeBase] : knowledgeBases;
  const searchableCount = currentScopes.filter((item) => item.searchable).length;

  function pushSuccess(title: string, description?: string) {
    pushToast({ tone: "success", title, description });
  }

  function pushWarning(title: string, description?: string) {
    pushToast({ tone: "warning", title, description });
  }

  function pushActionError(error: unknown, title: string) {
    pushToast({
      tone: "error",
      title,
      description: formatApiError(error, "请稍后重试。")
    });
  }

  async function loadContext() {
    setContextLoading(true);

    try {
      const response = await fetch("/api/chat/context", {
        cache: "no-store"
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "资料范围加载失败");
      }

      setKnowledgeBases(data.knowledgeBases ?? []);
    } catch (error) {
      pushActionError(error, "资料范围加载失败");
    } finally {
      setContextLoading(false);
    }
  }

  async function loadConversations(view: ConversationView = "recent", searchValue = conversationSearch) {
    if (view === "archived") {
      setArchivedConversationsLoading(true);
    } else {
      setConversationsLoading(true);
    }

    try {
      const params = new URLSearchParams();
      const query = searchValue.trim();

      if (view === "archived") {
        params.set("view", "archived");
      }

      if (query) {
        params.set("q", query);
      }

      const response = await fetch(`/api/conversations${params.size > 0 ? `?${params.toString()}` : ""}`, {
        cache: "no-store"
      });
      const data = await response.json();

      if (response.ok) {
        if (view === "archived") {
          setArchivedConversations(data.conversations ?? []);
        } else {
          setConversations(data.conversations ?? []);
        }
      } else {
        throw new Error(data.error ?? "会话列表加载失败");
      }
    } catch (error) {
      pushActionError(error, "会话列表加载失败");
    } finally {
      if (view === "archived") {
        setArchivedConversationsLoading(false);
      } else {
        setConversationsLoading(false);
      }
    }
  }

  async function loadTickets() {
    setTicketsLoading(true);

    try {
      const response = await fetch("/api/tickets", {
        cache: "no-store"
      });
      const data = await response.json();

      if (response.ok) {
        const nextTickets: ServiceTicket[] = data.tickets ?? [];
        setTickets(nextTickets);
        setTicketCommentsByTicket(data.commentsByTicket ?? {});
        setTicketByMessage((current) => ({
          ...current,
          ...Object.fromEntries(
            nextTickets
              .filter((ticket) => ticket.message_id)
              .map((ticket) => [ticket.message_id as string, ticket.id])
          )
        }));
      } else {
        throw new Error(data.error ?? "工单列表加载失败");
      }
    } catch (error) {
      pushActionError(error, "工单列表加载失败");
    } finally {
      setTicketsLoading(false);
    }
  }

  async function loadWinmailBinding() {
    try {
      const response = await fetch("/api/integrations/winmail/binding", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "邮箱连接状态加载失败");
      setWinmailBinding(data.binding);
    } catch {
      setWinmailBinding(null);
    }
  }

  async function bindWinmailMailbox() {
    if (!mailboxEmail.trim() || !mailboxPassword) return;
    setMailboxWorking(true);
    try {
      const response = await fetch("/api/integrations/winmail/binding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: mailboxEmail.trim(), password: mailboxPassword })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "邮箱连接失败");
      setWinmailBinding({ ...data.binding, encryption_ready: true });
      setMailboxPassword("");
      setMailboxDialogOpen(false);
      pushSuccess("个人邮箱已连接", `已验证 ${data.binding.email_masked}`);
    } catch (error) {
      pushActionError(error, "邮箱连接失败");
    } finally {
      setMailboxWorking(false);
    }
  }

  async function unbindWinmailMailbox() {
    setMailboxWorking(true);
    try {
      const response = await fetch("/api/integrations/winmail/binding", { method: "DELETE" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "邮箱解绑失败");
      setWinmailBinding({ bound: false, email_masked: "", verified_at: null, encryption_ready: true });
      setMailboxEmail("");
      setMailboxPassword("");
      setMailboxUnbindConfirm(false);
      setMailboxDialogOpen(false);
      pushSuccess("个人邮箱已解除连接");
    } catch (error) {
      pushActionError(error, "邮箱解绑失败");
    } finally {
      setMailboxWorking(false);
    }
  }

  async function loadMessages(id: string) {
    if (streamingRef.current) {
      return;
    }

    try {
      const response = await fetch(`/api/conversations/${id}/messages`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "会话消息加载失败");
      }

      setMessages(data.messages ?? []);
    } catch (error) {
      pushActionError(error, "会话消息加载失败");
    }
  }

  async function sendMessage() {
    await sendText(input);
  }

  async function sendText(rawText: string) {
    const text = rawText.trim();

    if (!text || loading) {
      return;
    }

    const startedAt = Date.now();
    const optimisticUserId = `optimistic-${startedAt}`;
    const assistantTempId = `assistant-${startedAt}`;

    setInput("");
    setLoading(true);
    setOpenActionMenuId(null);
    setFailedRetryByMessage((current) => {
      const next = { ...current };
      delete next[assistantTempId];
      return next;
    });
    streamingRef.current = true;

    const optimisticUser: Message = {
      id: optimisticUserId,
      conversation_id: conversationId,
      role: "user",
      content: text,
      citations: [],
      model: null,
      created_at: new Date().toISOString()
    };

    const assistantDraft: Message = {
      id: assistantTempId,
      conversation_id: conversationId,
      role: "assistant",
      content: "",
      citations: [],
      model: null,
      created_at: new Date().toISOString()
    };

    setMessages((current) => [...current, optimisticUser, assistantDraft]);

    try {
      const response = await fetch("/api/chat/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversation_id: conversationId,
          message: text,
          knowledge_base_ids: selectedKnowledgeBaseId ? [selectedKnowledgeBaseId] : []
        })
      });

      if (!response.body) {
        throw new Error("浏览器不支持流式响应");
      }

      await readStream(response.body, (event) => {
        if (event.type === "meta") {
          setConversationId(event.conversation.id);
          setMessages((current) =>
            current.map((message) => {
              if (message.id === optimisticUserId) {
                return {
                  ...message,
                  id: event.user_message_id,
                  conversation_id: event.conversation.id
                };
              }

              if (message.id === assistantTempId) {
                return {
                  ...message,
                  conversation_id: event.conversation.id
                };
              }

              return message;
            })
          );
        }

        if (event.type === "delta") {
          setMessages((current) =>
            current.map((message) =>
              message.id === assistantTempId
                ? {
                    ...message,
                    content: `${message.content}${event.text}`
                  }
                : message
            )
          );
        }

        if (event.type === "citations") {
          setMessages((current) =>
            current.map((message) =>
              message.id === assistantTempId
                ? {
                    ...message,
                    citations: event.citations
                  }
                : message
            )
          );
        }

        if (event.type === "tool_result") {
          setMessages((current) =>
            current.map((message) => message.id === assistantTempId ? { ...message, metadata: event.metadata } : message)
          );
        }

        if (event.type === "done") {
          setFailedRetryByMessage((current) => {
            const next = { ...current };
            delete next[assistantTempId];
            return next;
          });
          setMessages((current) =>
            current.map((message) =>
              message.id === assistantTempId
                ? {
                    ...message,
                    id: event.message_id,
                    citations: event.citations,
                    model: event.model
                  }
                : message
            )
          );
        }

        if (event.type === "error") {
          throw new Error(event.error);
        }
      });
    } catch (error) {
      const errorText = formatChatError(error);

      pushToast({
        tone: "error",
        title: "回答生成失败",
        description: "这条问题没有成功完成，可以在回答下方点击重试。"
      });
      setFailedRetryByMessage((current) => ({
        ...current,
        [assistantTempId]: text
      }));
      setMessages((current) =>
        current
          .map((message) =>
            message.id === assistantTempId
              ? {
                  ...message,
                  content: errorText,
                  citations: []
                }
              : message
          )
      );
    } finally {
      streamingRef.current = false;
      setLoading(false);
      void loadConversations("recent");
    }
  }

  function clearConversationState() {
    setConversationId("");
    setMessages([]);
    setFeedbackByMessage({});
    setFeedbackDraft(null);
    setTicketDraft(null);
    setTicketByMessage({});
    setOpenActionMenuId(null);
    setFailedRetryByMessage({});
    setInput("");
    setEditingConversationId(null);
    setEditingConversationTitle("");
  }

  function startNewConversation() {
    setDeleteConfirmConversation(null);
    clearConversationState();
  }

  async function updateConversationArchiveStatus(conversation: Conversation, archived: boolean) {
    setConversationActionId(conversation.id);
    setEditingConversationId(null);
    setEditingConversationTitle("");

    try {
      const response = await fetch(`/api/conversations/${conversation.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived })
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "会话状态更新失败");
      }

      if (conversationId === conversation.id) {
        clearConversationState();
      }

      await loadConversations("recent");
      if (archiveExpanded || archived) {
        await loadConversations("archived");
      }
      pushSuccess(
        archived ? "会话已归档" : "会话已恢复",
        archived ? "可在归档会话中查看或从个人列表移除。" : "已恢复到最近会话。"
      );
    } catch (error) {
      pushActionError(error, "会话状态更新失败");
    } finally {
      setConversationActionId(null);
    }
  }

  async function updateConversationPinnedStatus(conversation: Conversation, pinned: boolean) {
    setConversationActionId(conversation.id);
    setEditingConversationId(null);
    setEditingConversationTitle("");

    try {
      const response = await fetch(`/api/conversations/${conversation.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pinned })
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "会话置顶更新失败");
      }

      setConversations((current) =>
        current.map((item) => (item.id === conversation.id ? data.conversation : item))
      );
      await loadConversations("recent");
      pushSuccess(pinned ? "会话已置顶" : "已取消置顶");
    } catch (error) {
      pushActionError(error, "会话置顶更新失败");
    } finally {
      setConversationActionId(null);
    }
  }

  function startRenamingConversation(conversation: Conversation) {
    setEditingConversationId(conversation.id);
    setEditingConversationTitle(conversation.title || "新的对话");
  }

  function cancelRenamingConversation() {
    setEditingConversationId(null);
    setEditingConversationTitle("");
  }

  async function renameConversationTitle(conversation: Conversation) {
    const title = editingConversationTitle.trim();

    if (!title) {
      pushWarning("会话名称不能为空");
      return;
    }

    if (title === conversation.title) {
      cancelRenamingConversation();
      return;
    }

    setConversationActionId(conversation.id);

    try {
      const response = await fetch(`/api/conversations/${conversation.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title })
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "会话重命名失败");
      }

      setConversations((current) =>
        current.map((item) => (item.id === conversation.id ? data.conversation : item))
      );
      setArchivedConversations((current) =>
        current.map((item) => (item.id === conversation.id ? data.conversation : item))
      );
      cancelRenamingConversation();
      await loadConversations("recent");

      if (archiveExpanded) {
        await loadConversations("archived");
      }

      pushSuccess("会话名称已更新");
    } catch (error) {
      pushActionError(error, "会话重命名失败");
    } finally {
      setConversationActionId(null);
    }
  }

  async function deleteArchivedConversation() {
    if (!deleteConfirmConversation) {
      return;
    }

    const target = deleteConfirmConversation;
    setConversationActionId(target.id);

    try {
      const response = await fetch(`/api/conversations/${target.id}`, {
        method: "DELETE"
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "会话删除失败");
      }

      if (conversationId === target.id) {
        clearConversationState();
      }

      setDeleteConfirmConversation(null);
      await loadConversations("archived");
      pushSuccess("归档会话已从个人列表移除，审计记录将按规则保留");
    } catch (error) {
      pushActionError(error, "会话删除失败");
    } finally {
      setConversationActionId(null);
    }
  }

  function retryFailedMessage(messageId: string, question: string) {
    if (loading) {
      return;
    }

    setFailedRetryByMessage((current) => {
      const next = { ...current };
      delete next[messageId];
      return next;
    });
    setMessages((current) => current.filter((message) => message.id !== messageId));
    void sendText(question);
  }

  function toggleFeedbackDraft(messageId: string, rating: FeedbackRating) {
    const reasons = rating === "like" ? positiveFeedbackReasons : negativeFeedbackReasons;

    setTicketDraft(null);
    setOpenActionMenuId(null);
    setFeedbackDraft((current) =>
      current?.messageId === messageId && current.rating === rating
        ? null
        : { messageId, rating, reason: reasons[0], comment: "" }
    );
  }

  function toggleTicketDraft(message: Message) {
    setFeedbackDraft(null);
    setOpenActionMenuId(null);

    if (ticketByMessage[message.id]) {
      pushSuccess("这条回答已提交人工工单", ticketByMessage[message.id]);
      setTicketsExpanded(true);
      return;
    }

    setTicketDraft((current) =>
      current?.messageId === message.id ? null : { messageId: message.id, comment: "" }
    );
  }

  async function submitFeedback(messageId: string, rating: FeedbackRating, comment?: string | null) {
    setFeedbackSavingId(messageId);

    try {
      const response = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message_id: messageId, rating, comment })
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "反馈提交失败");
      }

      setFeedbackByMessage((current) => ({
        ...current,
        [messageId]: rating
      }));
      setFeedbackDraft((current) => (current?.messageId === messageId ? null : current));
      pushSuccess(
        rating === "like" ? "有帮助反馈已提交" : "改进反馈已提交",
        rating === "like" ? "谢谢确认。" : "管理员会在后台看到。"
      );
    } catch (error) {
      pushActionError(error, "反馈提交失败");
    } finally {
      setFeedbackSavingId(null);
    }
  }

  async function submitTicket(message: Message, comment?: string) {
    if (ticketByMessage[message.id]) {
      pushSuccess("这条回答已提交人工工单", ticketByMessage[message.id]);
      setTicketDraft(null);
      setTicketsExpanded(true);
      return;
    }

    setTicketSavingId(message.id);

    try {
      const trimmedComment = comment?.trim();
      const response = await fetch("/api/tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversation_id: message.conversation_id,
          message_id: message.id,
          title: `请求人工协助：${activeConversation?.title ?? message.content.slice(0, 32)}`,
          description: [
            "员工在智能客服回答后请求人工协助，请管理员复核并跟进。",
            ...(trimmedComment ? ["", "员工补充说明：", trimmedComment] : []),
            "",
            "关联回答：",
            message.content
          ].join("\n"),
          priority: "normal"
        })
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "提交人工工单失败");
      }

      setTicketByMessage((current) => ({
        ...current,
        [message.id]: data.ticket.id
      }));
      await loadTickets();
      setTicketsExpanded(true);
      setTicketDraft(null);
      pushSuccess("已提交人工工单", `${data.ticket.id}，管理员会在后台处理。`);
    } catch (error) {
      pushActionError(error, "提交人工工单失败");
    } finally {
      setTicketSavingId(null);
    }
  }

  async function submitTicketComment(ticket: ServiceTicket) {
    const body = ticketCommentDraft[ticket.id]?.trim();

    if (!body) {
      return;
    }

    setTicketCommentSavingId(ticket.id);

    try {
      const response = await fetch(`/api/tickets/${ticket.id}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body })
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "补充工单说明失败");
      }

      setTicketCommentDraft((current) => ({ ...current, [ticket.id]: "" }));
      await loadTickets();
      pushSuccess("工单说明已补充", "管理员会在后台看到。");
    } catch (error) {
      pushActionError(error, "补充工单说明失败");
    } finally {
      setTicketCommentSavingId(null);
    }
  }

  async function playSpeech(message: Message) {
    if (playingId === message.id) {
      audioRef.current?.pause();
      if (audioRef.current) {
        audioRef.current.currentTime = 0;
      }
      stopBrowserSpeech();
      browserSpeechIdRef.current = null;
      setPlayingId(null);
      return;
    }

    audioRef.current?.pause();
    stopBrowserSpeech();
    browserSpeechIdRef.current = null;
    setPlayingId(message.id);
    try {
      const speechText = stripReferenceSummary(message.content);
      const response = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: speechText.slice(0, 1800) })
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error ?? "语音生成失败");
      }

      const blob = await response.blob();
      const audioUrl = URL.createObjectURL(blob);
      audioRef.current?.pause();
      if (audioUrlRef.current) {
        URL.revokeObjectURL(audioUrlRef.current);
      }
      audioUrlRef.current = audioUrl;
      audioRef.current = new Audio(audioUrl);
      audioRef.current.onended = () => {
        setPlayingId(null);
        URL.revokeObjectURL(audioUrl);
        if (audioUrlRef.current === audioUrl) {
          audioUrlRef.current = null;
        }
      };
      await audioRef.current.play();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "语音生成失败";
      const fallbackStarted = speakWithBrowserSpeech(message.content, {
        onEnd: () => {
          if (browserSpeechIdRef.current === message.id) {
            browserSpeechIdRef.current = null;
            setPlayingId(null);
          }
        },
        onError: () => {
          if (browserSpeechIdRef.current === message.id) {
            browserSpeechIdRef.current = null;
            setPlayingId(null);
            pushActionError(new Error("请检查浏览器权限或稍后重试。"), "浏览器语音朗读失败");
          }
        }
      });

      if (fallbackStarted) {
        browserSpeechIdRef.current = message.id;
        pushWarning("已改用浏览器朗读", `服务器语音暂不可用。原因：${errorMessage}`);
        return;
      }

      pushActionError(new Error(`${errorMessage}；当前浏览器也不支持本地朗读。`), "语音播放失败");
      setPlayingId(null);
    }
  }

  async function copyAnswer(content: string) {
    try {
      await navigator.clipboard.writeText(content);
      pushSuccess("回答已复制");
    } catch (error) {
      pushActionError(error, "复制失败");
    }
  }

  function renderConversationItem(conversation: Conversation, view: ConversationView) {
    const active = conversationId === conversation.id;
    const busy = conversationActionId === conversation.id;
    const editing = editingConversationId === conversation.id;
    const pinned = view === "recent" && Boolean(conversation.pinned_at);
    const timestamp =
      view === "archived" && conversation.archived_at
        ? `归档于 ${formatDateTime(conversation.archived_at)}`
        : formatDateTime(conversation.updated_at);

    return (
      <div
        key={conversation.id}
        className={`group flex items-stretch gap-1.5 rounded-lg border p-1.5 transition ${
          active
            ? "border-cyan bg-cyan/10 shadow-sm"
            : "border-line bg-white hover:border-cyan/30 hover:bg-slate-50"
        }`}
      >
        {editing ? (
          <div className="min-h-14 min-w-0 flex-1 rounded-md px-2">
            <label className="sr-only" htmlFor={`conversation-title-${conversation.id}`}>
              会话名称
            </label>
            <input
              id={`conversation-title-${conversation.id}`}
              value={editingConversationTitle}
              onChange={(event) => setEditingConversationTitle(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void renameConversationTitle(conversation);
                }

                if (event.key === "Escape") {
                  event.preventDefault();
                  cancelRenamingConversation();
                }
              }}
              autoFocus
              maxLength={80}
              className="h-10 w-full rounded-lg border border-cyan/30 bg-white px-2 text-sm font-semibold text-ink outline-none transition focus:border-brand focus:ring-2 focus:ring-cyan/20"
            />
            <span className="mt-1 flex items-center gap-1.5 text-xs text-slate-500">
              <Clock3 size={12} />
              {timestamp}
            </span>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => {
              cancelRenamingConversation();
              setConversationId(conversation.id);
            }}
            className="min-h-14 min-w-0 flex-1 rounded-md px-2 text-left outline-none transition focus-visible:ring-2 focus-visible:ring-brand/35"
          >
            <span className="flex min-w-0 items-center gap-2 text-sm font-semibold text-ink">
              {pinned ? (
                <Pin className="shrink-0 text-brand" size={14} />
              ) : (
                <MessageSquare className="shrink-0 text-slate-400" size={14} />
              )}
              <span className="truncate">{conversation.title || "新的对话"}</span>
              {pinned && (
                <span className="shrink-0 rounded-md bg-cyan/10 px-1.5 py-0.5 text-[11px] font-semibold text-brand">
                  置顶
                </span>
              )}
            </span>
            <span className="mt-1 flex items-center gap-1.5 text-xs text-slate-500">
              <Clock3 size={12} />
              {timestamp}
            </span>
          </button>
        )}

        {editing ? (
          <div className="flex shrink-0 items-center gap-1">
            <ConversationActionButton
              label="保存名称"
              loading={busy}
              onClick={() => void renameConversationTitle(conversation)}
            >
              <Save size={15} />
            </ConversationActionButton>
            <ConversationActionButton
              label="取消重命名"
              loading={false}
              onClick={cancelRenamingConversation}
            >
              <X size={15} />
            </ConversationActionButton>
          </div>
        ) : (
          <div className="flex shrink-0 items-center gap-1">
            {view === "recent" && (
              <ConversationActionButton
                label={pinned ? "取消置顶" : "置顶会话"}
                tone={pinned ? "active" : "default"}
                loading={busy}
                onClick={() => void updateConversationPinnedStatus(conversation, !pinned)}
              >
                {pinned ? <PinOff size={15} /> : <Pin size={15} />}
              </ConversationActionButton>
            )}
            <ConversationActionButton
              label="重命名会话"
              loading={false}
              onClick={() => startRenamingConversation(conversation)}
            >
              <PencilLine size={15} />
            </ConversationActionButton>
            {view === "recent" ? (
              <ConversationActionButton
                label="归档会话"
                loading={busy}
                onClick={() => void updateConversationArchiveStatus(conversation, true)}
              >
                <Archive size={15} />
              </ConversationActionButton>
            ) : (
              <>
                <ConversationActionButton
                  label="恢复会话"
                  loading={busy}
                  onClick={() => void updateConversationArchiveStatus(conversation, false)}
                >
                  <ArchiveRestore size={15} />
                </ConversationActionButton>
                <ConversationActionButton
                  label="删除归档会话"
                  tone="danger"
                  loading={busy}
                  onClick={() => setDeleteConfirmConversation(conversation)}
                >
                  <Trash2 size={15} />
                </ConversationActionButton>
              </>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="grid min-h-[calc(100dvh-112px)] gap-4 lg:h-[calc(100dvh-40px)] lg:min-h-0 xl:grid-cols-[340px_minmax(0,1fr)]">
      <aside className="ui-card min-h-0 overflow-y-auto p-4 lg:h-full">
        <div className="-mx-4 -mt-4 mb-4 border-b border-line bg-[linear-gradient(rgba(16,32,51,0.035)_1px,transparent_1px),linear-gradient(90deg,rgba(16,32,51,0.035)_1px,transparent_1px),linear-gradient(135deg,rgba(0,166,214,0.12),transparent_260px)] bg-[length:28px_28px,28px_28px,auto] px-4 py-4 text-ink">
        <div className="flex items-center gap-3">
          <span className="grid size-11 place-items-center rounded-lg bg-brand text-white shadow-glow">
            <Bot size={20} />
          </span>
          <div>
            <h1 className="text-base font-semibold text-ink">天瑞内饰智能客服</h1>
            <p className="text-xs font-medium text-brand">Knowledge Copilot</p>
          </div>
        </div>
        </div>
        <button
          type="button"
          onClick={startNewConversation}
          className="ui-button-primary mt-5 h-10 w-full"
        >
          <Plus size={16} />
          新建对话
        </button>

        <div className="mt-5 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600">
              <History size={14} />
              最近会话
            </span>
            {conversationsLoading && <Loader2 className="animate-spin text-slate-400" size={14} />}
          </div>

          <label className="relative block">
            <span className="sr-only">搜索会话</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={15} />
            <input
              value={conversationSearch}
              onChange={(event) => setConversationSearch(event.target.value)}
              placeholder="搜索标题或消息内容"
              className="h-11 w-full rounded-lg border border-line bg-white pl-9 pr-10 text-sm font-medium text-ink outline-none transition placeholder:text-slate-400 focus:border-brand focus:ring-2 focus:ring-cyan/20"
            />
            {conversationSearch && (
              <button
                type="button"
                onClick={() => setConversationSearch("")}
                aria-label="清空会话搜索"
                className="absolute right-1.5 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-ink"
              >
                <X size={14} />
              </button>
            )}
          </label>

          <div className="scrollbar-thin max-h-[52dvh] space-y-1.5 overflow-y-auto pr-1 lg:max-h-[48dvh] xl:max-h-[50dvh]">
            {conversations.map((conversation) => renderConversationItem(conversation, "recent"))}
            {!conversationsLoading && conversations.length === 0 && (
              <div className="rounded-lg border border-dashed border-line bg-slate-50/70 px-3 py-3 text-xs leading-5 text-slate-500">
                {conversationSearch.trim()
                  ? "没有找到匹配的最近会话。可以换个关键词，或展开归档会话查看。"
                  : "还没有历史会话，发送第一个问题后会自动保存。"}
              </div>
            )}
          </div>

          <div className="border-t border-line pt-3">
            <button
              type="button"
              onClick={() => setArchiveExpanded((current) => !current)}
              aria-expanded={archiveExpanded}
              className="flex min-h-11 w-full items-center justify-between gap-2 rounded-lg border border-line bg-white px-3 text-left text-sm font-semibold text-slate-600 transition hover:border-cyan/40 hover:bg-cyan/5 hover:text-ink"
            >
              <span className="inline-flex min-w-0 items-center gap-2">
                <Archive size={15} />
                <span className="truncate">归档会话</span>
              </span>
              <span className="inline-flex shrink-0 items-center gap-1.5 text-xs font-medium text-slate-500">
                {archivedConversationsLoading && <Loader2 className="animate-spin" size={14} />}
                {archiveExpanded && archivedConversations.length > 0 && `${archivedConversations.length} 条`}
                {archiveExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </span>
            </button>

            {archiveExpanded && (
              <div className="scrollbar-thin mt-2 min-h-[5.5rem] max-h-72 space-y-1.5 overflow-y-auto pr-1">
                {archivedConversations.map((conversation) => renderConversationItem(conversation, "archived"))}
                {!archivedConversationsLoading && archivedConversations.length === 0 && (
                  <div className="rounded-lg border border-dashed border-line bg-slate-50/70 px-3 py-3 text-xs leading-5 text-slate-500">
                    {conversationSearch.trim()
                      ? "归档中没有匹配的会话。"
                      : "归档里还没有会话。最近会话点归档后，会出现在这里。"}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <MyTicketsPanel
          tickets={tickets}
          commentsByTicket={ticketCommentsByTicket}
          loading={ticketsLoading}
          expanded={ticketsExpanded}
          savingId={ticketCommentSavingId}
          drafts={ticketCommentDraft}
          onToggle={() => setTicketsExpanded((current) => !current)}
          onDraftChange={(ticketId, value) =>
            setTicketCommentDraft((current) => ({ ...current, [ticketId]: value }))
          }
          onSubmit={(ticket) => void submitTicketComment(ticket)}
        />

      </aside>

      <section className="flex min-h-[680px] flex-col overflow-hidden rounded-lg border border-line bg-panel shadow-panel lg:h-full lg:min-h-0">
        <div className="border-b border-line bg-white px-5 py-4">
          <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-mint/10 px-2.5 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-mint/20">
                <span className="size-1.5 rounded-full bg-mint" />
                在线问答
              </div>
              <h2 className="text-base font-semibold text-ink">
                {activeConversation?.title || "员工对话窗口"}
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                {activeConversation
                  ? `最近更新：${formatDateTime(activeConversation.updated_at)}`
                  : "输入问题后会优先根据公司资料回答，也可以反馈或转人工。"}
              </p>
            </div>
            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
              <button
                type="button"
                onClick={() => { setMailboxUnbindConfirm(false); setMailboxDialogOpen(true); }}
                className={`inline-flex h-11 items-center justify-center gap-2 rounded-full border px-3 text-sm font-semibold transition ${winmailBinding?.bound ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-line bg-white text-slate-600 hover:border-cyan/30 hover:text-brand"}`}
              >
                <Mail size={16} />{winmailBinding?.bound ? "邮箱已连接" : "连接邮箱"}
              </button>
              <KnowledgeBaseSelect
                value={selectedKnowledgeBaseId}
                knowledgeBases={knowledgeBases}
                disabled={contextLoading || loading}
                onChange={setSelectedKnowledgeBaseId}
              />
            </div>
          </div>
        </div>

        <div
          ref={messagesScrollRef}
          className="scrollbar-thin min-h-0 flex-1 space-y-4 overflow-y-auto bg-[linear-gradient(rgba(16,32,51,0.032)_1px,transparent_1px),linear-gradient(90deg,rgba(16,32,51,0.032)_1px,transparent_1px),linear-gradient(180deg,#ffffff,#f6faff)] bg-[length:30px_30px,30px_30px,auto] px-5 py-5"
        >
          {messages.length === 0 && !loading && (
            <EmptyChatState
              hasSearchableScope={searchableCount > 0}
              onPickPrompt={(prompt) => {
                setInput(prompt);
                void sendText(prompt);
              }}
            />
          )}

          {messages.map((message) => {
            const displayContent = message.role === "assistant"
              ? stripReferenceSummary(message.content)
              : message.content;
            const retryQuestion = message.role === "assistant" ? failedRetryByMessage[message.id] : undefined;
            const failedAnswer = Boolean(retryQuestion);

            return (
              <article
                key={message.id}
                className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-3xl rounded-lg px-4 py-3 ${
                    message.role === "user"
                      ? "bg-brand text-white shadow-glow ring-1 ring-cyan/20"
                      : failedAnswer
                        ? "border border-red-200 bg-red-50 text-red-800 shadow-panel"
                        : "border border-line bg-white text-ink shadow-panel"
                  }`}
                >
                  <p className="whitespace-pre-wrap text-sm leading-6">
                    {displayContent || (message.role === "assistant" ? "正在查找资料..." : "")}
                  </p>
                  {message.role === "assistant" && message.metadata && (
                    <BusinessToolResultPanel
                      metadata={message.metadata}
                      onBindMailbox={() => { setMailboxUnbindConfirm(false); setMailboxDialogOpen(true); }}
                    />
                  )}
                  {message.role === "assistant" && retryQuestion && (
                    <RetryAnswerNotice
                      loading={loading}
                      onRetry={() => retryFailedMessage(message.id, retryQuestion)}
                    />
                  )}
                  {message.role === "assistant" && message.content && !failedAnswer && !isBusinessToolMetadata(message.metadata) && (
                    <AnswerNotice
                      content={message.content}
                      citationCount={message.citations.length}
                    />
                  )}
                  {message.role === "assistant" && message.content && !failedAnswer && message.citations.length > 0 && !isNoHitAnswer(message.content) && !isGeneralModelAnswer(message.content) && (
                    <CitationSection citations={message.citations} messageId={message.id} />
                  )}
                  {message.role === "assistant" && message.content && !failedAnswer && (
                    <>
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <IconButton
                          label="复制"
                          onClick={() => {
                            setOpenActionMenuId(null);
                            void copyAnswer(displayContent || message.content);
                          }}
                        >
                          <Copy size={16} />
                        </IconButton>
                        <IconButton
                          label="转人工"
                          active={Boolean(ticketByMessage[message.id]) || ticketDraft?.messageId === message.id}
                          onClick={() => toggleTicketDraft(message)}
                        >
                          {ticketSavingId === message.id ? <Loader2 className="animate-spin" size={16} /> : <MessageSquare size={16} />}
                        </IconButton>
                        <IconButton
                          label="更多操作"
                          active={openActionMenuId === message.id}
                          onClick={() => setOpenActionMenuId((current) => (current === message.id ? null : message.id))}
                        >
                          <MoreHorizontal size={17} />
                        </IconButton>
                        {feedbackByMessage[message.id] && (
                          <span className="inline-flex min-h-9 items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs text-emerald-700">
                            <CheckCircle2 size={13} />
                            已收到反馈
                          </span>
                        )}
                      </div>
                      {openActionMenuId === message.id && (
                        <div className="mt-2 grid w-fit min-w-48 gap-1 rounded-lg border border-line bg-white p-1 shadow-panel">
                          <MenuActionButton
                            label={playingId === message.id ? "停止语音" : "播放语音"}
                            onClick={() => {
                              setOpenActionMenuId(null);
                              void playSpeech(message);
                            }}
                          >
                            {playingId === message.id ? <Loader2 className="animate-spin" size={16} /> : <Volume2 size={16} />}
                          </MenuActionButton>
                          <MenuActionButton
                            label="有帮助"
                            active={feedbackByMessage[message.id] === "like" || (feedbackDraft?.messageId === message.id && feedbackDraft.rating === "like")}
                            onClick={() => toggleFeedbackDraft(message.id, "like")}
                          >
                            {feedbackSavingId === message.id ? <Loader2 className="animate-spin" size={16} /> : <ThumbsUp size={16} />}
                          </MenuActionButton>
                          <MenuActionButton
                            label="需改进"
                            active={feedbackByMessage[message.id] === "dislike" || (feedbackDraft?.messageId === message.id && feedbackDraft.rating === "dislike")}
                            onClick={() => toggleFeedbackDraft(message.id, "dislike")}
                          >
                            {feedbackSavingId === message.id ? <Loader2 className="animate-spin" size={16} /> : <ThumbsDown size={16} />}
                          </MenuActionButton>
                        </div>
                      )}
                    </>
                  )}
                  {message.role === "assistant" && message.content && !failedAnswer && feedbackDraft?.messageId === message.id && (
                    <FeedbackDetailForm
                      draft={feedbackDraft}
                      saving={feedbackSavingId === message.id}
                      onChange={setFeedbackDraft}
                      onCancel={() => setFeedbackDraft(null)}
                      onSubmit={() => {
                        const detail = [feedbackDraft.reason, feedbackDraft.comment.trim()]
                          .filter(Boolean)
                          .join("：");
                        void submitFeedback(message.id, feedbackDraft.rating, detail);
                      }}
                    />
                  )}
                  {message.role === "assistant" && message.content && !failedAnswer && ticketDraft?.messageId === message.id && (
                    <TicketConfirmForm
                      comment={ticketDraft.comment}
                      saving={ticketSavingId === message.id}
                      onChange={(comment) => setTicketDraft({ messageId: message.id, comment })}
                      onCancel={() => setTicketDraft(null)}
                      onSubmit={() => void submitTicket(message, ticketDraft.comment)}
                    />
                  )}
                </div>
              </article>
            );
          })}
          {loading && (
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <Loader2 className="animate-spin" size={16} />
              正在生成回答...
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        <div className="shrink-0 border-t border-line bg-white p-4">
          {!contextLoading && searchableCount === 0 && (
            <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              当前资料范围暂无可用内容，发送后系统会提示管理员补充或刷新资料状态。
            </div>
          )}
          <div className="flex gap-3">
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void sendMessage();
                }
              }}
              placeholder="输入问题，例如：新员工入职流程是什么？"
              className="ui-input min-h-12 flex-1 resize-none py-3"
            />
            <button
              onClick={() => void sendMessage()}
              disabled={!canSend}
              className="ui-button-primary h-12 w-12 shrink-0 px-0"
              aria-label="发送"
            >
              {loading ? <Loader2 className="animate-spin" size={18} /> : <Send size={18} />}
            </button>
          </div>
        </div>
      </section>
      {deleteConfirmConversation && (
        <ConversationDeleteDialog
          conversation={deleteConfirmConversation}
          deleting={conversationActionId === deleteConfirmConversation.id}
          onCancel={() => setDeleteConfirmConversation(null)}
          onConfirm={() => void deleteArchivedConversation()}
        />
      )}
      {mailboxDialogOpen && (
        <WinmailBindingDialog
          binding={winmailBinding}
          email={mailboxEmail}
          password={mailboxPassword}
          working={mailboxWorking}
          confirmUnbind={mailboxUnbindConfirm}
          onEmailChange={setMailboxEmail}
          onPasswordChange={setMailboxPassword}
          onBind={() => void bindWinmailMailbox()}
          onRequestUnbind={() => setMailboxUnbindConfirm(true)}
          onCancelUnbind={() => setMailboxUnbindConfirm(false)}
          onUnbind={() => void unbindWinmailMailbox()}
          onClose={() => { if (!mailboxWorking) { setMailboxDialogOpen(false); setMailboxPassword(""); setMailboxUnbindConfirm(false); } }}
        />
      )}
    </div>
  );
}

function BusinessToolResultPanel({ metadata, onBindMailbox }: { metadata: Record<string, unknown>; onBindMailbox: () => void }) {
  if (metadata.kind === "business_tool_error") {
    return <div className="mt-3 border-t border-line pt-3"><p className="text-xs font-semibold text-amber-700">Winmail · 仅本人邮箱</p>{metadata.action_required === "bind_winmail" && <button type="button" onClick={onBindMailbox} className="ui-button-primary mt-2 h-9 px-3"><Mail size={15} />连接个人邮箱</button>}</div>;
  }
  if (metadata.kind !== "business_tool" || !metadata.result || typeof metadata.result !== "object") return null;
  const result = metadata.result as Record<string, unknown>;
  const messages = Array.isArray(result.messages) ? result.messages as Array<Record<string, unknown>> : [];
  return <section className="mt-3 border-t border-line pt-3" aria-label="Winmail 查询结果">
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500"><span className="font-semibold text-brand">Winmail</span><span>{String(metadata.data_scope ?? "仅本人邮箱")}</span><span>{formatToolDate(String(metadata.queried_at ?? ""))}</span></div>
    {result.type === "winmail_unread" && <p className="mt-2 text-2xl font-semibold tabular-nums text-ink">{Number(result.unread ?? 0)}<span className="ml-1 text-sm font-medium text-slate-500">封未读</span></p>}
    {result.type === "winmail_message_list" && messages.length > 0 && <div className="mt-2 divide-y divide-line border-y border-line">
      {messages.map((item, index) => <div key={String(item.id ?? index)} className="py-3">
        <div className="flex items-start justify-between gap-3"><p className="min-w-0 break-words text-sm font-semibold text-ink">{String(item.subject || "（无主题）")}</p>{item.unread === true && <span className="shrink-0 rounded-full bg-cyan/10 px-2 py-0.5 text-[11px] font-semibold text-brand">未读</span>}</div>
        <p className="mt-1 break-all text-xs text-slate-600">{String(item.sender_name || item.sender_email || "未知发件人")}{item.sender_name && item.sender_email ? ` · ${String(item.sender_email)}` : ""}</p>
        <p className="mt-1 text-xs text-slate-400">{formatToolDate(String(item.sent_at ?? ""))}{item.has_attachment === true ? " · 有附件" : ""}{item.size ? ` · ${String(item.size)}` : ""}</p>
      </div>)}
    </div>}
  </section>;
}

function WinmailBindingDialog({ binding, email, password, working, confirmUnbind, onEmailChange, onPasswordChange, onBind, onRequestUnbind, onCancelUnbind, onUnbind, onClose }: {
  binding: WinmailBinding | null; email: string; password: string; working: boolean; confirmUnbind: boolean;
  onEmailChange: (value: string) => void; onPasswordChange: (value: string) => void; onBind: () => void;
  onRequestUnbind: () => void; onCancelUnbind: () => void; onUnbind: () => void; onClose: () => void;
}) {
  return <div className="fixed inset-0 z-[950] flex items-end justify-center bg-slate-950/45 p-3 backdrop-blur-sm sm:items-center" role="dialog" aria-modal="true" aria-labelledby="winmail-binding-title">
    <section className="w-full max-w-md rounded-lg border border-line bg-white p-5 shadow-panel">
      <div className="flex items-start justify-between gap-3"><div><h2 id="winmail-binding-title" className="text-base font-semibold text-ink">个人 Winmail 邮箱</h2><p className="mt-1 text-sm text-slate-500">{binding?.bound ? `已连接 ${binding.email_masked}` : "验证后可在对话中查询本人邮件摘要"}</p></div><button type="button" onClick={onClose} disabled={working} aria-label="关闭邮箱连接框" className="grid size-9 place-items-center rounded-lg text-slate-500 hover:bg-slate-100"><X size={16} /></button></div>
      {binding?.bound ? <div className="mt-4">
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm text-emerald-800"><p className="font-semibold">身份已验证</p><p className="mt-1">{binding.email_masked}</p></div>
        {confirmUnbind ? <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3"><p className="text-sm text-red-800">解除后将删除加密凭证，不能继续查询邮箱。</p><div className="mt-3 flex justify-end gap-2"><button type="button" onClick={onCancelUnbind} disabled={working} className="ui-button-secondary h-10">取消</button><button type="button" onClick={onUnbind} disabled={working} className="inline-flex h-10 items-center gap-2 rounded-lg bg-red-600 px-3 text-sm font-semibold text-white">{working && <Loader2 size={15} className="animate-spin" />}确认解除</button></div></div> : <button type="button" onClick={onRequestUnbind} className="mt-4 text-sm font-semibold text-red-700 hover:text-red-800">解除邮箱连接</button>}
      </div> : <div className="mt-4 space-y-3">
        {!binding?.encryption_ready && <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">服务器凭证加密尚未就绪，请联系管理员。</p>}
        <label className="block"><span className="text-sm font-medium text-slate-700">邮箱地址</span><input type="email" value={email} onChange={(event) => onEmailChange(event.target.value)} autoComplete="username" className="ui-input mt-1 h-11 w-full" placeholder="name@company.com" /></label>
        <label className="block"><span className="text-sm font-medium text-slate-700">邮箱密码</span><input type="password" value={password} onChange={(event) => onPasswordChange(event.target.value)} autoComplete="current-password" className="ui-input mt-1 h-11 w-full" /></label>
        <button type="button" onClick={onBind} disabled={working || !binding?.encryption_ready || !email.trim() || !password} className="ui-button-primary h-11 w-full justify-center">{working ? <Loader2 size={16} className="animate-spin" /> : <Mail size={16} />}验证并连接</button>
      </div>}
    </section>
  </div>;
}

function isBusinessToolMetadata(metadata: Record<string, unknown> | undefined) { return metadata?.kind === "business_tool" || metadata?.kind === "business_tool_error"; }
function formatToolDate(value: string) { if (!value) return ""; const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { hour12: false }); }

function EmptyChatState({
  hasSearchableScope,
  onPickPrompt
}: {
  hasSearchableScope: boolean;
  onPickPrompt: (prompt: string) => void;
}) {
  const prompts = quickPromptGroups.flatMap((group) => group.prompts).slice(0, 6);

  return (
    <div className="ui-card p-5">
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-cyan/10 text-brand">
          <Bot size={20} />
        </span>
        <div>
          <h3 className="text-sm font-semibold text-ink">开始一次问答</h3>
          <p className="mt-1 text-sm leading-6 text-slate-500">
            {hasSearchableScope
              ? "我会优先查找你有权限访问的企业资料，并在回答下方收起来源。"
              : "当前范围还没有可用资料，可以先提问确认提示效果，或联系管理员上传资料。"}
          </p>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {prompts.map((prompt) => (
          <button
            key={prompt}
            type="button"
            onClick={() => onPickPrompt(prompt)}
            className="ui-button-secondary min-h-10 px-3 py-2 text-sm font-medium"
          >
            {prompt}
          </button>
        ))}
      </div>
    </div>
  );
}

function KnowledgeBaseSelect({
  value,
  knowledgeBases,
  disabled,
  onChange
}: {
  value: string;
  knowledgeBases: KnowledgeBaseScope[];
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label className="relative block w-full sm:w-auto">
      <span className="sr-only">资料范围</span>
      <Database className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-brand" size={15} />
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        className="h-11 w-full max-w-full appearance-none rounded-full border border-cyan/20 bg-cyan/10 pl-9 pr-9 text-sm font-semibold text-brand outline-none transition hover:border-cyan/40 focus:border-brand focus:ring-2 focus:ring-cyan/20 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400 sm:w-auto sm:max-w-[280px]"
      >
        <option value="">全部资料范围</option>
        {knowledgeBases.map((knowledgeBase) => (
          <option key={knowledgeBase.id} value={knowledgeBase.id}>
            {knowledgeBase.name}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-brand" size={15} />
    </label>
  );
}

function ConversationActionButton({
  label,
  tone = "default",
  loading,
  onClick,
  children
}: {
  label: string;
  tone?: "default" | "danger" | "active";
  loading: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      aria-label={label}
      title={label}
      className={`grid size-11 shrink-0 place-items-center rounded-lg border text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/35 disabled:cursor-wait disabled:opacity-70 ${
        tone === "danger"
          ? "border-red-100 bg-red-50 text-red-700 hover:bg-red-100"
          : tone === "active"
            ? "border-cyan/30 bg-cyan/10 text-brand hover:border-cyan/50 hover:bg-cyan/15"
          : "border-line bg-white text-slate-500 hover:border-cyan/30 hover:bg-cyan/10 hover:text-brand"
      }`}
    >
      {loading ? <Loader2 className="animate-spin" size={15} /> : children}
    </button>
  );
}

function ConversationDeleteDialog({
  conversation,
  deleting,
  onCancel,
  onConfirm
}: {
  conversation: Conversation;
  deleting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const titleId = `delete-conversation-title-${conversation.id}`;

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !deleting) {
        onCancel();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [deleting, onCancel]);

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <button
        type="button"
        className="absolute inset-0 cursor-default"
        aria-label="取消删除会话"
        onClick={deleting ? undefined : onCancel}
      />
      <section className="relative z-10 w-full max-w-md rounded-lg border border-line bg-white p-5 shadow-panel">
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-red-50 text-red-700">
            <Trash2 size={18} />
          </span>
          <div className="min-w-0">
            <h3 id={titleId} className="text-base font-semibold text-ink">
              从个人列表移除归档会话？
            </h3>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              将删除「{conversation.title || "新的对话"}」以及该会话下的消息、反馈和人工工单记录。删除后无法恢复。
            </p>
            <div className="mt-3 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-xs leading-5 text-red-700">
              只有已经归档的会话才能移除。相关工单、安全事件和审计记录仍会按企业规则保留。
            </div>
          </div>
        </div>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={deleting}
            className="ui-button-secondary min-h-11 px-4"
          >
            <X size={16} />
            取消
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={deleting}
            className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-red-600 px-4 text-sm font-semibold text-white transition hover:bg-red-700 disabled:cursor-wait disabled:bg-red-300"
          >
            {deleting ? <Loader2 className="animate-spin" size={16} /> : <Trash2 size={16} />}
            确认移除
          </button>
        </div>
      </section>
    </div>
  );
}

function MyTicketsPanel({
  tickets,
  commentsByTicket,
  loading,
  expanded,
  savingId,
  drafts,
  onToggle,
  onDraftChange,
  onSubmit
}: {
  tickets: ServiceTicket[];
  commentsByTicket: Record<string, ServiceTicketComment[]>;
  loading: boolean;
  expanded: boolean;
  savingId: string | null;
  drafts: Record<string, string>;
  onToggle: () => void;
  onDraftChange: (ticketId: string, value: string) => void;
  onSubmit: (ticket: ServiceTicket) => void;
}) {
  const visibleTickets = tickets.slice(0, 3);
  const activeTickets = tickets.filter((ticket) => ticket.status !== "resolved" && ticket.status !== "ignored").length;
  const overdueTickets = tickets.filter((ticket) =>
    Boolean(
      ticket.due_at &&
        ticket.status !== "resolved" &&
        ticket.status !== "ignored" &&
        new Date(ticket.due_at).getTime() < Date.now()
    )
  ).length;

  return (
    <div className="mt-5">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="w-full rounded-lg border border-line bg-white px-3 py-2.5 text-left transition hover:border-cyan/40 hover:bg-cyan/5"
      >
        <span className="flex items-center justify-between gap-2">
          <span className="inline-flex min-w-0 items-center gap-1.5 text-xs font-semibold text-slate-600">
            <MessageSquare size={14} />
            <span className="truncate">人工协助</span>
          </span>
          <span className="inline-flex shrink-0 items-center gap-1.5 text-xs text-slate-500">
            {loading ? (
              <Loader2 className="animate-spin" size={14} />
            ) : overdueTickets > 0 ? (
              <span className="rounded-full bg-red-50 px-2 py-0.5 font-medium text-red-700">{overdueTickets} 个超时</span>
            ) : activeTickets > 0 ? (
              <span className="rounded-full bg-amber-50 px-2 py-0.5 font-medium text-amber-700">{activeTickets} 个处理中</span>
            ) : (
              <span className="rounded-full bg-slate-100 px-2 py-0.5">暂无待办</span>
            )}
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </span>
        </span>
        <span className="mt-1 block text-xs leading-5 text-slate-500">
          {expanded ? "收起后保留状态提醒，不占用会话空间。" : "有需要时展开查看人工处理进度。"}
        </span>
      </button>

      {expanded && (
        <div className="mt-2 space-y-2">
        {visibleTickets.map((ticket) => {
          const comments = commentsByTicket[ticket.id] ?? [];
          const overdue = Boolean(
            ticket.due_at &&
              ticket.status !== "resolved" &&
              ticket.status !== "ignored" &&
              new Date(ticket.due_at).getTime() < Date.now()
          );

          return (
            <div key={ticket.id} className="rounded-lg border border-line bg-white p-3 shadow-sm">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-ink">{ticket.title}</p>
                  <p className="mt-1 text-xs text-slate-500">{formatDateTime(ticket.updated_at)}</p>
                </div>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
                    overdue
                      ? "bg-red-50 text-red-700"
                      : ticket.status === "resolved"
                        ? "bg-emerald-50 text-emerald-700"
                        : "bg-amber-50 text-amber-700"
                  }`}
                >
                  {overdue ? "已超时" : employeeTicketStatusLabel[ticket.status]}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                <span>优先级：{ticket.priority === "urgent" ? "紧急" : ticket.priority === "high" ? "高" : ticket.priority === "low" ? "低" : "普通"}</span>
                <span>到期：{ticket.due_at ? formatDateTime(ticket.due_at) : "未设置"}</span>
              </div>
              {comments.slice(-1).map((comment) => (
                <p key={comment.id} className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-600">
                  {comment.body}
                </p>
              ))}
              <div className="mt-2 flex gap-2">
                <input
                  value={drafts[ticket.id] ?? ""}
                  onChange={(event) => onDraftChange(ticket.id, event.target.value)}
                  placeholder="补充说明"
                  className="h-9 min-w-0 flex-1 rounded-lg border border-line px-3 text-xs outline-none focus:border-brand"
                />
                <button
                  type="button"
                  onClick={() => onSubmit(ticket)}
                  disabled={savingId === ticket.id || !(drafts[ticket.id] ?? "").trim()}
                  className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand text-white hover:bg-brand-strong disabled:bg-slate-200"
                  aria-label="提交工单说明"
                >
                  {savingId === ticket.id ? <Loader2 className="animate-spin" size={14} /> : <Send size={14} />}
                </button>
              </div>
            </div>
          );
        })}
        {!loading && visibleTickets.length === 0 && (
          <div className="rounded-lg border border-dashed border-line bg-slate-50/70 px-3 py-3 text-xs leading-5 text-slate-500">
            暂无人工工单。
          </div>
        )}
        {tickets.length > visibleTickets.length && (
          <div className="rounded-lg border border-dashed border-line bg-slate-50/70 px-3 py-2 text-xs leading-5 text-slate-500">
            已显示最近 {visibleTickets.length} 个，其他历史工单可由管理员在后台查看。
          </div>
        )}
      </div>
      )}
    </div>
  );
}

function FeedbackDetailForm({
  draft,
  saving,
  onChange,
  onCancel,
  onSubmit
}: {
  draft: FeedbackDraft;
  saving: boolean;
  onChange: (draft: FeedbackDraft) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const reasons = draft.rating === "like" ? positiveFeedbackReasons : negativeFeedbackReasons;

  return (
    <div className="mt-3 rounded-lg border border-amber-200 bg-white p-3">
      <div className="mb-3 flex items-start gap-2 text-sm text-ink">
        {draft.rating === "like" ? <ThumbsUp className="mt-0.5 text-brand" size={16} /> : <ThumbsDown className="mt-0.5 text-amber-700" size={16} />}
        <div>
          <p className="font-semibold">{draft.rating === "like" ? "确认提交有帮助反馈" : "填写改进反馈"}</p>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            {draft.rating === "like" ? "可以补充说明哪些内容帮到了你，确认后才会提交。" : "选择原因并补充说明，管理员会在会话反馈里看到。"}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {reasons.map((reason) => (
          <button
            key={reason}
            type="button"
            onClick={() => onChange({ ...draft, reason })}
            className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium transition ${
              draft.reason === reason
                ? "border-amber-300 bg-amber-50 text-amber-800"
                : "border-line bg-white text-slate-600 hover:bg-slate-50"
            }`}
          >
            {reason}
          </button>
        ))}
      </div>
      <textarea
        value={draft.comment}
        onChange={(event) => onChange({ ...draft, comment: event.target.value })}
        placeholder={draft.rating === "like" ? "补充说明，例如：引用很清楚，已解决我的问题" : "补充说明，例如：第 2 条回答和培训手册不一致"}
        className="mt-3 min-h-20 w-full resize-none rounded-lg border border-line px-3 py-2 text-sm outline-none transition focus:border-amber-300"
      />
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="ui-button-secondary h-9 px-3"
        >
          <X size={15} />
          取消
        </button>
        <button
          type="button"
          onClick={onSubmit}
          disabled={saving}
          className="ui-button-warning h-9 px-3"
        >
          {saving ? <Loader2 className="animate-spin" size={15} /> : <Save size={15} />}
          提交反馈
        </button>
      </div>
    </div>
  );
}

function TicketConfirmForm({
  comment,
  saving,
  onChange,
  onCancel,
  onSubmit
}: {
  comment: string;
  saving: boolean;
  onChange: (comment: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  return (
    <div className="mt-3 rounded-lg border border-cyan/25 bg-cyan/5 p-3">
      <div className="flex items-start gap-2 text-sm text-ink">
        <MessageSquare className="mt-0.5 text-brand" size={16} />
        <div>
          <p className="font-semibold">确认提交人工工单</p>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            提交后管理员会在后台处理这条回答。你可以补充希望人工确认的问题。
          </p>
        </div>
      </div>
      <textarea
        value={comment}
        onChange={(event) => onChange(event.target.value)}
        placeholder="补充说明，例如：请人工确认这条制度是否适用于当前部门"
        className="mt-3 min-h-20 w-full resize-none rounded-lg border border-line bg-white px-3 py-2 text-sm outline-none transition focus:border-brand"
      />
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="ui-button-secondary h-9 px-3"
        >
          <X size={15} />
          取消
        </button>
        <button
          type="button"
          onClick={onSubmit}
          disabled={saving}
          className="ui-button-primary h-9 px-3"
        >
          {saving ? <Loader2 className="animate-spin" size={15} /> : <Send size={15} />}
          提交工单
        </button>
      </div>
    </div>
  );
}

function RetryAnswerNotice({
  loading,
  onRetry
}: {
  loading: boolean;
  onRetry: () => void;
}) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={onRetry}
        disabled={loading}
        className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-red-200 bg-white px-3 text-sm font-semibold text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:text-red-300"
      >
        {loading ? <Loader2 className="animate-spin" size={16} /> : <RotateCcw size={16} />}
        重试
      </button>
      <span className="text-xs leading-5 text-red-600">
        这次请求没有成功发送或连接中断。
      </span>
    </div>
  );
}

function AnswerNotice({ content, citationCount }: { content: string; citationCount: number }) {
  const noHit = isNoHitAnswer(content);
  const generalAnswer = isGeneralModelAnswer(content);

  if (noHit) {
    return (
      <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">
        <span className="inline-flex items-center gap-1 font-semibold">
          <CircleAlert size={13} />
          没找到明确依据
        </span>
        <p className="mt-1">系统会把这类问题纳入管理员排查，也可以点“需改进”补充说明。</p>
      </div>
    );
  }

  if (generalAnswer) {
    return (
      <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">
        <span className="inline-flex items-center gap-1 font-semibold">
          <CircleAlert size={13} />
          这条回答仅供临时参考
        </span>
        <p className="mt-1">回答可用于临时参考，涉及制度、质量、安全要求时请以公司已发布资料为准，系统会提示管理员补齐依据。</p>
      </div>
    );
  }

  if (citationCount === 0 && !isWelcomeAssistantMessage(content)) {
    return (
      <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">
        <span className="inline-flex items-center gap-1 font-semibold">
          <CircleAlert size={13} />
          未找到可核对来源
        </span>
        <p className="mt-1">系统会把这类回答纳入管理员排查；关键信息建议先人工确认。</p>
      </div>
    );
  }

  return null;
}

function CitationSection({ citations, messageId }: { citations: Citation[]; messageId: string }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open]);

  if (citations.length === 0) {
    return (
      <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">
        <span className="inline-flex items-center gap-1 font-medium">
          <CircleAlert size={13} />
          暂无可核对来源
        </span>
        <p className="mt-1">建议点“需改进”反馈给管理员补充资料。</p>
      </div>
    );
  }

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-line bg-slate-50 px-3 text-xs font-medium text-slate-600 transition hover:border-cyan/40 hover:bg-cyan/10 hover:text-brand"
      >
        <CheckCircle2 size={13} />
        已引用 {citations.length} 个来源
        <span className="text-slate-400">查看</span>
        <ChevronDown size={13} />
      </button>
      {open && <CitationDrawer citations={citations} messageId={messageId} onClose={() => setOpen(false)} />}
    </div>
  );
}

function CitationDrawer({
  citations,
  messageId,
  onClose
}: {
  citations: Citation[];
  messageId: string;
  onClose: () => void;
}) {
  const titleId = `citation-drawer-title-${messageId}`;

  return (
    <div
      className="fixed inset-0 z-[80] flex items-end justify-end bg-slate-950/45 px-3 py-3 backdrop-blur-[2px] sm:items-stretch sm:px-0 sm:py-0"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <button
        type="button"
        className="absolute inset-0 cursor-default"
        aria-label="关闭引用来源"
        onClick={onClose}
      />
      <aside className="relative z-10 flex max-h-[calc(100dvh-24px)] w-full max-w-xl flex-col overflow-hidden rounded-lg border border-line bg-white shadow-panel sm:h-dvh sm:max-h-none sm:rounded-none sm:border-y-0 sm:border-r-0">
        <div className="flex items-start justify-between gap-3 border-b border-line bg-white px-4 py-4">
          <div className="min-w-0">
            <p id={titleId} className="text-sm font-semibold text-ink">
              引用来源
            </p>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              本次回答引用了 {citations.length} 个资料片段，默认仅在这里集中查看。
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭引用来源"
            className="grid size-11 shrink-0 place-items-center rounded-lg border border-line bg-white text-slate-600 transition hover:bg-slate-50 hover:text-ink"
          >
            <X size={17} />
          </button>
        </div>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-slate-50/70 p-4">
          {citations.map((citation) => (
            <CitationView key={`${messageId}-${citation.index ?? citation.file_id ?? citation.url}`} citation={citation} />
          ))}
        </div>
      </aside>
    </div>
  );
}

function stripReferenceSummary(content: string) {
  let lines = content.split("\n");
  const trailingSourceStart = findLastIndex(lines, (line) => /^(?:参考|引用)来源[:：]/.test(line.trim()));

  if (trailingSourceStart >= 0 && lines.slice(trailingSourceStart).every((line, index) => {
    const trimmed = line.trim();
    return !trimmed || index === 0 || isReferenceListLine(trimmed);
  })) {
    lines = lines.slice(0, trailingSourceStart);
  }

  return lines
    .filter((line) => !/^参考来源[:：]\s*(?:\[[^\]]+\][,，、\s]*)+$/.test(line.trim()))
    .filter((line) => !isReferenceSummaryLine(line.trim()))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function findLastIndex<T>(items: T[], predicate: (item: T) => boolean) {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (predicate(items[index])) {
      return index;
    }
  }

  return -1;
}

function isReferenceSummaryLine(line: string) {
  if (!line) {
    return false;
  }

  return /^(?:参考|引用)来源[:：]\s*(?:$|(?:\[[^\]]+\].*)|(?:无|暂无|没有|未提供|无明确(?:依据|来源)?|N\/?A|n\/?a|[-—])\s*[。.!！]*)$/.test(line);
}

function isReferenceListLine(line: string) {
  return /^(?:\[\d+\]|\d+[.、)]|[-*]\s*)/.test(line);
}

function isNoHitAnswer(content: string) {
  return content.includes("未在知识库中找到明确依据") ||
    content.includes("没有可检索资料") ||
    content.includes("暂无可用资料");
}

function isGeneralModelAnswer(content: string) {
  return content.startsWith("当前没有可用公司资料作为依据，以下内容仅供临时参考");
}

function isWelcomeAssistantMessage(content: string) {
  return content.startsWith("你好，我是企业智能客服");
}

function formatChatError(error: unknown) {
  const message = error instanceof Error ? error.message : "";

  if (message === "Failed to fetch") {
    return "连接失败，可能是网络波动或服务刚重启。请点击下方“重试”。";
  }

  if (message) {
    return message.includes("对话暂时失败") || message.includes("回答生成失败")
      ? `${message} 可以点击下方“重试”。`
      : `发送失败：${message}。可以点击下方“重试”。`;
  }

  return "发送失败，请点击下方“重试”。";
}

function formatApiError(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return fallback;
}

async function readStream(body: ReadableStream<Uint8Array>, onEvent: (event: ChatStreamEvent) => void) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.trim()) {
        continue;
      }

      onEvent(JSON.parse(line) as ChatStreamEvent);
    }
  }

  if (buffer.trim()) {
    onEvent(JSON.parse(buffer) as ChatStreamEvent);
  }
}

function CitationView({ citation }: { citation: Citation }) {
  const label = citation.file_name ?? citation.file_id ?? citation.url ?? "资料文件";
  const meta = citationMeta(citation);

  if (citation.url) {
    return (
      <a
        href={citation.url}
        target="_blank"
        rel="noreferrer"
        className="flex max-w-full items-start justify-between gap-3 rounded-lg border border-line bg-white px-3 py-3 text-sm text-brand shadow-sm transition hover:border-cyan/40 hover:bg-cyan/5"
      >
        <span className="min-w-0">
          <span className="block font-semibold text-ink">来源 {citation.index}：{label}</span>
          {meta && <span className="mt-1 block text-xs leading-5 text-slate-500">{meta}</span>}
          {citation.quote && <span className="mt-2 block text-xs leading-5 text-slate-600">{citation.quote}</span>}
        </span>
        <ExternalLink className="mt-0.5 shrink-0 text-brand" size={15} />
      </a>
    );
  }

  return (
    <div className="rounded-lg border border-line bg-white px-3 py-3 text-sm text-slate-600 shadow-sm">
      <div className="font-semibold text-ink">
        来源 {citation.index}：{label}
      </div>
      {meta && <div className="mt-1 text-xs leading-5 text-slate-500">{meta}</div>}
      {citation.quote && <div className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-600">{citation.quote}</div>}
    </div>
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

  return parts.join(" · ");
}

function formatDateTime(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();

  return new Intl.DateTimeFormat("zh-CN", {
    month: sameDay ? undefined : "2-digit",
    day: sameDay ? undefined : "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function IconButton({
  label,
  active,
  onClick,
  children
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className={`inline-flex size-11 items-center justify-center rounded-lg border transition ${
        active
          ? "border-cyan/30 bg-cyan/10 text-brand"
          : "border-line bg-white text-slate-600 hover:bg-slate-100 hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

function MenuActionButton({
  label,
  active,
  onClick,
  children
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex min-h-10 items-center gap-2 rounded-lg px-3 text-left text-sm font-medium transition ${
        active
          ? "bg-cyan/10 text-brand"
          : "text-slate-600 hover:bg-slate-50 hover:text-ink"
      }`}
    >
      <span className="grid size-5 shrink-0 place-items-center">{children}</span>
      <span>{label}</span>
    </button>
  );
}
