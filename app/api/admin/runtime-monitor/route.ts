import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/db";
import {
  getRuntimeMonitorOverview,
  resolveRuntimeAlert,
  runRuntimeMonitorNow
} from "@/lib/runtime-monitor";

export async function GET() {
  try {
    await requireAdmin();
    return NextResponse.json({ overview: await getRuntimeMonitorOverview() });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "读取运行监控失败" }, { status: 400 });
  }
}

export async function POST() {
  try {
    await requireAdmin();
    await runRuntimeMonitorNow();
    return NextResponse.json({ overview: await getRuntimeMonitorOverview() });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "执行运行监控失败" }, { status: 400 });
  }
}

export async function PATCH(request: Request) {
  try {
    await requireAdmin();
    const body = await request.json().catch(() => ({})) as { id?: unknown };
    await resolveRuntimeAlert(String(body.id ?? ""));
    return NextResponse.json({ overview: await getRuntimeMonitorOverview() });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "处理运行告警失败" }, { status: 400 });
  }
}
