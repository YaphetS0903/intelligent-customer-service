import { env } from "@/lib/config";

export const sessionCookieName = "tr_auth_session";
const maxAgeSeconds = 60 * 60 * 24 * 7;

type SessionPayload = {
  userId: string;
  exp: number;
};

function base64UrlEncode(value: string | Uint8Array) {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function base64UrlDecode(value: string) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

async function hmac(input: string, secret: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(input));
  return base64UrlEncode(new Uint8Array(signature));
}

export function sessionMaxAgeSeconds() {
  return maxAgeSeconds;
}

export async function createSessionToken(userId: string) {
  const payload: SessionPayload = {
    userId,
    exp: Math.floor(Date.now() / 1000) + maxAgeSeconds
  };
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = await hmac(encodedPayload, env.authSecret);
  return `${encodedPayload}.${signature}`;
}

export async function verifySessionToken(token: string | undefined | null) {
  if (!token) {
    return null;
  }

  const [encodedPayload, signature] = token.split(".");
  if (!encodedPayload || !signature) {
    return null;
  }

  const expected = await hmac(encodedPayload, env.authSecret);
  if (signature !== expected) {
    return null;
  }

  try {
    const payload = JSON.parse(base64UrlDecode(encodedPayload)) as SessionPayload;
    if (!payload.userId || payload.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}
