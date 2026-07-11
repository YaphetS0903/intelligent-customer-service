export const DEFAULT_CONVERSATION_TITLE = "新的对话";

const DEFAULT_TITLE_SET = new Set([
  "",
  DEFAULT_CONVERSATION_TITLE,
  "新对话",
  "未命名对话",
  "Untitled conversation"
]);

function compactTitleText(input: string) {
  return input
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s#>*\-_=+、，。,.!！?？:：;；|/\\]+/, "")
    .replace(/[\s、，。,.!！?？:：;；|/\\]+$/, "")
    .trim();
}

export function createConversationTitleFromMessage(input: string, limit = 30) {
  const compacted = compactTitleText(input);

  if (!compacted) {
    return DEFAULT_CONVERSATION_TITLE;
  }

  const chars = Array.from(compacted);
  if (chars.length <= limit) {
    return compacted;
  }

  return `${chars.slice(0, limit).join("").trim()}...`;
}

export function isDefaultConversationTitle(title: string | null | undefined) {
  return DEFAULT_TITLE_SET.has(compactTitleText(String(title ?? "")));
}
