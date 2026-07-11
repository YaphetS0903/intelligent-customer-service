import { getDeployReadiness } from "@/lib/deploy-readiness";
import { getAdminInsights } from "@/lib/insights";
import { getPilotReadiness } from "@/lib/pilot-readiness";
import { listDocumentVersions } from "@/lib/db";

export async function generateLaunchMarkdownReport() {
  const [deploy, insights, documentVersions] = await Promise.all([
    getDeployReadiness(),
    getAdminInsights(),
    listDocumentVersions()
  ]);
  const qaPassed = Math.round(deploy.launchMetrics.qaRun * deploy.launchMetrics.qaPassRate / 100);
  const qaFailed = Math.max(deploy.launchMetrics.qaRun - qaPassed, 0);
  const qaNoCitation = Math.round(deploy.launchMetrics.qaRun * deploy.launchMetrics.qaNoCitationRate / 100);
  const generatedAt = new Date().toLocaleString("zh-CN");
  const conclusion = deploy.summary.error === 0 && deploy.summary.score >= 80
    ? "建议进入正式小范围上线。"
    : deploy.summary.score >= 60
      ? "建议完成红色/高风险项后进入受控试运行。"
      : "建议暂缓上线，优先补齐资料、QA 质量和运行配置。";
  const blockingChecks = deploy.checks.filter((check) => check.status === "error");
  const warningChecks = deploy.checks.filter((check) => check.status === "warning");

  return [
    "# 西安天瑞汽车内饰件有限公司智能客服上线汇报报告",
    "",
    `生成时间：${generatedAt}`,
    `部署自检得分：${deploy.summary.score}%`,
    `QA 通过率：${deploy.launchMetrics.qaPassRate}%`,
    `综合结论：${conclusion}`,
    "",
    "## 一、上线概览",
    "",
    "| 指标 | 数值 |",
    "| --- | ---: |",
    `| 部署检查项 | ${deploy.summary.total} |`,
    `| 已就绪 | ${deploy.summary.ready} |`,
    `| 待确认 | ${deploy.summary.warning} |`,
    `| 需处理 | ${deploy.summary.error} |`,
    `| 知识库 | ${deploy.launchMetrics.knowledgeBases} |`,
    `| 可用资料 | ${deploy.launchMetrics.readyDocuments} |`,
    `| 知识片段 | ${deploy.launchMetrics.chunks} |`,
    `| 资料版本 | ${documentVersions.length} |`,
    `| QA 测试总数 | ${deploy.launchMetrics.qaTests} |`,
    `| 已运行 QA | ${deploy.launchMetrics.qaRun} |`,
    `| QA 通过率 | ${deploy.launchMetrics.qaPassRate}% |`,
    `| QA 无引用率 | ${deploy.launchMetrics.qaNoCitationRate}% |`,
    `| 待处理反馈 | ${deploy.launchMetrics.openFeedback} |`,
    `| 待整改知识任务 | ${deploy.launchMetrics.openKnowledgeTasks} |`,
    `| 待处理工单 | ${deploy.launchMetrics.openServiceTickets} |`,
    `| 超时工单 | ${deploy.launchMetrics.overdueServiceTickets} |`,
    `| 待处理安全事件 | ${deploy.launchMetrics.openSecurityEvents} |`,
    `| 可用培训课程 | ${deploy.launchMetrics.readyTrainingJobs} |`,
    `| 培训学习记录 | ${deploy.launchMetrics.trainingLearners} |`,
    `| 培训完课记录 | ${deploy.launchMetrics.completedTrainingLearners} |`,
    "",
    "## 二、运行配置",
    "",
    "| 配置 | 当前值 |",
    "| --- | --- |",
    `| 运行模式 | ${escapeTable(deploy.runtime.nodeEnv)} |`,
    `| 访问地址 | ${escapeTable(deploy.runtime.appBaseUrl)} |`,
    `| 数据库 | ${escapeTable(deploy.runtime.databaseProvider)} |`,
    `| RAG 模式 | ${escapeTable(deploy.runtime.ragProvider)} |`,
    `| 对话模型供应商 | ${escapeTable(deploy.runtime.chatProvider)} |`,
    `| 语音供应商 | ${escapeTable(deploy.runtime.ttsProvider)} |`,
    `| 生产构建产物 | ${deploy.runtime.hasBuildOutput ? "已检测到" : "未检测到"} |`,
    `| 登录会话密钥 | ${deploy.runtime.hasAuthSecret ? "已配置" : "未配置"} |`,
    `| 本机访问地址 | ${deploy.runtime.isLocalhostAppBaseUrl ? "是" : "否"} |`,
    "",
    "## 三、第三方联调清单",
    "",
    "| 联调项 | 状态 | 当前情况 | 验收标准 |",
    "| --- | --- | --- | --- |",
    ...deploy.integrationChecklist.map((item) =>
      `| ${escapeTable(item.name)} | ${statusLabel(item.status)} | ${escapeTable(item.detail)} | ${escapeTable(item.acceptance)} |`
    ),
    "",
    "## 四、部署自检明细",
    "",
    "| 分组 | 检查项 | 状态 | 说明 |",
    "| --- | --- | --- | --- |",
    ...deploy.checks.map((check) =>
      `| ${deployGroupLabel(check.group)} | ${escapeTable(check.name)} | ${statusLabel(check.status)} | ${escapeTable(check.detail)} |`
    ),
    "",
    "## 五、资料与知识库",
    "",
    deploy.parserCoverage.length > 0
      ? [
          "| 解析来源 | 知识片段 |",
          "| --- | ---: |",
          ...deploy.parserCoverage.map((item) => `| ${escapeTable(item.label)} | ${item.chunks} |`)
        ].join("\n")
      : "暂无资料解析覆盖统计。",
    "",
    "### 最近资料版本",
    "",
    documentVersions.length > 0
      ? [
          "| 资料 | 版本 | 状态 | 说明 | 时间 |",
          "| --- | ---: | --- | --- | --- |",
          ...documentVersions.slice(0, 15).map((version) =>
            `| ${escapeTable(version.title)} | v${version.version} | ${version.status} | ${escapeTable(version.change_note ?? "")} | ${formatDate(version.created_at)} |`
          )
        ].join("\n")
      : "暂无资料版本记录。",
    "",
    "## 六、QA 与整改闭环",
    "",
    "| 指标 | 数值 |",
    "| --- | ---: |",
    `| QA 测试总数 | ${deploy.launchMetrics.qaTests} |`,
    `| 已运行 | ${deploy.launchMetrics.qaRun} |`,
    `| 通过 | ${qaPassed} |`,
    `| 不通过 | ${qaFailed} |`,
    `| 无引用回答 | ${qaNoCitation} |`,
    `| QA 整改任务 | ${insights.totals.qaRemediationTasks} |`,
    `| 待处理工作 | ${insights.totals.pendingWork} |`,
    `| 已处理工作 | ${insights.totals.resolvedWork} |`,
    "",
    insights.qaRemediationTasks.length > 0
      ? [
          "### 最近 QA 整改任务",
          "",
          "| 问题 | 状态 | 原因 | 建议 |",
          "| --- | --- | --- | --- |",
          ...insights.qaRemediationTasks.slice(0, 10).map((task) =>
            `| ${escapeTable(task.question)} | ${taskStatusLabel(task.status)} | ${escapeTable(task.reason)} | ${escapeTable(task.suggestion)} |`
          )
        ].join("\n")
      : "暂无 QA 整改任务。",
    "",
    "## 七、员工反馈与运营",
    "",
    "| 指标 | 数值 |",
    "| --- | ---: |",
    `| 会话数 | ${insights.totals.conversations} |`,
    `| 消息数 | ${insights.totals.messages} |`,
    `| 反馈数 | ${insights.totals.feedback} |`,
    `| 有帮助 | ${insights.totals.likes} |`,
    `| 需改进 | ${insights.totals.dislikes} |`,
    `| 无引用回答 | ${insights.totals.unreferencedAnswers} |`,
    `| 待补充知识线索 | ${insights.totals.knowledgeGaps} |`,
    "",
    "## 八、上线前重点动作",
    "",
    blockingChecks.length > 0
      ? [
          "### 必须处理",
          "",
          ...blockingChecks.map((check, index) => `${index + 1}. ${check.name}：${check.detail}`)
        ].join("\n")
      : "暂无必须处理项。",
    "",
    warningChecks.length > 0
      ? [
          "### 建议确认",
          "",
          ...warningChecks.slice(0, 10).map((check, index) => `${index + 1}. ${check.name}：${check.detail}`)
        ].join("\n")
      : "暂无待确认项。",
    "",
    "## 九、建议演示路径",
    "",
    "1. 管理员打开“知识管理”，展示员工培训手册和整改补充资料。",
    "2. 员工端提问一个安全/质量问题，展示回答、来源引用和反馈按钮。",
    "3. 管理员打开“问答测试”，展示 QA 指标和定向复测。",
    "4. 管理员打开“会话与反馈”，展示补充知识、保存并复测的闭环。",
    "5. 打开“生产部署检查”，展示模型、数据库、知识库和上线指标。",
    ""
  ].filter((line) => line !== undefined).join("\n");
}

