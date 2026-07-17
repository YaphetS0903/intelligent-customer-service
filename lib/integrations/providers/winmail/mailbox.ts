import { decryptIntegrationCredential } from "@/lib/integrations/credential-crypto";
import { maskEmail } from "@/lib/integrations/config";
import { fetchWinmailInboxPage, fetchWinmailMailboxUnread } from "@/lib/integrations/providers/winmail/client";
import { listUserIdentities } from "@/lib/integrations/store";
import { findUserCredential } from "@/lib/integrations/tool-store";
import type { WinmailMessageSummary } from "@/lib/integrations/types";

export async function queryWinmailUnread(userId: string) {
  const auth = await mailboxAuth(userId);
  const response = await fetchWinmailMailboxUnread(auth.email, auth.password);
  const info = response.info ?? {};
  const unread = nonNegativeInt(info.inbox ?? info.INBOX ?? 0);
  return { unread, mailbox: maskEmail(auth.email), queried_at: new Date().toISOString(), scope: "仅本人邮箱" };
}

export async function searchWinmailInbox(userId: string, input: {
  sender?: string;
  subject?: string;
  date_from?: string;
  date_to?: string;
  unread_only?: boolean;
  limit?: number;
}) {
  const auth = await mailboxAuth(userId);
  const limit = Math.min(Math.max(Math.trunc(input.limit ?? 10), 1), 20);
  const messages: WinmailMessageSummary[] = [];
  let total = 0;
  let unreadTotal = 0;
  let totalPages = 1;
  for (let page = 1; page <= Math.min(totalPages, 5) && messages.length < limit; page += 1) {
    const response = await fetchWinmailInboxPage(auth.email, auth.password, page);
    const info = response.info ?? {};
    totalPages = Math.max(1, nonNegativeInt(info.totalpage ?? 1));
    total = nonNegativeInt(info.msgtotal ?? total);
    unreadTotal = nonNegativeInt(info.newmsg ?? unreadTotal);
    const rawMessages = Array.isArray(info.messagelist) ? info.messagelist : [];
    for (const raw of rawMessages) {
      const summary = normalizeMessage(raw);
      if (summary && matches(summary, input)) messages.push(summary);
      if (messages.length >= limit) break;
    }
  }
  return {
    messages,
    matched: messages.length,
    inbox_total: total,
    inbox_unread: unreadTotal,
    mailbox: maskEmail(auth.email),
    queried_at: new Date().toISOString(),
    scope: "仅本人邮箱",
    filters: safeFilters(input)
  };
}

async function mailboxAuth(userId: string) {
  const [identities, credential] = await Promise.all([listUserIdentities(5000), findUserCredential("winmail", userId)]);
  const identity = identities.find((item) => item.connector_id === "winmail" && item.user_id === userId && item.status === "verified");
  if (!identity || !credential) throw new Error("尚未绑定个人 Winmail 邮箱");
  const email = (identity.external_email || identity.external_user_id).trim().toLowerCase();
  return { email, password: decryptIntegrationCredential(credential.encrypted_secret, `winmail:${userId}`) };
}

function normalizeMessage(value: unknown): WinmailMessageSummary | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const id = clean(raw.msgid, 255);
  if (!id) return null;
  const parsedDate = parseDate(clean(raw.date ?? raw.shortdate, 80));
  return {
    id,
    folder: clean(raw.folder ?? "INBOX", 64),
    sender_name: clean(raw.name, 160),
    sender_email: normalizeSenderEmail(clean(raw.mail, 255)),
    subject: clean(raw.subject || "（无主题）", 300),
    sent_at: parsedDate,
    unread: raw.readflag !== true && raw.readflag !== 1 && raw.readflag !== "1",
    has_attachment: raw.attach === true || raw.attach === 1 || raw.attach === "1",
    size: clean(raw.size, 40)
  };
}

function matches(message: WinmailMessageSummary, input: { sender?: string; subject?: string; date_from?: string; date_to?: string; unread_only?: boolean }) {
  const sender = clean(input.sender, 120).toLowerCase();
  const subject = clean(input.subject, 160).toLowerCase();
  if (sender && !`${message.sender_name} ${message.sender_email}`.toLowerCase().includes(sender)) return false;
  if (subject && !message.subject.toLowerCase().includes(subject)) return false;
  if (input.unread_only && !message.unread) return false;
  const time = Date.parse(message.sent_at);
  const from = input.date_from ? Date.parse(input.date_from) : Number.NaN;
  const to = input.date_to ? Date.parse(input.date_to) : Number.NaN;
  if (Number.isFinite(from) && (!Number.isFinite(time) || time < from)) return false;
  if (Number.isFinite(to) && (!Number.isFinite(time) || time > to)) return false;
  return true;
}

function safeFilters(input: { sender?: string; subject?: string; date_from?: string; date_to?: string; unread_only?: boolean }) {
  return { sender: clean(input.sender, 120), subject: clean(input.subject, 160), date_from: input.date_from ?? "", date_to: input.date_to ?? "", unread_only: Boolean(input.unread_only) };
}

function parseDate(value: string) {
  if (!value) return "";
  const normalized = value.replace(/\//g, "-");
  const local = normalized.match(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}(?::\d{2})?)$/);
  const parsed = Date.parse(local ? `${local[1]}T${local[2]}+08:00` : normalized);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : value;
}

function normalizeSenderEmail(value: string) {
  const match = value.match(/<?([^<>\s]+@[^<>\s]+)>?/);
  return (match?.[1] ?? value).toLowerCase();
}

function clean(value: unknown, max: number) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

function nonNegativeInt(value: unknown) {
  const parsed = Number.parseInt(String(value ?? "0"), 10);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}
