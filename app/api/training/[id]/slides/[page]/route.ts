import { readFile } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";
import { getCurrentUser, getTrainingJob } from "@/lib/db";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { canAccessTrainingJob } from "@/lib/training-access";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string; page: string }> }) {
  try {
    const user = await getCurrentUser();
    const { id, page } = await params;
    const pageIndex = Number(page) - 1;
    const job = await getTrainingJob(id);

    if (!job) {
      return NextResponse.json({ error: "培训任务不存在" }, { status: 404 });
    }

    if (!canAccessTrainingJob(user, job)) {
      return NextResponse.json({ error: "无权访问该课程" }, { status: 403 });
    }

    const slide = job.script_json[pageIndex];
    const imagePath = slide?.image_path;

    if (!slide || !imagePath) {
      return NextResponse.json({ error: "该页暂无课件图片" }, { status: 404 });
    }

    if (imagePath.startsWith("/")) {
      const publicDir = path.join(process.cwd(), "public");
      const filePath = path.normalize(path.join(publicDir, imagePath.replace(/^\/+/, "")));

      if (!filePath.startsWith(`${publicDir}${path.sep}`)) {
        return NextResponse.json({ error: "课件图片路径不合法" }, { status: 400 });
      }

      return pngResponse(await readFile(filePath), "private, max-age=3600");
    }

    const supabase = createSupabaseAdminClient();

    if (!supabase) {
      return NextResponse.json({ error: "文件存储未配置，无法读取课件图片" }, { status: 500 });
    }

    const { data, error } = await supabase.storage.from("documents").download(imagePath);

    if (error || !data) {
      return NextResponse.json({ error: error?.message ?? "课件图片不存在" }, { status: 404 });
    }

    return pngResponse(Buffer.from(await data.arrayBuffer()), "private, max-age=3600");
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "读取课件图片失败" },
      { status: 400 }
    );
  }
}

function pngResponse(image: Buffer, cacheControl: string) {
  const body = image.buffer.slice(image.byteOffset, image.byteOffset + image.byteLength) as ArrayBuffer;

  return new Response(body, {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": cacheControl
    }
  });
}
