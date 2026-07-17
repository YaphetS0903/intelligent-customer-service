import { createHash, randomBytes } from "node:crypto";
import { env } from "@/lib/config";
import { getWecomConfig } from "@/lib/integrations/config";
import { fetchWecomJsApiTicket } from "@/lib/integrations/providers/wecom/client";

export async function createWecomJsSdkConfig(pageUrl: string) {
  const ticket = await fetchWecomJsApiTicket();
  const nonceStr = randomBytes(16).toString("hex");
  const timestamp = Math.floor(Date.now() / 1000);
  const signatureSource = `jsapi_ticket=${ticket}&noncestr=${nonceStr}&timestamp=${timestamp}&url=${pageUrl.split("#")[0]}`;
  return {
    appId: getWecomConfig().corpId,
    nonceStr,
    timestamp,
    signature: createHash("sha1").update(signatureSource).digest("hex")
  };
}

export function getWecomBrowserHandoffPageUrl() {
  return `${env.appBaseUrl.replace(/\/$/, "")}/wecom/open`;
}
