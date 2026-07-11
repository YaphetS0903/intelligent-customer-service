import { NextResponse } from "next/server";
import { archiveConversation, deleteArchivedConversation, pinConversation, renameConversation } from "@/lib/db";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await request.json();
    const hasTitleInput = typeof body.title === "string";
    const hasPinnedInput = typeof body.pinned === "boolean";
    const hasArchivedInput = typeof body.archived === "boolean";
    const titleInput = hasTitleInput ? body.title.trim() : "";

    if (hasTitleInput && !titleInput) {
      return NextResponse.json({ error: "会话名称不能为空" }, { status: 400 });
    }

    const conversation = hasTitleInput
      ? await renameConversation(id, titleInput.slice(0, 80))
      : hasPinnedInput
        ? await pinConversation(id, body.pinned)
        : hasArchivedInput
          ? await archiveConversation(id, body.archived)
          : null;

    if (!conversation) {
      return NextResponse.json({ error: "会话不存在或无权操作" }, { status: 404 });
    }

    return NextResponse.json({ conversation });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "会话更新失败" },
      { status: 400 }
    );
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const deleted = await deleteArchivedConversation(id);

    if (!deleted) {
      return NextResponse.json({ error: "只能删除已归档的会话，或当前账号无权操作" }, { status: 400 });
    }

    return NextResponse.json({ deleted: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "会话删除失败" },
      { status: 400 }
    );
  }
}
