import { expect, test, type APIResponse, type Page } from "@playwright/test";
import { signWinmailParams } from "../../lib/integrations/providers/winmail/client";

let demoSeedPromise: Promise<void> | null = null;

async function tryLogin(page: Page, role: "admin" | "employee" = "admin") {
  const testPassword = process.env.E2E_TEST_PASSWORD || "local-e2e-password";
  const employeeEmail = process.env.E2E_EMPLOYEE_EMAIL || "test.employee@tianrui.local";
  const credentials = role === "admin"
    ? { email: process.env.INITIAL_ADMIN_EMAIL || "admin@e2e.local", password: process.env.INITIAL_ADMIN_PASSWORD || testPassword }
    : { email: employeeEmail, password: testPassword };

  let lastError = "";

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await page.request.post("/api/auth/login", {
        data: credentials,
        failOnStatusCode: false,
        timeout: 30_000
      });

      if (response.ok()) {
        const user = (await response.json()).user as { id: string; email: string; role: string };
        if (role === "admin") {
          await ensureDemoData(page);
        }
        return user;
      }

      lastError = await response.text();
      if (role === "employee" && response.status() === 401) {
        await ensureEmployeeAccount(page);
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : "登录请求失败";
    }

    await page.waitForTimeout(1000 * attempt);
  }

  expect(false, lastError).toBeTruthy();
  throw new Error(lastError);
}

