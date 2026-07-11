import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import { updateTrainingJob } from "@/lib/db";
import { parsePptxBuffer } from "@/lib/pptx";
import { renderPptxSlideImages } from "@/lib/ppt-render";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { generateTrainingScripts } from "@/lib/training";
import { mergeTrainingListSnapshot } from "@/lib/training-list-cache";
import type { TrainingJob } from "@/lib/types";

const localStoragePrefix = "local:";

type StorageClient = {
  storage: {
    from(bucket: string): {
      download(storagePath: string): Promise<{ data: Blob | null; error: { message: string } | null }>;
      upload(
        storagePath: string,
        body: Buffer,
        options: { contentType: string; upsert: boolean }
      ): Promise<{ error: { message: string } | null }>;
    };
  };
};

declare global {
  // eslint-disable-next-line no-var
  var __trainingCourseBuildRunningJobs: Set<string> | undefined;
}

const runningJobs = globalThis.__trainingCourseBuildRunningJobs ?? new Set<string>();
globalThis.__trainingCourseBuildRunningJobs = runningJobs;

export async function storeTrainingSource(input: {
  fileName: string;
  fileBuffer: Buffer;
  contentType: string;
  supabase: StorageClient | null;
}) {
  const fileName = safeFileName(input.fileName);

  if (input.supabase) {
    const storagePath = `training/${Date.now()}-${crypto.randomUUID()}-${fileName}`;
    const { error } = await input.supabase.storage
      .from("documents")
      .upload(storagePath, input.fileBuffer, {
        contentType: input.contentType || "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        upsert: false
      });

    if (error) {
      throw new Error(error.message);
    }

    return storagePath;
  }

  const relativePath = path.join(".data", "training-sources", `${Date.now()}-${crypto.randomUUID()}-${fileName}`);
  const filePath = path.join(process.cwd(), relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, input.fileBuffer);

  return `${localStoragePrefix}${relativePath}`;
}

export function startTrainingCourseBuildJob(input: {
  trainingJob: TrainingJob;
  fileBuffer?: Buffer;
}) {
  if (runningJobs.has(input.trainingJob.id)) {
    return;
  }

  runningJobs.add(input.trainingJob.id);
  void runTrainingCourseBuildJob(input).finally(() => {
    runningJobs.delete(input.trainingJob.id);
  });
}

async function runTrainingCourseBuildJob({
  trainingJob,
  fileBuffer
}: {
  trainingJob: TrainingJob;
  fileBuffer?: Buffer;
}) {
  const supabase = createSupabaseAdminClient();

  try {
    await updateTrainingJobAndSnapshot(trainingJob.id, {
      status: "generating"
    });

    const pptxBuffer = fileBuffer ?? await readTrainingSource(trainingJob.ppt_storage_path, supabase);
    const slides = await parsePptxBuffer(pptxBuffer);

    if (slides.length === 0) {
      throw new Error("未能从 PPT 中解析到页面文字");
    }

    const scripts = await generateTrainingScripts(trainingJob.title, slides);
    const scriptsWithImages = scripts.map((script) => ({
      ...script,
      image_path: null as string | null
    }));
    await updateTrainingJobAndSnapshot(trainingJob.id, {
      script_json: scriptsWithImages,
      audio_paths: [],
      status: "generating"
    });

    const slideRender = await renderPptxSlideImages({
      pptxBuffer,
      storagePrefix: `training-slides/${Date.now()}-${crypto.randomUUID()}`,
      slideCount: scripts.length,
      supabase,
      onImage: async (image) => {
        const existingScript = scriptsWithImages[image.page - 1];
        if (!existingScript) {
          return;
        }

        scriptsWithImages[image.page - 1] = {
          ...existingScript,
          image_path: image.image_path
        };

        if (image.page % 5 === 0 || image.page === scripts.length) {
          await updateTrainingJobAndSnapshot(trainingJob.id, {
            script_json: scriptsWithImages,
            status: "generating"
          });
        }
      }
    });
    const renderedImageByPage = new Map(slideRender.images.map((image) => [image.page, image.image_path]));
    for (const script of scriptsWithImages) {
      script.image_path = renderedImageByPage.get(script.page) ?? script.image_path ?? null;
    }

    await updateTrainingJobAndSnapshot(trainingJob.id, {
      script_json: scriptsWithImages,
      audio_paths: [],
      status: "ready"
    });
  } catch (error) {
    console.error("[training-course-build]", error);
    await updateTrainingJobAndSnapshot(trainingJob.id, {
      status: "failed"
    }).catch((updateError) => {
      console.error("[training-course-build:update-failed]", updateError);
    });
  }
}

async function updateTrainingJobAndSnapshot(
  id: string,
  input: Parameters<typeof updateTrainingJob>[1]
) {
  const updated = await updateTrainingJob(id, input);
  await mergeTrainingListSnapshot({ trainingJob: updated }).catch((error) => {
    console.warn("[training-course-build:snapshot]", error);
  });
  return updated;
}

async function readTrainingSource(storagePath: string | null, supabase: StorageClient | null) {
  if (!storagePath) {
    throw new Error("培训 PPT 源文件不存在，请重新上传。");
  }

  if (storagePath.startsWith(localStoragePrefix)) {
    const dataDir = path.join(process.cwd(), ".data");
    const filePath = path.normalize(path.resolve(process.cwd(), storagePath.slice(localStoragePrefix.length)));

    if (!filePath.startsWith(`${dataDir}${path.sep}`)) {
      throw new Error("培训 PPT 源文件路径不合法。");
    }

    return readFile(filePath);
  }

  if (!supabase) {
    throw new Error("文件存储未配置，无法读取培训 PPT 源文件。");
  }

  const { data, error } = await supabase.storage.from("documents").download(storagePath);
  if (error || !data) {
    throw new Error(error?.message ?? "培训 PPT 源文件不存在。");
  }

  return Buffer.from(await data.arrayBuffer());
}

function safeFileName(fileName: string) {
  return fileName
    .replace(/[\\/]/g, "-")
    .replace(/[^a-zA-Z0-9._\-\u4e00-\u9fa5]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "training.pptx";
}
