import { NextResponse } from "next/server";
import { env, isMySqlDatabase } from "@/lib/config";
import { isSsoEnabled } from "@/lib/sso";
import { isWecomSsoEnabled } from "@/lib/wecom-sso";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    enabled: isMySqlDatabase() && isSsoEnabled(),
    oidcEnabled: isMySqlDatabase() && isSsoEnabled(),
    wecomEnabled: isWecomSsoEnabled(),
    provider: env.ssoProvider,
    selfRegistrationEnabled: isMySqlDatabase() && env.allowSelfRegistration
  });
}
