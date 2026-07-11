import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/db";
import {
  getQaStrategyAnomalySchedule,
  runQaStrategyAnomalyScheduleNow,
  updateQaStrategyAnomalySchedule
} from "@/lib/qa-strategy-anomaly-schedule";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireAdmin();
    const schedule = await getQaStrategyAnomalySchedule();

    return NextResponse.json({ schedule });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "读取策略异常巡检计划失败" },
      { status: 400 }
    );
  }
}

export async function PUT(request: Request) {
  try {
    const user = await requireAdmin();
    const body = await request.json().catch(() => ({}));
    const schedule = await updateQaStrategyAnomalySchedule(
      {
        enabled: typeof body.enabled === "boolean" ? body.enabled : undefined,
        interval_minutes: body.interval_minutes,
        window_days: body.window_days,
        limit: body.limit,
        next_run_at: body.next_run_at
      },
      user.id
    );

    return NextResponse.json({ schedule });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "保存策略异常巡检计划失败" },
      { status: 400 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireAdmin();
    const body = await request.json().catch(() => ({}));

    if (body.action && body.action !== "run_now") {
      return NextResponse.json({ error: "不支持的巡检操作" }, { status: 400 });
    }

    const result = await runQaStrategyAnomalyScheduleNow(user.id);

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "启动策略异常巡检失败" },
      { status: 400 }
    );
  }
}
