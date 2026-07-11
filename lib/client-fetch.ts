export async function fetchWithRetry(
  input: RequestInfo | URL,
  init: RequestInit = {},
  options: { attempts?: number; timeoutMs?: number } = {}
) {
  const attempts = options.attempts ?? 3;
  const timeoutMs = options.timeoutMs ?? 15000;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      return await fetch(input, {
        ...init,
        signal: controller.signal
      });
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, 600 * attempt));
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError instanceof Error ? lastError : new Error("请求超时，请稍后重试");
}
