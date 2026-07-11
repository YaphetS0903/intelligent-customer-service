import { execFile } from "child_process";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { pathToFileURL } from "url";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

type StorageUploadClient = {
  storage: {
    from(bucket: string): {
      upload(
        storagePath: string,
        body: Buffer,
        options: { contentType: string; upsert: boolean }
      ): Promise<{ error: { message: string } | null }>;
    };
  };
};

export type SlideImageRenderResult = {
  images: Array<{
    page: number;
    image_path: string;
  }>;
  error: string | null;
  missing_tools: string[];
};

export async function renderPptxSlideImages(input: {
  pptxBuffer: Buffer;
  storagePrefix: string;
  slideCount: number;
  supabase: StorageUploadClient | null;
  onImage?: (image: { page: number; image_path: string }) => Promise<void> | void;
}): Promise<SlideImageRenderResult> {
  const soffice = await resolveCommand("SOFFICE_BIN", ["libreoffice", "soffice"]);
  const pdftoppm = await resolveCommand("PDFTOPPM_BIN", ["pdftoppm"]);
  const missingTools = [
    soffice ? null : "LibreOffice/soffice",
    pdftoppm ? null : "poppler-utils/pdftoppm"
  ].filter(Boolean) as string[];

  if (!soffice || !pdftoppm) {
    return {
      images: [],
      error: `PPT 页面渲染工具未就绪：缺少 ${missingTools.join("、")}`,
      missing_tools: missingTools
    };
  }

  const workDir = await mkdtemp(path.join(tmpdir(), "training-ppt-"));

  try {
    const pdfDir = path.join(workDir, "pdf");
    const imageDir = path.join(workDir, "images");
    const profileDir = path.join(workDir, "lo-profile");
    const pptxPath = path.join(workDir, "source.pptx");

    await Promise.all([
      mkdir(pdfDir, { recursive: true }),
      mkdir(imageDir, { recursive: true }),
      mkdir(profileDir, { recursive: true })
    ]);
    await writeFile(pptxPath, input.pptxBuffer);

    await execFileAsync(
      soffice,
      [
        `-env:UserInstallation=${pathToFileURL(profileDir).href}`,
        "--headless",
        "--invisible",
        "--nologo",
        "--nofirststartwizard",
        "--convert-to",
        "pdf",
        "--outdir",
        pdfDir,
        pptxPath
      ],
      { timeout: 120000, maxBuffer: 1024 * 1024 * 8 }
    );

    const pdfFiles = (await readdir(pdfDir)).filter((fileName) => fileName.toLowerCase().endsWith(".pdf"));
    const pdfPath = path.join(pdfDir, pdfFiles[0] ?? "source.pdf");
    const outputPrefix = path.join(imageDir, "slide");

    await execFileAsync(
      pdftoppm,
      ["-png", "-r", "150", pdfPath, outputPrefix],
      { timeout: 120000, maxBuffer: 1024 * 1024 * 8 }
    );

    const imageFiles = (await readdir(imageDir))
      .filter((fileName) => fileName.toLowerCase().endsWith(".png"))
      .sort((a, b) => pageNumberFromImageName(a) - pageNumberFromImageName(b))
      .slice(0, Math.max(input.slideCount, 0));

    const images = [];
    const safePrefix = sanitizeStoragePrefix(input.storagePrefix);

    for (let index = 0; index < imageFiles.length; index += 1) {
      const page = index + 1;
      const imageBuffer = await readFile(path.join(imageDir, imageFiles[index]));
      const storagePath = `${safePrefix}/page-${page}.png`;
      const imagePath = input.supabase
        ? await uploadSlideImage(input.supabase, storagePath, imageBuffer, page)
        : await writeLocalSlideImage(storagePath, imageBuffer);

      images.push({
        page,
        image_path: imagePath
      });
      await input.onImage?.({
        page,
        image_path: imagePath
      });
    }

    return {
      images,
      error: images.length > 0 ? null : "PPT 已转换，但没有生成可用的页面图片。",
      missing_tools: []
    };
  } catch (error) {
    return {
      images: [],
      error: error instanceof Error ? error.message : "PPT 页面渲染失败",
      missing_tools: []
    };
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

async function resolveCommand(envName: string, candidates: string[]) {
  const configured = process.env[envName]?.trim();
  if (configured) {
    return configured;
  }

  try {
    const command = `${candidates.map((candidate) => `command -v ${candidate}`).join(" || ")} || true`;
    const { stdout } = await execFileAsync("sh", ["-lc", command], { timeout: 5000, maxBuffer: 1024 * 1024 });
    return stdout.trim().split(/\s+/)[0] || null;
  } catch {
    return null;
  }
}

async function uploadSlideImage(
  supabase: StorageUploadClient,
  storagePath: string,
  imageBuffer: Buffer,
  page: number
) {
  const { error } = await supabase.storage.from("documents").upload(storagePath, imageBuffer, {
    contentType: "image/png",
    upsert: true
  });

  if (error) {
    throw new Error(`第 ${page} 页课件图片上传失败：${error.message}`);
  }

  return storagePath;
}

async function writeLocalSlideImage(storagePath: string, imageBuffer: Buffer) {
  const publicPath = path.join(process.cwd(), "public", "generated", ...storagePath.split("/"));
  await mkdir(path.dirname(publicPath), { recursive: true });
  await writeFile(publicPath, imageBuffer);

  return `/generated/${storagePath}`;
}

function sanitizeStoragePrefix(prefix: string) {
  return prefix
    .split("/")
    .map((part) => part.replace(/[^a-zA-Z0-9._-]/g, "-").replace(/-+/g, "-") || "slides")
    .join("/");
}

function pageNumberFromImageName(fileName: string) {
  return Number(fileName.match(/(\d+)\.png$/i)?.[1] ?? 0);
}