export async function generateLaunchQaCsv() {
  const [pilot, deploy] = await Promise.all([
    getPilotReadiness(),
    getDeployReadiness()
  ]);
  const rows = [
    ["指标", "数值"],
    ["QA 测试总数", String(pilot.metrics.qaTests)],
    ["已运行 QA", String(pilot.metrics.qaRun)],
    ["通过", String(pilot.metrics.qaPassed)],
    ["不通过", String(pilot.metrics.qaFailed)],
    ["无引用回答", String(pilot.metrics.qaNoCitation)],
    ["QA 通过率", `${pilot.metrics.qaPassRate}%`],
    ["QA 无引用率", `${pilot.metrics.qaNoCitationRate}%`],
    ["知识库", String(pilot.metrics.knowledgeBases)],
    ["可用资料", String(pilot.metrics.readyDocuments)],
    ["知识片段", String(pilot.metrics.chunks)],
    ["待处理反馈", String(pilot.metrics.openFeedback)],
    ["可用培训课程", String(pilot.metrics.readyTrainingJobs)],
    ["待处理工单", String(deploy.launchMetrics.openServiceTickets)],
    ["超时工单", String(deploy.launchMetrics.overdueServiceTickets)],
    ["待处理安全事件", String(deploy.launchMetrics.openSecurityEvents)],
    ["培训学习记录", String(deploy.launchMetrics.trainingLearners)],
    ["培训完课记录", String(deploy.launchMetrics.completedTrainingLearners)],
    [],
    ["第三方联调项", "状态", "当前情况", "验收标准"],
    ...deploy.integrationChecklist.map((item) => [
      item.name,
      statusLabel(item.status),
      item.detail,
      item.acceptance
    ])
  ];

  return rows.map((row) => row.map(csvCell).join(",")).join("\n");
}

function deployGroupLabel(group: string) {
  const labels: Record<string, string> = {
    environment: "环境变量",
    database: "数据库",
    model: "模型服务",
    runtime: "运行环境",
    backup: "备份运维",
    pilot: "试运行"
  };

  return labels[group] ?? group;
}

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    ready: "已就绪",
    warning: "待确认",
    error: "需处理"
  };

  return labels[status] ?? status;
}

function taskStatusLabel(status: string) {
  const labels: Record<string, string> = {
    pending: "待处理",
    processing: "处理中",
    resolved: "已处理",
    ignored: "忽略"
  };

  return labels[status] ?? status;
}

function escapeTable(value: string) {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>");
}

function formatDate(value: string) {
  return new Date(value).toLocaleString("zh-CN");
}

function csvCell(value: string) {
  return `"${value.replace(/"/g, '""')}"`;
}
