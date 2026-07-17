#!/usr/bin/env node
import { readFile } from "node:fs/promises";

const envFile = process.env.ENV_FILE || "/app/.env.local";
const fileEnv = parseEnv(await readFile(envFile, "utf8"));
const enabled = readSetting("WECOM_DIRECTORY_SYNC_ENABLED") === "true";
const secret = readSetting("WECOM_SYNC_CRON_SECRET");
const port = readSetting("PORT") || "4009";

if (!enabled) {
  console.log("WeCom directory schedule is disabled");
  process.exit(0);
}
if (secret.length < 32) {
  throw new Error("WECOM_SYNC_CRON_SECRET is not configured");
}

const response = await fetch(`http://127.0.0.1:${port}/api/internal/wecom/directory-sync`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${secret}`,
    "User-Agent": "tianrui-wecom-directory-cron/1.0"
  },
  signal: AbortSignal.timeout(120_000)
});
const body = await response.text();
if (!response.ok) throw new Error(`WeCom directory sync failed: HTTP ${response.status} ${body}`);
console.log(body);

function readSetting(key) {
  return process.env[key] ?? fileEnv[key] ?? "";
}

function parseEnv(content) {
  const result = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index <= 0) continue;
    const key = line.slice(0, index).trim().replace(/^export\s+/, "");
    let value = line.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}
