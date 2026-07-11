import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/db";
import { seedDemoData } from "@/lib/demo-seed";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const user = await requireAdmin();
    const result = await seedDemoData(user.id);

    return NextResponse.json({ result });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "整理演示数据失败" },
      { status: 400 }
    );
  }
}
