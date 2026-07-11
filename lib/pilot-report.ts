import { getAdminInsights } from "@/lib/insights";
import { getPilotReadiness, parserLabel } from "@/lib/pilot-readiness";
import { listDocumentVersions } from "@/lib/db";

export async function generatePilotMarkdownReport() {
  const [readiness, insights, documentVersions] = await Promise.all([
    getPilotReadiness(),
    getAdminInsights(),
    listDocumentVersions()
  ]);
  const generatedAt = new Date().toLocaleString("zh-CN");
  const recommendation = readiness.summary.score >= 80 && readiness.summary.error === 0
    ? "建议进入小范围试运行。"
    : readiness.summary.score >= 60
      ? "建议完成高优先级整改后再扩大试运行。"
      : "建议暂缓试运行，优先补齐资料、权限和 QA 验证。";

  return [
    "# 西安天瑞汽车内饰件有限公司智能客服试运行验收报告",
    "",
    `生成时间：${generatedAt}`,
    `验收得分：${readiness.summary.score}%`,
    `综合结论：${recommendation}`,
    "",
    "## 一、总体概览",
    "",
    "| 指标 | 数值 |",
    "| --- | ---: |",
    `| 检查项 | ${readiness.summary.total} |`,
    `| 已就绪 | ${readiness.summary.ready} |`,
    `| 待完善 | ${readiness.summary.warning} |`,
    `| 需处理 | ${readiness.summary.error} |`,
    `| 知识库 | ${readiness.metrics.knowledgeBases} |`,
    `| 可用资料 | ${readiness.metrics.readyDocuments} |`,
    `| 资料版本记录 | ${documentVersions.length} |`,
    `| 知识片段 | ${readiness.metrics.chunks} |`,
    `| 员工账号 | ${readiness.metrics.employeeUsers} |`,
    `| QA 测试问题 | ${readiness.metrics.qaTests} |`,
    `| 已运行 QA | ${readiness.metrics.qaRun} |`,
    `| QA 通过率 | ${readiness.metrics.qaPassRate}% |`,
    `| QA 无引用率 | ${readiness.metrics.qaNoCitationRate}% |`,
    `| 待处理反馈 | ${readiness.metrics.openFeedback} |`,
    `| QA 整改任务 | ${insights.totals.qaRemediationTasks} |`,
    "",
    "## 二、验收检查项",
    "",
    "| 分组 | 检查项 | 状态 | 说明 |",
    "| --- | --- | --- | --- |",
    ...readiness.checks.map((check) =>
      `| ${groupLabel(check.group)} | ${escapeTable(check.name)} | ${statusLabel(check.status)} | ${escapeTable(check.detail)} |`
    ),
    "",
    "## 三、资料版本与解析覆盖",
    "",
    readiness.parserCoverage.length > 0
      ? [
          "| 解析类型 | 知识片段 |",
          "| --- | ---: |",
          ...readiness.parserCoverage.map((item) => `| ${parserLabel(item.parser)} | ${item.chunks} |`)
        ].join("\n")
      : "暂无解析覆盖统计。",
    "",
    "### 最近资料版本",
    "",
    documentVersions.length > 0
      ? [
          "| 资料 | 版本 | 状态 | 说明 | 时间 |",
          "| --- | ---: | --- | --- | --- |",
          ...documentVersions.slice(0, 12).map((version) =>
            `| ${escapeTable(version.title)} | v${version.version} | ${version.status} | ${escapeTable(version.change_note ?? "")} | ${formatDate(version.created_at)} |`
          )
        ].join("\n")
      : "暂无资料版本记录。",
    "",
    "## 四、QA 与整改闭环",
    "",
    "| 指标 | 数值 |",
    "| --- | ---: |",
    `| QA 测试总数 | ${readiness.metrics.qaTests} |`,
    `| 已运行 | ${readiness.metrics.qaRun} |`,
    `| 通过 | ${readiness.metrics.qaPassed} |`,
    `| 不通过 | ${readiness.metrics.qaFailed} |`,
    `| 无引用回答 | ${readiness.metrics.qaNoCitation} |`,
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
          ...insights.qaRemediationTasks.slice(0, 8).map((task) =>
            `| ${escapeTable(task.question)} | ${taskStatusLabel(task.status)} | ${escapeTable(task.reason)} | ${escapeTable(task.suggestion)} |`
          )
        ].join("\n")
      : "暂无 QA 整改任务。",
    "",
    "## 五、反馈与会话运营",
    "",
    "| 指标 | 数值 |",
    "| --- | ---: |",
    `| 会话数 | ${insights.totals.conversations} |`,
    `| 消息数 | ${insights.totals.messages} |`,
    `| 反馈数 | ${insights.totals.feedback} |`,
    `| 有帮助 | ${insights.totals.likes} |`,
    `| 需改进 | ${insights.totals.dislikes} |`,
    `| 无引用回答 | ${insights.totals.unreferencedAnswers} |`,
    "",
    "## 六、建议动作",
    "",
    ...readiness.checks
      .filter((check) => check.status !== "ready")
      .slice(0, 8)
      .map((check, index) => `${index + 1}. ${check.name}：${check.detail}`),
    readiness.checks.every((check) => check.status === "ready")
      ? "当前检查项均已就绪，建议进入员工小范围试运行并持续观察反馈。"
      : "",
    ""
  ].filter((line) => line !== undefined).join("\n");
}

function groupLabel(group: string) {
  const labels: Record<string, string> = {
    knowledge: "知识资料",
    permission: "账号权限",
    qa: "问答质量",
    training: "培训讲解",
    operation: "运营闭环"
  };

  return labels[group] ?? group;
}

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    ready: "已就绪",
    warning: "待完善",
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
