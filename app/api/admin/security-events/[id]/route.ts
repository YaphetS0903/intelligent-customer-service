import { NextResponse } from "next/server";
import { requireAdmin, updateSecurityEvent } from "@/lib/db";
import type { WorkStatus } from "@/lib/types";

type RouteContext = {
  params: Promise<{ id: string }>;
};

function normalizeStatus(value: unknown): WorkStatus | undefined {
  if (value === "pending" || value === "processing" || value === "resolved" || value === "ignored") {
    return value;
  }

  return undefined;
}

export async function PATCH(request: Request, { params }: RouteContext) {
  try {
    await requireAdmin();
    const { id } = await params;
    const body = await request.json();
    const status = normalizeStatus(body.status);

    if (!status) {
      return NextResponse.json({ error: "状态参数不正确" }, { status: 400 });
    }

    const event = await updateSecurityEvent(id, { status });

    return NextResponse.json({ event });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "更新安全事件失败" },
      { status: 400 }
    );
  }
}
