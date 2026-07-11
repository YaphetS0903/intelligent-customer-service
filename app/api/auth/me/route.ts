import { NextResponse } from "next/server";
import { getCurrentUser, updateUserProfile } from "@/lib/db";
import { isMySqlDatabase } from "@/lib/config";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

export async function GET() {
  try {
    const user = await getCurrentUser();
    return NextResponse.json({ user });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "未登录" },
      { status: 401 }
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const user = await getCurrentUser();
    const body = await request.json();

    if (isMySqlDatabase()) {
      const updated = await updateUserProfile(user.id, {
        name: body.name ? String(body.name) : user.name,
        department: body.department ? String(body.department) : user.department
      });

      return NextResponse.json({ user: updated });
    }

    const supabase = createSupabaseAdminClient();

    if (!supabase) {
      return NextResponse.json({ user });
    }

    const updates = {
      name: body.name ? String(body.name) : user.name,
      department: body.department ? String(body.department) : user.department
    };

    const { data, error } = await supabase
      .from("users")
      .update(updates)
      .eq("id", user.id)
      .select("*")
      .single();

    if (error) {
      throw new Error(error.message);
    }

    return NextResponse.json({ user: data });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "更新失败" },
      { status: 400 }
    );
  }
}
