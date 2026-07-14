import { NextResponse } from "next/server";
import { authCookieOptions, sessionCookieName } from "@/lib/auth-session";

export async function POST() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(sessionCookieName, "", authCookieOptions(0));

  return response;
}
