import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/db";
import {
  deleteMysqlBackup,
  getMysqlBackupOverview,
  startMysqlBackupJob,
  type MysqlBackupJobAction
} from "@/lib/mysql-backup-operations";

export async function GET() {
  try {
    await requireAdmin();
    return NextResponse.json({ overview: await getMysqlBackupOverview() });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "读取备份状态失败" }, { status: 400 });
  }
}

export async function POST(request: Request) {
  try {
    await requireAdmin();
    const body = await request.json().catch(() => ({})) as { action?: unknown; file_name?: unknown };
    const action = String(body.action ?? "") as MysqlBackupJobAction;
    if (action !== "backup" && action !== "verify_restore") {
      return NextResponse.json({ error: "不支持的备份操作" }, { status: 400 });
    }
    const job = await startMysqlBackupJob(action, String(body.file_name ?? "").trim() || null);
    return NextResponse.json({ job }, { status: 202 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "启动备份任务失败" }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  try {
    await requireAdmin();
    const body = await request.json().catch(() => ({})) as { file_name?: unknown };
    const result = await deleteMysqlBackup(String(body.file_name ?? ""));
    return NextResponse.json({ deleted: result });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "删除备份失败" }, { status: 400 });
  }
}
