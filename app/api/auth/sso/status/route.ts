import { NextResponse } from "next/server";
import { env, isMySqlDatabase } from "@/lib/config";
import { isSsoEnabled } from "@/lib/sso";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    enabled: isMySqlDatabase() && isSsoEnabled(),
    provider: env.ssoProvider
  });
}
