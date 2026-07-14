export function safeInternalPath(value: string | null | undefined, fallback = "/") {
  const path = String(value ?? "").trim();
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\") || /[\u0000-\u001f]/.test(path)) {
    return fallback;
  }

  try {
    const parsed = new URL(path, "http://internal.local");
    return parsed.origin === "http://internal.local" ? `${parsed.pathname}${parsed.search}${parsed.hash}` : fallback;
  } catch {
    return fallback;
  }
}

export function safePostLoginPath(value: string | null | undefined, isAdmin: boolean) {
  const path = safeInternalPath(value, isAdmin ? "/" : "/chat");
  return !isAdmin && path.startsWith("/admin") ? "/chat" : path;
}
