import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.PLAYWRIGHT_PORT ?? "3100");
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${port}`;
const externalBaseURL = Boolean(process.env.PLAYWRIGHT_BASE_URL);

if (process.env.E2E_ALLOW_DATABASE_WRITE !== "true") {
  throw new Error("Playwright 回归会写入测试数据，请显式设置 E2E_ALLOW_DATABASE_WRITE=true 并使用独立测试数据库。");
}

if (!externalBaseURL && !/(test|ci|e2e)/i.test(process.env.MYSQL_DATABASE ?? "")) {
  throw new Error("本地 Playwright 只能连接数据库名包含 test、ci 或 e2e 的独立测试数据库。");
}

export default defineConfig({
  testDir: "./tests/e2e",
  globalTeardown: "./tests/e2e/global-teardown.ts",
  timeout: 60_000,
  expect: {
    timeout: 10_000
  },
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    trace: "on-first-retry"
  },
  ...(externalBaseURL
    ? {}
    : {
        webServer: {
          command: `npm run dev -- -p ${port}`,
          url: baseURL,
          reuseExistingServer: !process.env.CI,
          timeout: 120_000
        }
      }),
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] }
    }
  ]
});