async function loginWithCredentials(page: Page, email: string, password: string) {
  const response = await page.request.post("/api/auth/login", {
    data: { email, password },
    failOnStatusCode: false
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return (await response.json()).user as { id: string; email: string; role: string };
}

async function ensureEmployeeAccount(page: Page) {
  const employeeEmail = process.env.E2E_EMPLOYEE_EMAIL || "test.employee@tianrui.local";
  const adminCredentials = {
    email: process.env.INITIAL_ADMIN_EMAIL || "admin@e2e.local",
    password: process.env.INITIAL_ADMIN_PASSWORD || process.env.E2E_TEST_PASSWORD || "local-e2e-password"
  };
  const adminLogin = await page.request.post("/api/auth/login", { data: adminCredentials, failOnStatusCode: false });
  if (!adminLogin.ok()) throw new Error(`管理员登录失败：${await adminLogin.text()}`);
  const response = await page.request.post("/api/users", {
    data: {
      email: employeeEmail,
      password: process.env.E2E_TEST_PASSWORD || "local-e2e-password",
      name: "测试员工",
      department: "生产部",
      position: "操作员"
    },
    failOnStatusCode: false
  });

  if (response.ok()) return;

  const text = await response.text();
  if (!/已存在|duplicate|Duplicate/i.test(text)) {
    throw new Error(`创建测试员工失败：${text}`);
  }
}

async function createTestEmployee(page: Page, marker: string) {
  const adminEmail = process.env.INITIAL_ADMIN_EMAIL || "admin@e2e.local";
  const adminPassword = process.env.INITIAL_ADMIN_PASSWORD || process.env.E2E_TEST_PASSWORD || "local-e2e-password";
  await loginWithCredentials(page, adminEmail, adminPassword);
  const email = `security.${marker.toLowerCase()}@tianrui.local`;
  const password = process.env.E2E_TEST_PASSWORD || "local-e2e-password";
  const response = await page.request.post("/api/users", {
    data: { email, password, name: `安全测试 ${marker}`, department: "生产部", position: "操作员", role: "employee" },
    failOnStatusCode: false
  });
  if (!response.ok()) throw new Error(`创建安全测试员工失败：${await response.text()}`);
  return { ...(await response.json()).user as { id: string; email: string }, email, password };
}

async function ensureDemoData(page: Page) {
  if (process.env.PLAYWRIGHT_SEED_DEMO === "0") {
    return;
  }

  demoSeedPromise ??= postDemoSeedWithRetry(page);
  try {
    await demoSeedPromise;
  } catch (error) {
    demoSeedPromise = null;
    throw error;
  }
}

async function postDemoSeedWithRetry(page: Page) {
  let lastError = "";

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const response = await page.request.post("/api/admin/demo-seed", { failOnStatusCode: false });

    if (response.ok()) {
      return;
    }

    lastError = `${response.status()} ${await response.text()}`;
    await page.waitForTimeout(1000 * attempt);
  }

  throw new Error(`整理演示数据失败：${lastError}`);
}

async function getWithRetry(page: Page, url: string, attempts = 3): Promise<APIResponse> {
  let lastError = "";

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await page.request.get(url, { failOnStatusCode: false, timeout: 30_000 });

      if (response.ok()) {
        return response;
      }

      lastError = `${response.status()} ${await response.text()}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : "请求失败";
    }

    await page.waitForTimeout(1000 * attempt);
  }

  expect(false, lastError).toBeTruthy();
  throw new Error(lastError);
}

async function gotoWithRetry(page: Page, url: string, attempts = 3) {
  let lastError = "";

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
      return;
    } catch (error) {
      lastError = error instanceof Error ? error.message : "页面打开失败";
    }

    await page.waitForTimeout(1000 * attempt);
  }

  expect(false, lastError).toBeTruthy();
  throw new Error(lastError);
}

async function expectEnabledWithReload(page: Page, url: string, name: RegExp, attempts = 3) {
  let lastError = "";

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await expect(page.getByRole("button", { name })).toBeEnabled({ timeout: 45_000 });
      return;
    } catch (error) {
      lastError = error instanceof Error ? error.message : "按钮未恢复可用";
      if (attempt < attempts) {
        await gotoWithRetry(page, url);
      }
    }
  }

  expect(false, lastError).toBeTruthy();
  throw new Error(lastError);
}

async function expectTextWithReload(page: Page, url: string, text: string, attempts = 3) {
  let lastError = "";
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await expect(page.getByText(text).first()).toBeVisible({ timeout: 30_000 });
      return;
    } catch (error) {
      lastError = error instanceof Error ? error.message : "内容未显示";
      if (attempt < attempts) await gotoWithRetry(page, url);
    }
  }
  expect(false, lastError).toBeTruthy();
}

async function expectHeadingWithReload(page: Page, url: string, name: string, attempts = 3) {
  let lastError = "";
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await expect(page.getByRole("heading", { name })).toBeVisible({ timeout: 30_000 });
      return;
    } catch (error) {
      lastError = error instanceof Error ? error.message : "页面标题未显示";
      if (attempt < attempts) await gotoWithRetry(page, url);
    }
  }
  expect(false, lastError).toBeTruthy();
}

test.describe("天瑞内饰智能客服回归", () => {
  test.describe.configure({ timeout: 180_000 });
  test("工作台可以打开并展示核心入口", async ({ page }) => {
    await tryLogin(page);
    await gotoWithRetry(page, "/");

    await expect(page.getByRole("heading", { name: /西安天瑞汽车内饰件有限公司智能客服中控台/ })).toBeVisible();
    await expect(page.getByText("员工智能问答")).toBeVisible();
    await expect(page.getByText("PPT 语音讲解")).toBeVisible();
  });

  test("员工智能客服页面可以加载", async ({ page }) => {
    await tryLogin(page, "employee");
    await gotoWithRetry(page, "/chat");

    await expect(page.getByRole("heading", { name: "天瑞内饰智能客服" })).toBeVisible();
    await expect(page.getByText("员工对话窗口")).toBeVisible();
    await expect(page.getByPlaceholder("输入问题，例如：新员工入职流程是什么？")).toBeVisible();
  });

  test("员工首页直接进入服务端且不展示管理导航", async ({ page }) => {
    await tryLogin(page, "employee");
    await gotoWithRetry(page, "/");

    await expect(page).toHaveURL(/\/chat$/);
    await expect(page.getByRole("heading", { name: "天瑞内饰智能客服" })).toBeVisible();
    await expect(page.getByRole("link", { name: "知识管理" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "智能问答" })).toBeVisible();
    await expect(page.getByRole("link", { name: "培训课程" })).toBeVisible();
  });

  test("生产安全边界拒绝自助注册、匿名 TTS 和员工后台访问", async ({ page }) => {
    const register = await page.request.post("/api/auth/register", {
      data: { email: `blocked.${Date.now()}@tianrui.local`, password: "blocked-password", name: "禁止注册" },
      failOnStatusCode: false
    });
    expect(register.status()).toBe(403);

    const tts = await page.request.post("/api/tts", {
      data: { text: "匿名语音请求" },
      failOnStatusCode: false
    });
    expect(tts.status()).toBe(401);

    const tool = await page.request.post("/api/tools/execute", {
      data: {},
      failOnStatusCode: false
    });
    expect(tool.status()).toBe(401);
    expect((await tool.json()).code).toBe("UNAUTHENTICATED");

    const bindMailbox = await page.request.post("/api/integrations/winmail/binding", {
      data: {},
      failOnStatusCode: false
    });
    expect(bindMailbox.status()).toBe(401);
    const unbindMailbox = await page.request.delete("/api/integrations/winmail/binding", { failOnStatusCode: false });
    expect(unbindMailbox.status()).toBe(401);

    await tryLogin(page, "employee");
    const dashboard = await page.request.get("/api/dashboard", { failOnStatusCode: false });
    expect(dashboard.status()).toBe(403);
    const insights = await page.request.get("/api/admin/insights", { failOnStatusCode: false });
    expect(insights.status()).toBe(403);
    await gotoWithRetry(page, "/admin/operations");
    await expect(page).toHaveURL(/\/chat$/);
  });

  test("登录 Cookie 按应用地址统一设置安全属性", async ({ page }) => {
    const email = process.env.INITIAL_ADMIN_EMAIL || "admin@e2e.local";
    const password = process.env.INITIAL_ADMIN_PASSWORD || process.env.E2E_TEST_PASSWORD || "local-e2e-password";
    const response = await page.request.post("/api/auth/login", {
      data: { email, password },
      failOnStatusCode: false
    });
    expect(response.ok(), await response.text()).toBeTruthy();
    const cookie = response.headers()["set-cookie"] ?? "";
    expect(cookie).toContain("tr_auth_session=");
    expect(cookie.toLowerCase()).toContain("httponly");
    expect(cookie.toLowerCase()).toContain("samesite=lax");
    if ((process.env.APP_BASE_URL ?? "").startsWith("https://")) {
      expect(cookie.toLowerCase()).toContain("secure");
    } else {
      expect(cookie.toLowerCase()).not.toContain("secure");
    }
  });

  test("禁用管理员后旧登录会话立即失效", async ({ page, browser }) => {
    const marker = `DISABLED-ADMIN-${Date.now()}`;
    const target = await createTestEmployee(page, marker);
    const promote = await page.request.patch(`/api/users/${target.id}`, {
      data: { name: `临时管理员 ${marker}`, role: "admin", department: "信息部", position: "管理员", status: "active" },
      failOnStatusCode: false
    });
    expect(promote.ok(), await promote.text()).toBeTruthy();

    const targetContext = await browser.newContext({ baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3100" });
    const targetPage = await targetContext.newPage();
    try {
      await loginWithCredentials(targetPage, target.email, target.password);
      const beforeDisable = await targetPage.request.get("/api/dashboard", { failOnStatusCode: false });
      expect(beforeDisable.ok(), await beforeDisable.text()).toBeTruthy();

      const disable = await page.request.patch(`/api/users/${target.id}`, {
        data: { name: `临时管理员 ${marker}`, role: "employee", department: "信息部", position: "管理员", status: "disabled" },
        failOnStatusCode: false
      });
      expect(disable.ok(), await disable.text()).toBeTruthy();

      const oldSession = await targetPage.request.get("/api/auth/me", { failOnStatusCode: false });
      expect(oldSession.status()).toBe(401);
      const oldDashboard = await targetPage.request.get("/api/dashboard", { failOnStatusCode: false });
      expect(oldDashboard.ok()).toBeFalsy();
    } finally {
      await targetContext.close();
      await page.request.patch(`/api/users/${target.id}`, {
        data: { name: `安全测试 ${marker}`, role: "employee", department: "生产部", position: "操作员", status: "disabled" },
        failOnStatusCode: false
      });
    }
  });

  test("上传接口拒绝伪装 PDF 和异常 XLSX", async ({ page }) => {
    await tryLogin(page);
    const knowledgeBasesResponse = await page.request.get("/api/knowledge-bases", { failOnStatusCode: false });
    expect(knowledgeBasesResponse.ok(), await knowledgeBasesResponse.text()).toBeTruthy();
    const knowledgeBaseId = ((await knowledgeBasesResponse.json()).knowledgeBases as Array<{ id: string }>)[0]?.id;
    expect(knowledgeBaseId).toBeTruthy();

    const fakePdf = await page.request.post("/api/documents/upload", {
      multipart: {
        knowledge_base_id: knowledgeBaseId,
        file: { name: "fake.pdf", mimeType: "application/pdf", buffer: Buffer.from("not-a-pdf") }
      },
      failOnStatusCode: false
    });
    expect(fakePdf.status()).toBe(400);
    expect((await fakePdf.json()).error).toContain("不是有效的 PDF 文件");

    const fakeXlsx = await page.request.post("/api/documents/upload", {
      multipart: {
        knowledge_base_id: knowledgeBaseId,
        file: {
          name: "fake.xlsx",
          mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          buffer: Buffer.from("not-an-office-archive")
        }
      },
      failOnStatusCode: false
    });
    expect(fakeXlsx.status()).toBe(400);
    expect((await fakeXlsx.json()).error).toContain("不是有效的 Office Open XML 文件");
  });

  test("反馈和工单校验归属且软删除保留审计", async ({ page }) => {
    test.setTimeout(240_000);
    const marker = `OWNERSHIP-${Date.now()}`;
    const first = await createTestEmployee(page, `${marker}-A`);
    const second = await createTestEmployee(page, `${marker}-B`);

    await loginWithCredentials(page, first.email, first.password);
    const chatResponse = await page.request.post("/api/chat", {
      data: { message: "我有多少封未读邮件？" },
      failOnStatusCode: false,
      timeout: 60_000
    });
    expect(chatResponse.ok(), await chatResponse.text()).toBeTruthy();
    const chat = await chatResponse.json() as {
      conversation: { id: string };
      messages: Array<{ id: string; role: string }>;
    };
    const assistantMessage = chat.messages.find((message) => message.role === "assistant");
    expect(assistantMessage).toBeTruthy();

    const firstFeedback = await page.request.post("/api/feedback", {
      data: { message_id: assistantMessage!.id, rating: "like", comment: marker }
    });
    expect(firstFeedback.ok(), await firstFeedback.text()).toBeTruthy();
    const firstFeedbackId = (await firstFeedback.json()).feedback.id as string;
    const updatedFeedback = await page.request.post("/api/feedback", {
      data: { message_id: assistantMessage!.id, rating: "dislike", comment: `${marker}-updated` }
    });
    expect(updatedFeedback.ok(), await updatedFeedback.text()).toBeTruthy();
    expect((await updatedFeedback.json()).feedback).toEqual(expect.objectContaining({ id: firstFeedbackId, rating: "dislike" }));

    const ticketResponse = await page.request.post("/api/tickets", {
      data: {
        conversation_id: chat.conversation.id,
        message_id: assistantMessage!.id,
        title: `归属测试 ${marker}`,
        description: `验证软删除审计保留 ${marker}`
      }
    });
    expect(ticketResponse.ok(), await ticketResponse.text()).toBeTruthy();
    const ticketId = (await ticketResponse.json()).ticket.id as string;

    await loginWithCredentials(page, second.email, second.password);
    const foreignFeedback = await page.request.post("/api/feedback", {
      data: { message_id: assistantMessage!.id, rating: "like" },
      failOnStatusCode: false
    });
    expect(foreignFeedback.status()).toBe(403);
    const foreignTicket = await page.request.post("/api/tickets", {
      data: { conversation_id: chat.conversation.id, title: marker, description: marker },
      failOnStatusCode: false
    });
    expect(foreignTicket.status()).toBe(403);

    await loginWithCredentials(page, first.email, first.password);
    const archive = await page.request.patch(`/api/conversations/${chat.conversation.id}`, { data: { archived: true } });
    expect(archive.ok(), await archive.text()).toBeTruthy();
    const remove = await page.request.delete(`/api/conversations/${chat.conversation.id}`);
    expect(remove.ok(), await remove.text()).toBeTruthy();
    const archivedList = await page.request.get("/api/conversations?view=archived");
    expect((await archivedList.json()).conversations.map((item: { id: string }) => item.id)).not.toContain(chat.conversation.id);

    await tryLogin(page);
    const adminInsights = await getWithRetry(page, "/api/admin/insights", 4);
    const audit = (await adminInsights.json()).insights as {
      conversations: Array<{ id: string; deleted_at: string | null }>;
      feedback: Array<{ id: string }>;
      tickets: Array<{ id: string }>;
    };
    expect(audit.conversations).toEqual(expect.arrayContaining([expect.objectContaining({ id: chat.conversation.id, deleted_at: expect.any(String) })]));
    expect(audit.feedback.map((item) => item.id)).toContain(firstFeedbackId);
    expect(audit.tickets.map((item) => item.id)).toContain(ticketId);
    const dashboardResponse = await page.request.get("/api/dashboard", { failOnStatusCode: false });
    expect(dashboardResponse.ok(), await dashboardResponse.text()).toBeTruthy();
    const dashboard = (await dashboardResponse.json()).dashboard as { totals: { messages: number } };
    expect(dashboard.totals.messages).toBeGreaterThanOrEqual(chat.messages.length);
  });

  test("连续登录失败触发账号锁定和安全事件", async ({ page }) => {
    const marker = `LOCK-${Date.now()}`;
    const employee = await createTestEmployee(page, marker);
    await page.request.post("/api/auth/logout");
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await page.request.post("/api/auth/login", {
        data: { email: employee.email, password: `wrong-${attempt}` },
        failOnStatusCode: false
      });
      expect(response.status()).toBe(401);
    }
    const blocked = await page.request.post("/api/auth/login", {
      data: { email: employee.email, password: "wrong-final" },
      failOnStatusCode: false
    });
    expect(blocked.status()).toBe(429);
    const correctWhileBlocked = await page.request.post("/api/auth/login", {
      data: { email: employee.email, password: employee.password },
      failOnStatusCode: false
    });
    expect(correctWhileBlocked.status()).toBe(429);

    await tryLogin(page);
    await expect.poll(async () => {
      const response = await page.request.get("/api/admin/insights");
      const insights = (await response.json()).insights;
      return insights.securityEvents.some((event: { metadata?: { detector?: string; email?: string } }) =>
        event.metadata?.detector === "login_failure_lockout" && event.metadata?.email === employee.email
      );
    }, { timeout: 30_000 }).toBeTruthy();
  });

  test("手机端管理菜单可以展开并访问完整导航", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await tryLogin(page);
    await gotoWithRetry(page, "/admin/insights");

    const menuButton = page.getByRole("button", { name: "导航菜单" });
    await expect(menuButton).toBeVisible();
    await menuButton.click();
    await expect(page.getByRole("navigation", { name: "移动端主导航" })).toBeVisible();
    await expect(page.getByRole("link", { name: "系统配置" })).toBeVisible();
    await expect(page.getByRole("link", { name: "业务集成" })).toBeVisible();
    await expect(page.getByRole("link", { name: "审计与工单" })).toHaveAttribute("aria-current", "page");
  });

  test("管理端知识管理可以加载", async ({ page }) => {
    await tryLogin(page);
    await gotoWithRetry(page, "/admin/documents");

    await expect(page.getByRole("heading", { name: "知识管理" })).toBeVisible();
    await expect(page.getByRole("button", { name: /资料管理/ })).toBeVisible();
    const knowledgeHeaderBox = await page.getByTestId("knowledge-header").boundingBox();
    expect(knowledgeHeaderBox?.height ?? 999).toBeLessThanOrEqual(90);
    await page.getByRole("button", { name: "知识库与权限" }).click();
    await expect(page.getByText("资料入库流程")).toBeVisible();
    await expect(page.getByText("权限配置")).toBeVisible();
    await page.getByRole("button", { name: /资料管理/ }).click();
    await expect(page.getByText(/新资料默认草稿/)).toBeVisible();
    await expect(page.getByText("资料版本记录")).toBeVisible();
    await expect(page.getByText("回滚").first()).toBeVisible();
    const versionRow = page.getByTestId("document-version-row").first();
    await expect(versionRow).toBeVisible();
    const note = versionRow.getByTestId("document-version-note");
    if (await note.count()) {
      const noteBox = await note.boundingBox();
      expect(noteBox?.width ?? 0).toBeGreaterThanOrEqual(220);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBeTruthy();
    await page.getByRole("button", { name: "质量与治理" }).click();
    const templateButton = page.getByRole("button", { name: /文档权限模板/ });
    await expect(templateButton).toBeVisible();
    await templateButton.click();
    await expect(page.getByText("模板名称")).toBeVisible();
  });

  test("用户权限页可以配置账号密级和资料审批人", async ({ page }) => {
    await tryLogin(page);
    await gotoWithRetry(page, "/admin/users");
    await expect(page.getByRole("heading", { name: "用户管理" })).toBeVisible();
    await expect(page.getByPlaceholder("搜索姓名、邮箱、部门或岗位")).toBeVisible();
    await expect(page.getByRole("button", { name: "新增用户" })).toBeVisible();
    const usersHeaderBox = await page.getByTestId("users-header").boundingBox();
    expect(usersHeaderBox?.height ?? 999).toBeLessThanOrEqual(80);
    await expect(page.getByRole("button", { name: "刷新" })).toBeEnabled();
    const reviewerTab = page.getByRole("tab", { name: /^审批授权 · \d+$/ });
    await reviewerTab.click();
    await expect(reviewerTab).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("heading", { name: "资料审批人授权" })).toBeVisible();
    await page.getByRole("button", { name: "新增审批授权" }).click();
    await expect(page.getByRole("button", { name: "添加授权" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBeTruthy();
  });

  test("会话反馈后台包含安全审计和工单入口", async ({ page }) => {
    test.setTimeout(120_000);

    await tryLogin(page);
    await gotoWithRetry(page, "/admin/insights");

    await expect(page.getByRole("heading", { name: "会话与反馈" })).toBeVisible();
    await expect(page.getByRole("button", { name: "人工工单" })).toBeVisible({ timeout: 30_000 });
    const securityTab = page.getByRole("button", { name: /^安全审计( · \d+)?$/ });
    await expect(securityTab).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("metrics-overview")).toBeVisible();
    await expect(page.locator('[data-testid^="primary-metric-"]')).toHaveCount(4);
    const insightsHeaderBox = await page.getByTestId("insights-header").boundingBox();
    const primaryMetricBox = await page.getByTestId("primary-metric-pending-work").boundingBox();
    expect(insightsHeaderBox?.height ?? 999).toBeLessThanOrEqual(80);
    expect(primaryMetricBox?.height ?? 999).toBeLessThanOrEqual(90);
    const metricsDetails = page.getByTestId("metrics-details");
    await expect(metricsDetails.getByText("查看全部指标")).toBeVisible();
    await metricsDetails.locator("summary").click();
    await expect(metricsDetails.getByText("运营告警")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBeTruthy();
    await expectEnabledWithReload(page, "/admin/insights", /刷新/);
    await securityTab.click();
    await expect(page.getByRole("heading", { name: "安全审计覆盖范围" })).toBeVisible({ timeout: 30_000 });
    await expect(page.locator("p").filter({ hasText: /^异常访问$/ }).first()).toBeVisible({ timeout: 30_000 });

    await gotoWithRetry(page, "/admin/insights?tab=qa");
    await expect(page.getByRole("button", { name: "QA 整改", exact: true })).toHaveClass(/bg-brand/, { timeout: 30_000 });
  });

  test("人工工单支持创建、分派、评论和员工查看", async ({ page }) => {
    const marker = `TICKET-E2E-${Date.now()}`;

    await tryLogin(page, "employee");
    const conversationResponse = await page.request.post("/api/conversations", {
      data: { title: `工单会话 ${marker}` }
    });
    expect(conversationResponse.ok(), await conversationResponse.text()).toBeTruthy();
    const conversationId = (await conversationResponse.json()).conversation.id as string;
    const createResponse = await page.request.post("/api/tickets", {
      data: {
        conversation_id: conversationId,
        title: `闭环工单 ${marker}`,
        description: `员工提交人工协助：${marker}`,
        priority: "urgent"
      }
    });
    expect(createResponse.ok(), await createResponse.text()).toBeTruthy();
    const created = await createResponse.json();
    expect(created.ticket).toEqual(
      expect.objectContaining({
        title: expect.stringContaining(marker),
        status: "pending",
        priority: "urgent",
        due_at: expect.any(String)
      })
    );

    const admin = await tryLogin(page);
    await expect.poll(async () => {
      const response = await getWithRetry(page, "/api/notifications?limit=200", 4);
      const result = await response.json();
      return result.notifications.find((notification: { source_id: string }) => notification.source_id === created.ticket.id);
    }, { timeout: 60_000, intervals: [500, 1000, 2000, 3000] }).toEqual(expect.objectContaining({
      category: "ticket",
      source_id: created.ticket.id,
      title: "收到新的人工工单",
      read_at: null
    }));
    const updateResponse = await page.request.patch(`/api/admin/tickets/${created.ticket.id}`, {
      data: {
        status: "processing",
        priority: "high",
        assignee_id: admin.id,
        resolution_note: `处理中 ${marker}`
      }
    });
    expect(updateResponse.ok(), await updateResponse.text()).toBeTruthy();
    const updated = await updateResponse.json();
    expect(updated.ticket).toEqual(
      expect.objectContaining({
        status: "processing",
        priority: "high",
        assignee_id: admin.id,
        resolution_note: expect.stringContaining(marker)
      })
    );

    const publicCommentResponse = await page.request.post(`/api/tickets/${created.ticket.id}/comments`, {
      data: {
        body: `公开处理记录 ${marker}`,
        is_internal: false
      }
    });
    expect(publicCommentResponse.ok(), await publicCommentResponse.text()).toBeTruthy();

    const internalCommentResponse = await page.request.post(`/api/tickets/${created.ticket.id}/comments`, {
      data: {
        body: `内部处理记录 ${marker}`,
        is_internal: true
      }
    });
    expect(internalCommentResponse.ok(), await internalCommentResponse.text()).toBeTruthy();

    await tryLogin(page, "employee");
    const commentsResponse = await page.request.get(`/api/tickets/${created.ticket.id}/comments`);
    expect(commentsResponse.ok(), await commentsResponse.text()).toBeTruthy();
    const comments = await commentsResponse.json();
    const visibleBodies = comments.comments.map((item: { body: string }) => item.body);
    expect(visibleBodies).toContain(`公开处理记录 ${marker}`);
    expect(visibleBodies).not.toContain(`内部处理记录 ${marker}`);

    const ownTicketsResponse = await page.request.get("/api/tickets");
    expect(ownTicketsResponse.ok(), await ownTicketsResponse.text()).toBeTruthy();
    const ownTickets = await ownTicketsResponse.json();
    expect(ownTickets.tickets.map((item: { id: string }) => item.id)).toContain(created.ticket.id);
    expect(ownTickets.commentsByTicket[created.ticket.id].map((item: { body: string }) => item.body)).toContain(`公开处理记录 ${marker}`);

    await tryLogin(page);
    const resolveResponse = await page.request.patch(`/api/admin/tickets/${created.ticket.id}`, {
      data: {
        status: "resolved",
        resolution_note: `已解决 ${marker}`
      }
    });
    expect(resolveResponse.ok(), await resolveResponse.text()).toBeTruthy();
    const resolved = await resolveResponse.json();
    expect(resolved.ticket).toEqual(
      expect.objectContaining({
        status: "resolved",
        resolved_at: expect.any(String)
      })
    );

    await tryLogin(page, "employee");
    const employeeNotificationsResponse = await getWithRetry(page, "/api/notifications?limit=100", 4);
    const employeeNotifications = await employeeNotificationsResponse.json();
    const resolvedNotification = employeeNotifications.notifications.find((item: { source_id: string; title: string }) =>
      item.source_id === created.ticket.id && item.title === "人工工单已处理完成"
    );
    expect(resolvedNotification).toBeTruthy();
    const readResponse = await page.request.patch(`/api/notifications/${resolvedNotification.id}`, {
      data: { read: true }
    });
    expect(readResponse.ok(), await readResponse.text()).toBeTruthy();
    expect((await readResponse.json()).notification.read_at).toEqual(expect.any(String));

    await tryLogin(page);
    await gotoWithRetry(page, "/notifications");
    await expectHeadingWithReload(page, "/notifications", "通知中心");
    await expect(page.getByRole("button", { name: "全部已读" })).toBeVisible();
    await expect(page.getByRole("button", { name: "工单" })).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoWithRetry(page, "/notifications");
    await expectHeadingWithReload(page, "/notifications", "通知中心");
    await expect(page.locator("body")).not.toHaveCSS("overflow-x", "scroll");
  });

  test("系统配置页包含数字人接口测试入口", async ({ page }) => {
    test.setTimeout(180_000);

    await tryLogin(page);
    const settingsResponse = await getWithRetry(page, "/api/system/settings", 5);
    const healthResponse = await getWithRetry(page, "/api/system/health", 5);
    const settingsBody = await settingsResponse.text();
    const healthBody = await healthResponse.text();
    await page.route(/\/api\/system\/settings(?:\?.*)?$/, (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: settingsBody
    }));
    await page.route(/\/api\/system\/health(?:\?.*)?$/, (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: healthBody
    }));
    await gotoWithRetry(page, "/admin/settings");
    await expect(page.getByRole("heading", { name: "系统配置" })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("tab", { name: "服务配置" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "运行检查" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "自定义对话模型" })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("button", { name: "测试模型" })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("备用 1 模型 ID", { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("服务商预设模板")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "选择一个配置类别" })).toHaveCount(0);

    await page.getByRole("button", { name: /OCR 扫描件识别/ }).click();
    await expect(page.getByRole("heading", { name: "OCR 扫描件识别" })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("button", { name: "测试 OCR" })).toBeVisible({ timeout: 30_000 });

    await page.getByRole("button", { name: /高级兼容设置/ }).click();
    await expect(page.getByRole("button", { name: /LDAP \/ AD 登录/ })).toBeEnabled({ timeout: 60_000 });
    await page.getByRole("button", { name: /LDAP \/ AD 登录/ }).click();
    await expect(page.getByText("用户 DN 模板", { exact: true })).toBeVisible({ timeout: 30_000 });

    await page.getByRole("button", { name: /自定义数据库/ }).click();
    await expect(page.getByText("登录会话密钥", { exact: true })).toBeVisible({ timeout: 30_000 });

    await page.getByRole("button", { name: /应用参数/ }).click();
    await expect(page.getByText("应用地址")).toBeVisible({ timeout: 30_000 });

    await page.getByRole("button", { name: /自定义对话模型/ }).click();
    await expect(page.getByText("备用 1 供应商", { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("备用 1 模型 ID", { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("备用 2 供应商", { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("备用 2 模型 ID", { exact: true })).toBeVisible({ timeout: 30_000 });

    await page.getByRole("button", { name: /自定义语音 TTS/ }).click();
    await expect(page.getByText("认证头名").first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("额外请求头 JSON").first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("请求体模板 JSON").first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("button", { name: "试听语音" })).toBeVisible({ timeout: 30_000 });

    await page.getByRole("button", { name: /数字人视频/ }).click();
    await expect(page.getByRole("heading", { name: "数字人视频" })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("button", { name: "测试数字人" })).toBeVisible({ timeout: 30_000 });

    await page.getByRole("tab", { name: "运行检查" }).click();
    await expect(page.getByTestId("settings-health")).toBeVisible({ timeout: 30_000 });

    await page.setViewportSize({ width: 390, height: 844 });
    await gotoWithRetry(page, "/admin/settings");
    await expect(page.getByRole("heading", { name: "系统配置" })).toBeVisible({ timeout: 30_000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBeTruthy();
    await page.locator("#settings-group-select").selectOption({ label: "OCR 扫描件识别" });
    await expect(page.getByRole("heading", { name: "OCR 扫描件识别" })).toBeVisible({ timeout: 30_000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBeTruthy();
  });

  test("Winmail 签名算法与 OpenAPI 1.2 文档一致", () => {
    const signed = signWinmailParams(
      { method: "login", user: "test", pass: "123456" },
      "ec880a9d4b",
      "aff54e78f6871aea3714a3916eb35199b7affb19",
      1455764753
    );
    expect(signed.sign).toBe("496c4156bc32ca11fe81899e1b6a242c");
  });

  test("业务集成页展示企业微信与 Winmail 安全配置", async ({ page }) => {
    await tryLogin(page);
    const response = await getWithRetry(page, "/api/admin/integrations", 5);
    const data = await response.json();
    expect(data.connectors.map((item: { provider: string }) => item.provider)).toEqual(expect.arrayContaining(["wecom", "winmail"]));
    expect(data.configs.wecom).not.toHaveProperty("corpSecret");
    expect(data.configs.winmail).not.toHaveProperty("apiSecret");
    expect(data.configs.winmail).not.toHaveProperty("senderPassword");

    await gotoWithRetry(page, "/admin/integrations");
    await expect(page.getByRole("heading", { name: "业务集成" })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("button", { name: "连接器" })).toBeVisible();
    const wecomPanel = page.locator("article").filter({ hasText: "企业微信通讯录与通知" });
    await expect(wecomPanel).toHaveCount(1);
    await wecomPanel.locator("summary").click();
    await expect(wecomPanel.getByText("CorpSecret", { exact: true })).toBeVisible();
    await expect(wecomPanel.getByText("启用应用消息通知", { exact: true })).toBeVisible();
    await expect(wecomPanel.getByRole("button", { name: "同步企业微信通讯录" })).toBeVisible();
    await expect(wecomPanel.getByRole("button", { name: "发送测试消息" })).toBeVisible();
    await expect(wecomPanel.getByLabel("测试接收账号")).toHaveValue("");
    await expect(wecomPanel.getByRole("button", { name: "发送测试消息" })).toBeDisabled();
    const winmailPanel = page.locator("article").filter({ hasText: "Winmail 邮件通知" });
    await expect(winmailPanel).toHaveCount(1);
    await winmailPanel.locator("summary").click();
    await expect(winmailPanel.getByText("ApiSecret", { exact: true })).toBeVisible();
    await expect(winmailPanel.getByRole("button", { name: "发送测试邮件" })).toBeVisible();
    await page.getByRole("button", { name: /通讯录·/ }).click();
    await expect(page.getByRole("button", { name: /待匹配/ })).toBeVisible();
    await expect(page.getByPlaceholder("搜索姓名、邮箱、部门或岗位")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBeTruthy();

    await page.setViewportSize({ width: 390, height: 844 });
    await gotoWithRetry(page, "/admin/integrations");
    await expect(page.getByRole("heading", { name: "业务集成" })).toBeVisible({ timeout: 30_000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBeTruthy();
  });

  test("Winmail 只读工具执行权限、未绑定提示和管理员审计闭环", async ({ page }) => {
    const employee = await tryLogin(page, "employee");
    const binding = await page.request.get("/api/integrations/winmail/binding");
    expect(binding.ok(), await binding.text()).toBeTruthy();
    expect((await binding.json()).binding).toEqual(expect.objectContaining({ bound: false, encryption_ready: true }));

    const invalid = await page.request.post("/api/tools/execute", {
      data: { tool_id: "winmail.search_inbox", params: { arbitrary_url: "http://example.com" } },
      failOnStatusCode: false
    });
    expect(invalid.status()).toBe(400);
    expect((await invalid.json()).code).toBe("INVALID_INPUT");

    const chat = await page.request.post("/api/chat", {
      data: { message: "我有多少封未读邮件？" },
      failOnStatusCode: false
    });
    expect(chat.ok(), await chat.text()).toBeTruthy();
    const chatData = await chat.json() as { messages: Array<{ role: string; metadata?: Record<string, unknown> }> };
    expect(chatData.messages.find((item) => item.role === "assistant")?.metadata).toEqual(expect.objectContaining({
      kind: "business_tool_error",
      tool_id: "winmail.unread_count",
      error_code: "MAILBOX_NOT_BOUND",
      action_required: "bind_winmail"
    }));

    await tryLogin(page);
    const dashboard = await getWithRetry(page, "/api/admin/integrations", 5);
    const dashboardData = await dashboard.json() as { tools: Array<{ id: string; status: string }>; tool_executions: Array<{ user_id: string; tool_id: string; status: string; input_summary: Record<string, unknown> }> };
    expect(dashboardData.tools).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "winmail.unread_count", status: "published" }),
      expect.objectContaining({ id: "winmail.search_inbox", status: "published" })
    ]));
    expect(dashboardData.tool_executions).toEqual(expect.arrayContaining([
      expect.objectContaining({ user_id: employee.id, tool_id: "winmail.unread_count", status: "failed", input_summary: expect.objectContaining({ scope: "self" }) })
    ]));

    await gotoWithRetry(page, "/admin/integrations");
    await page.getByRole("button", { name: /业务工具·/ }).click();
    await expect(page.getByRole("heading", { name: "已注册业务工具" })).toBeVisible();
    const registeredTools = page.getByRole("region", { name: "已注册业务工具" });
    await expect(registeredTools.getByText("查询本人未读邮件数量", { exact: true })).toBeVisible();
    await expect(page.getByText("最近调用审计")).toBeVisible();
  });

  test("问答测试后台暴露整改复测队列和趋势数据", async ({ page }) => {
    test.setTimeout(150_000);

    await tryLogin(page);
    const response = await getWithRetry(page, "/api/admin/qa-tests", 5);
    const data = await response.json();
    expect(data.remediationRetestTrend).toEqual(
      expect.objectContaining({
        task_count: expect.any(Number),
        retested_task_count: expect.any(Number),
        total_retests: expect.any(Number),
        resolved: expect.any(Number),
        processing: expect.any(Number),
        ignored: expect.any(Number),
        failed: expect.any(Number),
        latest: expect.any(Array),
        daily: expect.any(Array)
      })
    );
    expect(data.strategyTrend).toEqual(
      expect.objectContaining({
        event_count: expect.any(Number),
        window: expect.objectContaining({
          days: expect.any(Number),
          label: expect.any(String),
          total_event_count: expect.any(Number),
          event_count: expect.any(Number)
        }),
        current_strategy_id: expect.any(String),
        current_strategy_label: expect.any(String),
        strategy_count: expect.any(Number),
        anomaly_count: expect.any(Number),
        strategies: expect.any(Array),
        rows: expect.any(Array),
        by_knowledge_base: expect.any(Array),
        by_intent: expect.any(Array),
        by_department: expect.any(Array),
        by_position: expect.any(Array),
        anomalies: expect.any(Array),
        comparison: expect.objectContaining({
          mode: expect.stringMatching(/^(switch_detected|no_current_samples|no_previous_strategy)$/),
          notes: expect.any(Array)
        }),
        latest: expect.any(Array)
      })
    );
    for (const key of ["strategies", "rows", "by_knowledge_base", "by_intent", "by_department", "by_position"] as const) {
      const firstRow = data.strategyTrend[key]?.[0];
      if (firstRow) {
        expect(firstRow).toEqual(expect.objectContaining({ candidate_test_ids: expect.any(Array) }));
      }
    }
    if (data.strategyTrend.anomalies?.[0]) {
      expect(data.strategyTrend.anomalies[0]).toEqual(expect.objectContaining({ suggested_test_ids: expect.any(Array) }));
    }
    const windowResponse = await getWithRetry(page, "/api/admin/qa-tests?strategy_window_days=30", 5);
    const windowData = await windowResponse.json();
    expect(windowData.strategyTrend.window).toEqual(
      expect.objectContaining({
        days: 30,
        label: "近 30 天"
      })
    );
    expect(data.remediationTasksStatus).toEqual(expect.stringMatching(/^(ready|timeout)$/));

    await page.route(/\/api\/admin\/qa-tests(?:\?.*)?$/, (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(data)
    }));
    await gotoWithRetry(page, "/admin/qa-tests");
    await expect(page.getByRole("heading", { name: "问答测试" })).toBeVisible({ timeout: 30_000 });
    const qaHeaderBox = await page.getByTestId("qa-header").boundingBox();
    expect(qaHeaderBox?.height ?? 999).toBeLessThanOrEqual(90);
    await page.getByTestId("qa-metrics-details").locator("summary").click();
    await expect(page.getByText("质量均分")).toBeVisible();
    if (data.tests.some((item: { answer?: string | null }) => Boolean(item.answer))) {
      const expandAll = page.getByRole("button", { name: /展开全部 \d+ 条用例/ });
      if (await expandAll.count()) {
        await expandAll.click();
      }
      await expect(page.getByText("质量评分", { exact: true }).first()).toBeVisible({ timeout: 60_000 });
    }
    await page.getByRole("button", { name: "自动整改与复测" }).click();
    await expect(page.getByText("策略异常巡检").first()).toBeVisible({ timeout: 60_000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBeTruthy();

    const scheduleResponse = await getWithRetry(page, "/api/admin/knowledge-tasks/retest-schedule");
    const schedule = await scheduleResponse.json();
    expect(schedule.schedule).toEqual(
      expect.objectContaining({
        enabled: expect.any(Boolean),
        mode: expect.stringMatching(/^(open|pending|processing|all)$/),
        limit: expect.any(Number),
        interval_minutes: expect.any(Number)
      })
    );
    const anomalyScheduleResponse = await getWithRetry(page, "/api/admin/qa-tests/strategy-anomaly-schedule");
    const anomalySchedule = await anomalyScheduleResponse.json();
    expect(anomalySchedule.schedule).toEqual(
      expect.objectContaining({
        enabled: expect.any(Boolean),
        interval_minutes: expect.any(Number),
        window_days: expect.any(Number),
        limit: expect.any(Number),
        run_count: expect.any(Number)
      })
    );
  });

  test("试运行验收页按检查与建议分区展示", async ({ page }) => {
    await tryLogin(page);
    await gotoWithRetry(page, "/admin/pilot");

    await expect(page.getByRole("heading", { name: "试运行验收" })).toBeVisible({ timeout: 30_000 });
    const pilotHeaderBox = await page.getByTestId("pilot-header").boundingBox();
    expect(pilotHeaderBox?.height ?? 999).toBeLessThanOrEqual(100);
    await expect(page.getByRole("button", { name: "验收检查" })).toBeVisible();
    await page.getByRole("button", { name: "解析与试运行建议" }).click();
    await expect(page.getByRole("heading", { name: "解析覆盖" })).toBeVisible();
    await page.getByTestId("pilot-metrics-details").locator("summary").click();
    await expect(page.getByText("可用资料")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBeTruthy();
  });

  test("生产部署检查覆盖完整方案闭环", async ({ page }) => {
    test.setTimeout(120_000);

    await tryLogin(page);
    await gotoWithRetry(page, "/admin/deploy");

    await expect(page.getByRole("heading", { name: "部署检查" })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("ACTIVE MODE", { exact: true })).toHaveCount(0);
    await expect(page.getByText("SECURE SESSION", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "退出登录" })).toBeVisible();
    const allTab = page.getByRole("tab", { name: /全部/ });
    await expect(allTab).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("tab", { name: /待处理/ })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("tab", { name: /已就绪/ })).toBeVisible({ timeout: 30_000 });
    const moreActions = page.getByRole("button", { name: "更多操作" });
    await expect(moreActions).toBeVisible({ timeout: 30_000 });
    await moreActions.click();
    await expect(page.getByRole("link", { name: "上线报告" })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("link", { name: "指标 CSV" })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("link", { name: "运维手册" })).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: "更多操作" }).click();

    await expect(page.getByRole("heading", { name: "检查项" })).toBeVisible({ timeout: 30_000 });
    await allTab.click();
    await expect(allTab).toHaveAttribute("aria-selected", "true");
    const environmentGroup = page.getByRole("button", { name: /环境变量/ });
    await expect(environmentGroup).toBeVisible({ timeout: 30_000 });
    await expect(environmentGroup).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByText("登录会话密钥", { exact: true })).toBeVisible({ timeout: 30_000 });
    const attentionTab = page.getByRole("tab", { name: /待处理/ });
    await attentionTab.click();
    await expect(attentionTab).toHaveAttribute("aria-selected", "true");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBeTruthy();

    await page.setViewportSize({ width: 390, height: 844 });
    await gotoWithRetry(page, "/admin/deploy");
    await expect(page.getByRole("heading", { name: "部署检查" })).toBeVisible({ timeout: 30_000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBeTruthy();

    const readinessResponse = await getWithRetry(page, "/api/admin/deploy-readiness");
    const readiness = await readinessResponse.json();
    expect(readiness.readiness.integrationChecklist.map((item: { name: string }) => item.name)).toEqual(
      expect.arrayContaining(["OCR 联调", "TTS 联调", "数字人联调", "统一身份联调", "CI/CD 联调"])
    );
    expect(readiness.readiness.runtime).toEqual(
      expect.objectContaining({
        hasAuthSecret: expect.any(Boolean),
        isLocalhostAppBaseUrl: expect.any(Boolean)
      })
    );
    expect(readiness.readiness.launchMetrics).toEqual(
      expect.objectContaining({
        openSecurityEvents: expect.any(Number),
        openServiceTickets: expect.any(Number),
        overdueServiceTickets: expect.any(Number),
        trainingLearners: expect.any(Number),
        completedTrainingLearners: expect.any(Number)
      })
    );
    expect(readiness.readiness.checks.map((item: { id: string }) => item.id)).toEqual(
      expect.arrayContaining(["auth-secret", "app-base-url", "identity-callback", "provider-test-entrypoints", "training-learning-flow", "restore-verification"])
    );

    const csvResponse = await getWithRetry(page, "/api/admin/deploy-readiness/export?format=csv");
    const csvText = await csvResponse.text();
    expect(csvText).toContain("第三方联调项");
    expect(csvText).toContain("待处理工单");
    expect(csvText).toContain("超时工单");
  });

  test("运维后台展示备份和恢复验证记录", async ({ page }) => {
    await tryLogin(page);
    const backupResponse = await getWithRetry(page, "/api/admin/backups");
    const backupData = await backupResponse.json();
    expect(backupData.overview).toEqual(expect.objectContaining({
      keep_days: expect.any(Number),
      schedule: expect.objectContaining({ configured: expect.any(Boolean) }),
      backups: expect.any(Array),
      jobs: expect.any(Array)
    }));
    const monitorResponse = await getWithRetry(page, "/api/admin/runtime-monitor");
    const monitorData = await monitorResponse.json();
    expect(monitorData.overview).toEqual(expect.objectContaining({
      thresholds: expect.objectContaining({
        failure_count: expect.any(Number),
        latency_ms: expect.any(Number),
        disk_warning_percent: expect.any(Number)
      }),
      checks: expect.any(Array),
      samples: expect.any(Array),
      alerts: expect.any(Array)
    }));

    await gotoWithRetry(page, "/admin/operations");
    await expect(page.getByRole("heading", { name: "运维与备份" })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("heading", { name: "运行监控" })).toBeVisible();
    await expect(page.getByRole("button", { name: "立即检查" })).toBeVisible();
    await expect(page.getByRole("button", { name: "立即备份" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "备份记录" })).toBeVisible();
  });

  test("试运行运营看板支持筛选、指标展示和 CSV 导出", async ({ page }) => {
    test.setTimeout(180_000);
    await tryLogin(page);

    const response = await getWithRetry(page, "/api/admin/operations-dashboard?days=30", 5);
    const data = await response.json();
    expect(data.report).toEqual(expect.objectContaining({
      generated_at: expect.any(String),
      data_status: expect.objectContaining({
        source: expect.stringMatching(/^(live|snapshot)$/),
        updated_at: expect.any(String)
      }),
      filters: expect.objectContaining({ days: 30, from_date: expect.any(String), to_date: expect.any(String) }),
      options: expect.objectContaining({ departments: expect.any(Array), positions: expect.any(Array) }),
      summary: expect.objectContaining({
        active_employees: expect.objectContaining({ value: expect.any(Number), eligible: expect.any(Number), rate: expect.any(Number) }),
        questions: expect.objectContaining({ value: expect.any(Number), conversations: expect.any(Number) }),
        satisfaction: expect.objectContaining({ positive: expect.any(Number), rated: expect.any(Number), rate: expect.any(Number) }),
        no_citation: expect.objectContaining({ value: expect.any(Number), answers: expect.any(Number), rate: expect.any(Number) }),
        qa: expect.objectContaining({ passed: expect.any(Number), tested: expect.any(Number), rate: expect.any(Number) }),
        knowledge_gaps: expect.objectContaining({ value: expect.any(Number), open: expect.any(Number) }),
        remediation: expect.objectContaining({ completed: expect.any(Number), total: expect.any(Number), rate: expect.any(Number) }),
        approvals: expect.objectContaining({ reviewed: expect.any(Number), pending_backlog: expect.any(Number) }),
        training: expect.objectContaining({ participation_rate: expect.any(Number), completion_rate: expect.any(Number), quiz_pass_rate: expect.any(Number) }),
        tickets: expect.objectContaining({ value: expect.any(Number), responded: expect.any(Number), close_rate: expect.any(Number) })
      }),
      daily: expect.any(Array),
      departments: expect.any(Array),
      definitions: expect.any(Array)
    }));
    expect(data.report.daily).toHaveLength(30);

    const department = data.report.options.departments[0] as string | undefined;
    const position = data.report.options.positions[0] as string | undefined;
    const params = new URLSearchParams({ days: "7" });
    if (department) params.set("department", department);
    if (position) params.set("position", position);
    const filteredResponse = await getWithRetry(page, `/api/admin/operations-dashboard?${params.toString()}`, 5);
    const filtered = await filteredResponse.json();
    expect(filtered.report.filters).toEqual(expect.objectContaining({
      days: 7,
      department: department ?? "",
      position: position ?? ""
    }));
    expect(filtered.report.daily).toHaveLength(7);

    const csvResponse = await getWithRetry(page, `/api/admin/operations-dashboard/export?${params.toString()}`, 5);
    expect(csvResponse.headers()["content-type"]).toContain("text/csv");
    const csv = await csvResponse.text();
    expect(csv).toContain("活跃员工");
    expect(csv).toContain("平均审批耗时");
    expect(csv).toContain("测验通过率");
    expect(csv).toContain("平均响应时间");

    await gotoWithRetry(page, "/admin/analytics");
    await expect(page.getByRole("heading", { name: "试运行运营看板" })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole("link", { name: "导出 CSV" })).toBeVisible();
    await expect(page.getByText("员工使用与问答")).toBeVisible();
    await expect(page.getByText("质量与知识治理")).toBeVisible();
    await expect(page.getByText("流程效率")).toBeVisible();
    await expect(page.getByRole("heading", { name: "问答趋势" })).toBeVisible();
    if (process.env.PLAYWRIGHT_SCREENSHOTS === "1") {
      await page.screenshot({ path: "test-results/operations-dashboard-desktop.png", fullPage: true });
    }

    await page.setViewportSize({ width: 390, height: 844 });
    await gotoWithRetry(page, "/admin/analytics");
    await expect(page.getByRole("heading", { name: "试运行运营看板" })).toBeVisible({ timeout: 60_000 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    if (process.env.PLAYWRIGHT_SCREENSHOTS === "1") {
      await page.screenshot({ path: "test-results/operations-dashboard-mobile.png", fullPage: true });
    }
  });

  test("配置和运营 API 暴露上线验收关键状态", async ({ page }) => {
    await tryLogin(page);

    const healthResponse = await page.request.get("/api/system/health");
    expect(healthResponse.ok()).toBeTruthy();
    const health = await healthResponse.json();
    expect(health.health.checks.map((item: { id: string }) => item.id)).toEqual(
      expect.arrayContaining(["mysql-connection", "sso-provider", "ldap-provider", "ocr-provider", "tts-voice", "digital-human-provider"])
    );

    const ssoResponse = await page.request.get("/api/auth/sso/status");
    expect(ssoResponse.ok()).toBeTruthy();
    const sso = await ssoResponse.json();
    expect(sso).toEqual(expect.objectContaining({
      enabled: expect.any(Boolean),
      oidcEnabled: expect.any(Boolean),
      wecomEnabled: expect.any(Boolean),
      provider: expect.any(String)
    }));

    const insightsResponse = await page.request.get("/api/admin/insights");
    expect(insightsResponse.ok()).toBeTruthy();
    const insights = await insightsResponse.json();
    expect(insights.insights.totals).toEqual(
      expect.objectContaining({
        tickets: expect.any(Number),
        pendingTickets: expect.any(Number),
        securityEvents: expect.any(Number),
        openSecurityEvents: expect.any(Number),
        highRiskSecurityEvents: expect.any(Number),
        criticalSecurityEvents: expect.any(Number),
        operationAlerts: expect.any(Number)
      })
    );
    expect(insights.insights.operationAlerts).toEqual(expect.any(Array));
    if (insights.insights.operationAlerts[0]) {
      expect(insights.insights.operationAlerts[0]).toEqual(
        expect.objectContaining({
          category: expect.stringMatching(/^(qa_strategy_anomaly|qa_strategy_anomaly_error)$/),
          severity: expect.stringMatching(/^(info|warning|critical)$/),
          title: expect.any(String),
          detail: expect.any(String),
          action_label: expect.any(String),
          href: expect.any(String),
          metrics: expect.any(Array)
        })
      );
    }
  });

  test("资料审批、批量权限和跨部门密级 ACL 形成闭环", async ({ page }) => {
    test.setTimeout(600_000);
    const marker = `ACL-${Date.now()}`;
    const password = process.env.E2E_TEST_PASSWORD || "local-e2e-password";

    await tryLogin(page);
    const kbResponse = await page.request.get("/api/knowledge-bases");
    expect(kbResponse.ok(), await kbResponse.text()).toBeTruthy();
    const knowledgeBases = (await kbResponse.json()).knowledgeBases as Array<{ id: string }>;
    expect(knowledgeBases.length).toBeGreaterThan(0);
    const knowledgeBaseId = knowledgeBases[0].id;

    async function createAccount(input: {
      suffix: string;
      name: string;
      department: string;
      position: string;
      security_clearance: "public" | "internal" | "confidential" | "restricted";
    }) {
      const email = `${input.suffix}.${marker.toLowerCase()}@tianrui.local`;
      let lastError = "";
      for (let attempt = 1; attempt <= 4; attempt += 1) {
        const response = await page.request.post("/api/users", {
          data: { ...input, email, password, role: "employee" },
          failOnStatusCode: false,
          timeout: 30_000
        });
        if (response.ok()) {
          return { ...(await response.json()).user as { id: string }, email };
        }
        lastError = await response.text();
        const usersResponse = await getWithRetry(page, "/api/users", 3);
        const users = (await usersResponse.json()).users as Array<{ id: string; email: string }>;
        const existing = users.find((user) => user.email.toLowerCase() === email.toLowerCase());
        if (existing) return { ...existing, email };
        await page.waitForTimeout(750 * attempt);
      }
      expect(false, lastError).toBeTruthy();
      throw new Error(lastError);
    }

    const reviewer = await createAccount({ suffix: "reviewer", name: `审批员 ${marker}`, department: "生产部", position: "质量工程师", security_clearance: "confidential" });
    const productionEmployee = await createAccount({ suffix: "production", name: `生产员工 ${marker}`, department: "生产部", position: "操作员", security_clearance: "internal" });
    const crossPositionEmployee = await createAccount({ suffix: "position", name: `跨部门岗位 ${marker}`, department: "财务部", position: "操作员", security_clearance: "internal" });
    const deniedDepartmentEmployee = await createAccount({ suffix: "finance", name: `财务员工 ${marker}`, department: "财务部", position: "会计", security_clearance: "internal" });
    const deniedClearanceEmployee = await createAccount({ suffix: "public", name: `低密级员工 ${marker}`, department: "生产部", position: "操作员", security_clearance: "public" });

    const assignmentResponse = await page.request.post("/api/admin/document-reviewers", {
      data: {
        user_id: reviewer.id,
        reviewer_type: "quality_reviewer",
        knowledge_base_ids: [knowledgeBaseId],
        departments: ["生产部"],
        security_levels: ["internal", "confidential"],
        can_review: true,
        can_publish: true
      }
    });
    expect(assignmentResponse.ok(), await assignmentResponse.text()).toBeTruthy();

    const uploadResponse = await page.request.post("/api/documents/upload", {
      multipart: {
        knowledge_base_id: knowledgeBaseId,
        department: "生产部",
        title: `审批验收资料 ${marker}`,
        change_note: `Playwright 审批验收 ${marker}`,
        file: {
          name: `${marker}.txt`,
          mimeType: "text/plain",
          buffer: Buffer.from(`审批权限验收标记 ${marker}。仅授权员工可检索。`, "utf8")
        }
      }
    });
    expect(uploadResponse.ok(), await uploadResponse.text()).toBeTruthy();
    const documentId = (await uploadResponse.json()).document.id as string;

    let documentStatus = "";
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const documentsResponse = await getWithRetry(page, "/api/documents", 4);
      const document = (await documentsResponse.json()).documents.find((item: { id: string }) => item.id === documentId);
      documentStatus = document?.status ?? "";
      if (documentStatus === "ready") break;
      await page.waitForTimeout(1000);
    }
    expect(documentStatus).toBe("ready");

    async function getReadyVersions() {
      const response = await getWithRetry(page, "/api/document-approvals", 4);
      const payload = await response.json();
      return (payload.versions as Array<{ id: string; document_id: string; version: number; status: string }>)
        .filter((version) => version.document_id === documentId && version.status === "ready")
        .sort((a, b) => b.version - a.version);
    }

    const initialVersion = (await getReadyVersions())[0];
    expect(initialVersion).toBeTruthy();

    const aclResponse = await page.request.patch(`/api/documents/${documentId}`, {
      data: {
        security_level: "internal",
        acl_departments: ["生产部"],
        acl_positions: ["操作员"],
        acl_roles: [],
        acl_users: []
      }
    });
    expect(aclResponse.ok(), await aclResponse.text()).toBeTruthy();

    const submitResponse = await page.request.post("/api/document-approvals", {
      data: { action: "submit_review", document_ids: [documentId], version_id: initialVersion.id, comment: `提交 ${marker}` }
    });
    expect(submitResponse.ok(), await submitResponse.text()).toBeTruthy();

    const pendingPreviewResponse = await page.request.get(`/api/documents/${documentId}/preview`);
    expect(pendingPreviewResponse.ok(), await pendingPreviewResponse.text()).toBeTruthy();
    const pendingChunk = (await pendingPreviewResponse.json()).chunks[0] as { id: string; content: string };
    const pendingEditResponse = await page.request.patch(`/api/documents/${documentId}/chunks/${pendingChunk.id}`, {
      data: { content: `${pendingChunk.content}\n审核期间不应写入 ${marker}` },
      failOnStatusCode: false
    });
    expect(pendingEditResponse.status()).toBe(400);
    expect((await pendingEditResponse.json()).error).toContain("不能修改正文");
    const pendingReprocessResponse = await page.request.post(`/api/documents/${documentId}/reprocess`, {
      failOnStatusCode: false
    });
    expect(pendingReprocessResponse.status()).toBe(400);
    expect((await pendingReprocessResponse.json()).error).toContain("不能修改正文");

    await loginWithCredentials(page, productionEmployee.email, password);
    const draftContextResponse = await getWithRetry(page, "/api/chat/context", 4);
    expect(draftContextResponse.ok()).toBeTruthy();
    expect((await draftContextResponse.json()).accessible_documents.map((item: { id: string }) => item.id)).not.toContain(documentId);

    await loginWithCredentials(page, deniedDepartmentEmployee.email, password);
    const deniedBatch = await page.request.post("/api/document-approvals", {
      data: { action: "approve_review", document_ids: [documentId] },
      failOnStatusCode: false
    });
    expect(deniedBatch.status()).toBe(400);
    const deniedBatchBody = await deniedBatch.json();
    expect(deniedBatchBody.failure_count).toBe(1);
    expect(deniedBatchBody.errors[0].error).toContain("审核权限");

    await loginWithCredentials(page, reviewer.email, password);
    const rejectResponse = await page.request.post("/api/document-approvals", {
      data: { action: "reject_review", document_ids: [documentId], comment: `请补充修改 ${marker}` }
    });
    expect(rejectResponse.ok(), await rejectResponse.text()).toBeTruthy();
    expect((await rejectResponse.json()).results[0].document.publish_status).toBe("rejected");

    await tryLogin(page);
    const restoreResponse = await page.request.post("/api/document-approvals", {
      data: { action: "restore_draft", document_ids: [documentId], comment: `恢复修改 ${marker}` }
    });
    expect(restoreResponse.ok(), await restoreResponse.text()).toBeTruthy();

    const resubmitResponse = await page.request.post("/api/document-approvals", {
      data: { action: "submit_review", document_ids: [documentId], version_id: initialVersion.id, comment: `重新提交 ${marker}` }
    });
    expect(resubmitResponse.ok(), await resubmitResponse.text()).toBeTruthy();

    const withdrawResponse = await page.request.post("/api/document-approvals", {
      data: { action: "withdraw_review", document_ids: [documentId], comment: `撤回补充 ${marker}` }
    });
    expect(withdrawResponse.ok(), await withdrawResponse.text()).toBeTruthy();
    expect((await withdrawResponse.json()).results[0].document.publish_status).toBe("draft");

    const finalSubmitResponse = await page.request.post("/api/document-approvals", {
      data: { action: "submit_review", document_ids: [documentId], version_id: initialVersion.id, comment: `最终提交 ${marker}` }
    });
    expect(finalSubmitResponse.ok(), await finalSubmitResponse.text()).toBeTruthy();

    await loginWithCredentials(page, reviewer.email, password);
    const approveResponse = await page.request.post("/api/document-approvals", {
      data: { action: "approve_review", document_ids: [documentId], comment: `审核通过 ${marker}` }
    });
    expect(approveResponse.ok(), await approveResponse.text()).toBeTruthy();
    expect((await approveResponse.json()).results[0].document.publish_status).toBe("approved");

    await tryLogin(page);
    const approvedEditResponse = await page.request.patch(`/api/documents/${documentId}/chunks/${pendingChunk.id}`, {
      data: { content: `${pendingChunk.content}\n待发布阶段不应写入 ${marker}` },
      failOnStatusCode: false
    });
    expect(approvedEditResponse.status()).toBe(400);
    expect((await approvedEditResponse.json()).error).toContain("不能修改正文");
    await loginWithCredentials(page, reviewer.email, password);

    const firstDiffResponse = await page.request.get(`/api/documents/${documentId}/release-diff?version_id=${encodeURIComponent(initialVersion.id)}`);
    expect(firstDiffResponse.ok(), await firstDiffResponse.text()).toBeTruthy();
    const firstDiff = await firstDiffResponse.json();
    expect(firstDiff.published_version).toBeNull();
    expect(firstDiff.summary.added).toBeGreaterThan(0);

    const publishResponse = await page.request.post("/api/document-approvals", {
      data: { action: "publish", document_ids: [documentId], comment: `正式发布 ${marker}` }
    });
    expect(publishResponse.ok(), await publishResponse.text()).toBeTruthy();
    const firstPublish = (await publishResponse.json()).results[0].document;
    expect(firstPublish.publish_status).toBe("published");
    expect(firstPublish.published_version_id).toBe(initialVersion.id);
    expect(firstPublish.published_version).toBe(initialVersion.version);

    for (const account of [productionEmployee, crossPositionEmployee]) {
      await loginWithCredentials(page, account.email, password);
      const contextResponse = await getWithRetry(page, "/api/chat/context", 4);
      expect(contextResponse.ok(), await contextResponse.text()).toBeTruthy();
      expect((await contextResponse.json()).accessible_documents.map((item: { id: string }) => item.id)).toContain(documentId);
    }

    for (const account of [deniedDepartmentEmployee, deniedClearanceEmployee]) {
      await loginWithCredentials(page, account.email, password);
      const contextResponse = await getWithRetry(page, "/api/chat/context", 4);
      expect(contextResponse.ok(), await contextResponse.text()).toBeTruthy();
      expect((await contextResponse.json()).accessible_documents.map((item: { id: string }) => item.id)).not.toContain(documentId);
    }

    await loginWithCredentials(page, reviewer.email, password);
    const firstArchiveResponse = await page.request.post("/api/document-approvals", {
      data: { action: "archive", document_ids: [documentId], comment: `第一版归档 ${marker}` }
    });
    expect(firstArchiveResponse.ok(), await firstArchiveResponse.text()).toBeTruthy();
    expect((await firstArchiveResponse.json()).results[0].document.publish_status).toBe("archived");

    await loginWithCredentials(page, productionEmployee.email, password);
    const firstArchivedContextResponse = await getWithRetry(page, "/api/chat/context", 4);
    expect((await firstArchivedContextResponse.json()).accessible_documents.map((item: { id: string }) => item.id)).not.toContain(documentId);

    await tryLogin(page);
    const restoreForSecondRelease = await page.request.post("/api/document-approvals", {
      data: { action: "restore_draft", document_ids: [documentId], comment: `准备第二版 ${marker}` }
    });
    expect(restoreForSecondRelease.ok(), await restoreForSecondRelease.text()).toBeTruthy();

    const reprocessResponse = await page.request.post(`/api/documents/${documentId}/reprocess`);
    expect(reprocessResponse.status(), await reprocessResponse.text()).toBe(202);
    documentStatus = "";
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const documentsResponse = await getWithRetry(page, "/api/documents", 4);
      const document = (await documentsResponse.json()).documents.find((item: { id: string }) => item.id === documentId);
      documentStatus = document?.status ?? "";
      if (documentStatus === "ready") break;
      await page.waitForTimeout(1000);
    }
    expect(documentStatus).toBe("ready");
    const secondVersion = (await getReadyVersions()).find((version) => version.id !== initialVersion.id);
    expect(secondVersion).toBeTruthy();

    const secondSubmitResponse = await page.request.post("/api/document-approvals", {
      data: { action: "submit_review", document_ids: [documentId], version_id: secondVersion!.id, comment: `提交第二版 ${marker}` }
    });
    expect(secondSubmitResponse.ok(), await secondSubmitResponse.text()).toBeTruthy();
    await loginWithCredentials(page, reviewer.email, password);
    const secondApproveResponse = await page.request.post("/api/document-approvals", {
      data: { action: "approve_review", document_ids: [documentId], comment: `第二版审核通过 ${marker}` }
    });
    expect(secondApproveResponse.ok(), await secondApproveResponse.text()).toBeTruthy();
    const secondDiffResponse = await page.request.get(`/api/documents/${documentId}/release-diff?version_id=${encodeURIComponent(secondVersion!.id)}`);
    expect(secondDiffResponse.ok(), await secondDiffResponse.text()).toBeTruthy();
    const secondDiff = await secondDiffResponse.json();
    expect(secondDiff.published_version.id).toBe(initialVersion.id);
    expect(secondDiff.target_version.id).toBe(secondVersion!.id);

    const secondPublishResponse = await page.request.post("/api/document-approvals", {
      data: { action: "publish", document_ids: [documentId], comment: `发布第二版 ${marker}` }
    });
    expect(secondPublishResponse.ok(), await secondPublishResponse.text()).toBeTruthy();
    const secondPublishedDocument = (await secondPublishResponse.json()).results[0].document;
    expect(secondPublishedDocument.published_version_id).toBe(secondVersion!.id);
    expect(secondPublishedDocument.published_version).toBe(secondVersion!.version);

    await tryLogin(page);
    const rollbackRequestResponse = await page.request.patch(`/api/documents/${documentId}`, {
      data: {
        action: "rollback_version",
        version_id: initialVersion.id,
        comment: `第二版异常，申请回退 ${marker}`
      }
    });
    expect(rollbackRequestResponse.ok(), await rollbackRequestResponse.text()).toBeTruthy();
    const rollbackRequest = await rollbackRequestResponse.json();
    expect(rollbackRequest.document.publish_status).toBe("pending_review");
    expect(rollbackRequest.request.document_version_id).toBe(rollbackRequest.version.id);
    expect(rollbackRequest.version.version).toBeGreaterThan(secondVersion!.version);

    await loginWithCredentials(page, productionEmployee.email, password);
    const rollbackPendingContext = await getWithRetry(page, "/api/chat/context", 4);
    expect((await rollbackPendingContext.json()).accessible_documents.map((item: { id: string }) => item.id)).not.toContain(documentId);

    await loginWithCredentials(page, reviewer.email, password);
    const rollbackApproveResponse = await page.request.post("/api/document-approvals", {
      data: { action: "approve_review", document_ids: [documentId], comment: `同意回退 ${marker}` }
    });
    expect(rollbackApproveResponse.ok(), await rollbackApproveResponse.text()).toBeTruthy();
    const rollbackPublishResponse = await page.request.post("/api/document-approvals", {
      data: { action: "publish", document_ids: [documentId], comment: `正式回退发布 ${marker}` }
    });
    expect(rollbackPublishResponse.ok(), await rollbackPublishResponse.text()).toBeTruthy();
    const rollbackPublishedDocument = (await rollbackPublishResponse.json()).results[0].document;
    expect(rollbackPublishedDocument.publish_status).toBe("published");
    expect(rollbackPublishedDocument.published_version).toBe(rollbackRequest.version.version);

    await tryLogin(page);
    const publishedPreviewResponse = await page.request.get(`/api/documents/${documentId}/preview`);
    expect(publishedPreviewResponse.ok(), await publishedPreviewResponse.text()).toBeTruthy();
    const publishedChunk = (await publishedPreviewResponse.json()).chunks[0] as { id: string; content: string };
    const publishedEditResponse = await page.request.patch(`/api/documents/${documentId}/chunks/${publishedChunk.id}`, {
      data: {
        content: publishedChunk.content,
        summary: `发布后治理修改 ${marker}`
      }
    });
    expect(publishedEditResponse.ok(), await publishedEditResponse.text()).toBeTruthy();
    const publishedEdit = await publishedEditResponse.json();
    expect(publishedEdit.document.publish_status).toBe("draft");
    expect(publishedEdit.version.version).toBeGreaterThan(rollbackPublishedDocument.published_version);

    await loginWithCredentials(page, productionEmployee.email, password);
    const editingContextResponse = await getWithRetry(page, "/api/chat/context", 4);
    expect((await editingContextResponse.json()).accessible_documents.map((item: { id: string }) => item.id)).not.toContain(documentId);

    await tryLogin(page);
    const governanceSubmitResponse = await page.request.post("/api/document-approvals", {
      data: {
        action: "submit_review",
        document_ids: [documentId],
        version_id: publishedEdit.version.id,
        comment: `治理修改提交 ${marker}`
      }
    });
    expect(governanceSubmitResponse.ok(), await governanceSubmitResponse.text()).toBeTruthy();
    await loginWithCredentials(page, reviewer.email, password);
    const governanceApproveResponse = await page.request.post("/api/document-approvals", {
      data: { action: "approve_review", document_ids: [documentId], comment: `治理修改审核通过 ${marker}` }
    });
    expect(governanceApproveResponse.ok(), await governanceApproveResponse.text()).toBeTruthy();
    const governancePublishResponse = await page.request.post("/api/document-approvals", {
      data: { action: "publish", document_ids: [documentId], comment: `治理修改正式发布 ${marker}` }
    });
    expect(governancePublishResponse.ok(), await governancePublishResponse.text()).toBeTruthy();
    expect((await governancePublishResponse.json()).results[0].document.published_version_id).toBe(publishedEdit.version.id);

    const archiveResponse = await page.request.post("/api/document-approvals", {
      data: { action: "archive", document_ids: [documentId], comment: `验收归档 ${marker}` }
    });
    expect(archiveResponse.ok(), await archiveResponse.text()).toBeTruthy();
    expect((await archiveResponse.json()).results[0].document.publish_status).toBe("archived");

    await loginWithCredentials(page, productionEmployee.email, password);
    const archivedContextResponse = await getWithRetry(page, "/api/chat/context", 4);
    expect((await archivedContextResponse.json()).accessible_documents.map((item: { id: string }) => item.id)).not.toContain(documentId);

    await tryLogin(page);
    const workbenchResponse = await page.request.get("/api/document-approvals");
    expect(workbenchResponse.ok(), await workbenchResponse.text()).toBeTruthy();
    const workbench = await workbenchResponse.json();
    const actions = workbench.events.filter((event: { document_id: string }) => event.document_id === documentId).map((event: { action: string }) => event.action);
    expect(actions).toEqual(expect.arrayContaining([
      "acl_updated",
      "submitted",
      "rejected",
      "restored_to_draft",
      "withdrawn",
      "approved",
      "published",
      "content_edit_started",
      "release_rollback_requested",
      "archived"
    ]));
    const rollbackPublishEvent = workbench.events.find((event: { document_id: string; action: string; metadata?: Record<string, unknown> }) =>
      event.document_id === documentId && event.action === "published" && event.metadata?.release_kind === "rollback"
    );
    expect(rollbackPublishEvent).toBeTruthy();

    const securityResponse = await page.request.get(`/api/admin/security-events?detector=document_approval_acl&document_id=${encodeURIComponent(documentId)}`);
    expect(securityResponse.ok(), await securityResponse.text()).toBeTruthy();
    const securityEvents = (await securityResponse.json()).events as Array<{ metadata?: Record<string, unknown> }>;
    expect(securityEvents.some((event) => event.metadata?.detector === "document_approval_acl" && event.metadata?.document_id === documentId)).toBeTruthy();
  });

  test("资料审批工作台适配桌面和手机", async ({ page }) => {
    await tryLogin(page);
    await gotoWithRetry(page, "/approvals");
    await expectHeadingWithReload(page, "/approvals", "资料审批工作台");
    await expect(page.getByRole("button", { name: /待我处理/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /已发布/ })).toBeVisible();

    await page.setViewportSize({ width: 390, height: 844 });
    await gotoWithRetry(page, "/approvals");
    await expectHeadingWithReload(page, "/approvals", "资料审批工作台");
    await expect(page.getByRole("button", { name: "导航菜单" })).toBeVisible();
    await expect(page.locator("body")).not.toHaveCSS("overflow-x", "scroll");
  });

  test("培训课程列表可以展示学习入口", async ({ page }) => {
    test.setTimeout(240_000);

    await tryLogin(page);
    await gotoWithRetry(page, "/admin/training");

    await expect(page.getByRole("heading", { name: "课程管理" })).toBeVisible();
    await expectHeadingWithReload(page, "/admin/training", "培训任务");
    await expect(page.getByText("管理课程发布、视频生成和归档删除。")).toBeVisible();

    await tryLogin(page, "employee");
    await gotoWithRetry(page, "/training");

    await expectHeadingWithReload(page, "/training", "培训讲解");
    await expect(page.getByText(/查看已生成的 PPT 逐页讲稿/)).toBeVisible();
  });

  test("培训管理支持课程资料、部门筛选与导出", async ({ page }) => {
    test.setTimeout(240_000);
    await tryLogin(page);
    await gotoWithRetry(page, "/admin/training");

    const trainingHeaderBox = await page.getByTestId("training-header").boundingBox();
    expect(trainingHeaderBox?.height ?? 999).toBeLessThanOrEqual(90);
    await page.getByRole("button", { name: "考试与课程设置" }).click();
    await expect(page.getByRole("heading", { name: "课程资料与可见范围" })).toBeVisible();
    await expect(page.getByPlaceholder("课程简介").last()).toBeVisible();
    await expect(page.getByRole("heading", { name: "正式考试与完课证书" })).toBeVisible();
    await expect(page.getByRole("button", { name: "根据讲稿生成初稿" })).toBeVisible();
    await expect(page.getByRole("button", { name: "提醒未完课员工" })).toBeVisible();
    await page.getByRole("button", { name: "学习跟踪" }).click();
    await expect(page.getByRole("combobox", { name: "筛选部门" })).toBeVisible();
    await expect(page.getByRole("button", { name: "导出" })).toBeEnabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBeTruthy();
  });

  test("员工培训播放器提供倍速、续播和可信完课提示", async ({ page }) => {
    test.setTimeout(240_000);
    await tryLogin(page, "employee");
    const courses = await page.request.get("/api/training", { failOnStatusCode: false });
    expect(courses.ok(), await courses.text()).toBeTruthy();
    const payload = await courses.json() as { trainingJobs: Array<{ id: string }> };
    expect(payload.trainingJobs.length).toBeGreaterThan(0);

    await gotoWithRetry(page, `/training/${payload.trainingJobs[0].id}`);
    await expect(page.getByRole("combobox", { name: "播放速度" })).toBeVisible();
    await expect(page.getByText(/拖动或仅翻页不会直接完课/)).toBeVisible();

    const progress = await page.request.patch(`/api/training/${payload.trainingJobs[0].id}/progress`, {
      data: { current_page: 0, consumed_seconds_delta: 0, active_seconds_delta: 0, playback_position_seconds: 12 },
      failOnStatusCode: false
    });
    expect(progress.ok(), await progress.text()).toBeTruthy();
    const saved = (await progress.json()).progress as { completed_pages: number[]; playback_position_seconds: number };
    expect(saved.completed_pages).not.toContain(0);
    expect(saved.playback_position_seconds).toBe(12);

    const quiz = await page.request.get(`/api/training/${payload.trainingJobs[0].id}/quiz`, { failOnStatusCode: false });
    expect(quiz.ok(), await quiz.text()).toBeTruthy();
    const quizPayload = await quiz.json() as { settings: { pass_score: number; max_attempts: number; time_limit_minutes: number }; session: { question_snapshot: Array<Record<string, unknown>> } | null };
    expect(quizPayload.settings).toEqual(expect.objectContaining({ pass_score: expect.any(Number), max_attempts: expect.any(Number), time_limit_minutes: expect.any(Number) }));
    for (const question of quizPayload.session?.question_snapshot ?? []) {
      expect(question).not.toHaveProperty("correct_answers");
      expect(question).not.toHaveProperty("explanation");
    }
  });

  test("培训考试并发开始和提交保持幂等", async ({ page }) => {
    test.setTimeout(300_000);
    const marker = `QUIZ-${Date.now()}`;
    await tryLogin(page);
    const coursesResponse = await page.request.get("/api/training", { failOnStatusCode: false });
    expect(coursesResponse.ok(), await coursesResponse.text()).toBeTruthy();
    const courses = (await coursesResponse.json()).trainingJobs as Array<{ id: string; title: string }>;
    const course = courses.find((item) => item.title === "演示课程-车间安全与质量培训");
    expect(course).toBeTruthy();
    const originalQuizResponse = await page.request.get(`/api/admin/training-quiz/${course!.id}`, { failOnStatusCode: false });
    expect(originalQuizResponse.ok(), await originalQuizResponse.text()).toBeTruthy();
    const originalQuiz = await originalQuizResponse.json() as {
      job: {
        mandatory: boolean;
        due_at: string | null;
        quiz_enabled: boolean;
        quiz_pass_score: number;
        quiz_max_attempts: number;
        quiz_time_limit_minutes: number;
        certificate_enabled: boolean;
      };
      questions: Array<Record<string, unknown> & { status: "draft" | "published" }>;
    };

    const quizSetup = await page.request.put(`/api/admin/training-quiz/${course!.id}`, {
      data: {
        questions: [{
          type: "true_false",
          prompt: `${marker}：发现设备异常时应立即停止操作。`,
          options: ["正确", "错误"],
          correct_answers: ["正确"],
          explanation: "发现设备异常时应立即停止操作并通知相关人员。",
          score_weight: 1
        }],
        settings: {
          mandatory: true,
          due_at: null,
          quiz_enabled: true,
          quiz_pass_score: 60,
          quiz_max_attempts: 3,
          quiz_time_limit_minutes: 5,
          certificate_enabled: false
        },
        publish: true
      },
      failOnStatusCode: false
    });
    expect(quizSetup.ok(), await quizSetup.text()).toBeTruthy();
    const employee = await createTestEmployee(page, marker);

    try {
      await loginWithCredentials(page, employee.email, employee.password);
      let progressPercent = 0;
      let firstHeartbeat = true;
      for (let pageIndex = 0; pageIndex < 3; pageIndex += 1) {
        for (let heartbeat = 0; heartbeat < 8; heartbeat += 1) {
          if (!firstHeartbeat) await page.waitForTimeout(2_200);
          firstHeartbeat = false;
          const progressResponse = await page.request.patch(`/api/training/${course!.id}/progress`, {
            data: {
              current_page: pageIndex,
              consumed_seconds_delta: 30,
              active_seconds_delta: 15,
              playback_position_seconds: 0
            },
            failOnStatusCode: false
          });
          expect(progressResponse.ok(), await progressResponse.text()).toBeTruthy();
          const progress = (await progressResponse.json()).progress as { completed_pages: number[]; progress_percent: number };
          progressPercent = progress.progress_percent;
          if (progress.completed_pages.includes(pageIndex)) break;
        }
      }
      expect(progressPercent).toBe(100);

      const startResponses = await Promise.all([
        page.request.post(`/api/training/${course!.id}/quiz`, { data: { action: "start" }, failOnStatusCode: false }),
        page.request.post(`/api/training/${course!.id}/quiz`, { data: { action: "start" }, failOnStatusCode: false })
      ]);
      for (const response of startResponses) expect(response.ok(), await response.text()).toBeTruthy();
      const started = await Promise.all(startResponses.map((response) => response.json())) as Array<{
        session: { id: string; question_snapshot: Array<{ id: string; prompt: string }> };
      }>;
      expect(started[0].session.id).toBe(started[1].session.id);
      expect(started[0].session.question_snapshot).toHaveLength(1);
      const questionId = started[0].session.question_snapshot[0].id;
      const submission = {
        action: "submit",
        session_id: started[0].session.id,
        answers: { [questionId]: "正确" }
      };
      const submitResponses = await Promise.all([
        page.request.post(`/api/training/${course!.id}/quiz`, { data: submission, failOnStatusCode: false }),
        page.request.post(`/api/training/${course!.id}/quiz`, { data: submission, failOnStatusCode: false })
      ]);
      for (const response of submitResponses) expect(response.ok(), await response.text()).toBeTruthy();
      const submitted = await Promise.all(submitResponses.map((response) => response.json())) as Array<{
        attempt: { id: string; session_id: string; attempt_number: number; score: number };
      }>;
      expect(submitted[0].attempt.id).toBe(submitted[1].attempt.id);
      expect(submitted[0].attempt).toEqual(expect.objectContaining({
        session_id: started[0].session.id,
        attempt_number: 1,
        score: 100
      }));

      const quizState = await page.request.get(`/api/training/${course!.id}/quiz`, { failOnStatusCode: false });
      expect(quizState.ok(), await quizState.text()).toBeTruthy();
      const attempts = (await quizState.json()).attempts as Array<{ id: string }>;
      expect(attempts).toHaveLength(1);
      expect(attempts[0].id).toBe(submitted[0].attempt.id);
    } finally {
      await tryLogin(page);
      await page.request.put(`/api/admin/training-quiz/${course!.id}`, {
        data: {
          questions: originalQuiz.questions,
          settings: {
            mandatory: originalQuiz.job.mandatory,
            due_at: originalQuiz.job.due_at,
            quiz_enabled: originalQuiz.job.quiz_enabled,
            quiz_pass_score: originalQuiz.job.quiz_pass_score,
            quiz_max_attempts: originalQuiz.job.quiz_max_attempts,
            quiz_time_limit_minutes: originalQuiz.job.quiz_time_limit_minutes,
            certificate_enabled: originalQuiz.job.certificate_enabled
          },
          publish: originalQuiz.questions.length > 0 && originalQuiz.questions.every((question) => question.status === "published")
        },
        failOnStatusCode: false
      });
      await page.request.patch(`/api/users/${employee.id}`, {
        data: { name: `安全测试 ${marker}`, role: "employee", department: "生产部", position: "操作员", status: "disabled" },
        failOnStatusCode: false
      });
    }
  });
});
