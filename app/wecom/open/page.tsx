import { redirect } from "next/navigation";
import { WecomBrowserHandoff } from "@/components/wecom-browser-handoff";
import { getCurrentUserOrNull } from "@/lib/db";
import { safePostLoginPath } from "@/lib/safe-navigation";
import {
  buildWecomExternalAuthorizeUrl,
  createWecomExternalState,
  isWecomSsoEnabled
} from "@/lib/wecom-sso";
import { createWecomJsSdkConfig, getWecomBrowserHandoffPageUrl } from "@/lib/wecom-js-sdk";

export const dynamic = "force-dynamic";

export default async function WecomOpenPage() {
  if (!isWecomSsoEnabled()) redirect("/login?error=企业微信单点登录尚未启用");
  const user = await getCurrentUserOrNull();
  if (!user) redirect("/api/auth/wecom/start?next=/wecom/open");

  const next = safePostLoginPath("/", user.role === "admin");
  const externalState = await createWecomExternalState(next);
  const [sdkConfig] = await Promise.all([
    createWecomJsSdkConfig(getWecomBrowserHandoffPageUrl())
  ]);

  return (
    <WecomBrowserHandoff
      sdkConfig={sdkConfig}
      externalLoginUrl={buildWecomExternalAuthorizeUrl(externalState)}
      fallbackUrl={user.role === "admin" ? "/?embedded=1" : "/chat?embedded=1"}
    />
  );
}
