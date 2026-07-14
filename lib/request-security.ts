type RateLimitEntry = {
  timestamps: number[];
  blockedUntil: number;
};

type RateLimitResult = {
  allowed: boolean;
  retryAfterSeconds: number;
  blockedNow: boolean;
};

const rateLimitStore = new Map<string, RateLimitEntry>();

export function getRequestIp(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip")?.trim() || "unknown";
}

export function consumeRateLimit(
  key: string,
  options: { limit: number; windowMs: number; blockMs?: number }
): RateLimitResult {
  const now = Date.now();
  const entry = rateLimitStore.get(key) ?? { timestamps: [], blockedUntil: 0 };

  if (entry.blockedUntil > now) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((entry.blockedUntil - now) / 1000)),
      blockedNow: false
    };
  }

  entry.timestamps = entry.timestamps.filter((timestamp) => timestamp > now - options.windowMs);
  if (entry.timestamps.length >= options.limit) {
    entry.blockedUntil = now + (options.blockMs ?? options.windowMs);
    rateLimitStore.set(key, entry);
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((entry.blockedUntil - now) / 1000)),
      blockedNow: true
    };
  }

  entry.timestamps.push(now);
  entry.blockedUntil = 0;
  rateLimitStore.set(key, entry);
  pruneRateLimitStore(now);
  return { allowed: true, retryAfterSeconds: 0, blockedNow: false };
}

export function clearRateLimit(key: string) {
  rateLimitStore.delete(key);
}

export function checkRateLimit(key: string): RateLimitResult {
  const entry = rateLimitStore.get(key);
  const now = Date.now();
  if (!entry || entry.blockedUntil <= now) return { allowed: true, retryAfterSeconds: 0, blockedNow: false };
  return {
    allowed: false,
    retryAfterSeconds: Math.max(1, Math.ceil((entry.blockedUntil - now) / 1000)),
    blockedNow: false
  };
}

function pruneRateLimitStore(now: number) {
  if (rateLimitStore.size < 5000) return;
  for (const [key, entry] of rateLimitStore) {
    if (entry.blockedUntil <= now && entry.timestamps.every((timestamp) => timestamp < now - 3_600_000)) {
      rateLimitStore.delete(key);
    }
  }
}
