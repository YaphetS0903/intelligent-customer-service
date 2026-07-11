import { createRequire } from "node:module";

const nodeRequire = createRequire(import.meta.url);

type CanvasModule = {
  createCanvas: (width: number, height: number) => {
    getContext: (contextType: "2d") => unknown;
    toBuffer: (mimeType: "image/png") => Buffer;
  };
};

export async function renderDocumentPageImage(file: File, pageNumber: number) {
  const lowerName = file.name.toLowerCase();

  if (isPdfFile(file, lowerName)) {
    return renderPdfPage(file, pageNumber);
  }

  if (isImageFile(file, lowerName)) {
    if (pageNumber !== 1) {
      throw new Error("图片资料只有第 1 页。");
    }

    return {
      image: Buffer.from(await file.arrayBuffer()),
      contentType: normalizeImageContentType(file.type)
    };
  }

  throw new Error("当前文件类型暂不支持源图预览。");
}

export function canPreviewDocumentPageImage(input: { fileType: string; fileName: string }) {
  const lowerName = input.fileName.toLowerCase();
  return isPdfFile({ type: input.fileType, name: input.fileName } as File, lowerName) ||
    isImageFile({ type: input.fileType, name: input.fileName } as File, lowerName);
}

async function renderPdfPage(file: File, pageNumber: number) {
  if (!Number.isFinite(pageNumber) || pageNumber < 1) {
    throw new Error("页码不合法。");
  }

  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const { createCanvas } = nodeRequire("@napi-rs/" + "canvas") as CanvasModule;
  const data = new Uint8Array(await file.arrayBuffer());
  const loadingTask = pdfjs.getDocument({
    data,
    useSystemFonts: true
  });
  const pdf = await loadingTask.promise;

  try {
    if (pageNumber > pdf.numPages) {
      throw new Error(`PDF 只有 ${pdf.numPages} 页。`);
    }

    const page = await pdf.getPage(pageNumber);
    const baseViewport = page.getViewport({ scale: 1 });
    const scale = Math.min(2, Math.max(1.25, 1800 / Math.max(baseViewport.width, baseViewport.height)));
    const viewport = page.getViewport({ scale });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const canvasContext = canvas.getContext("2d");

    await page.render({
      canvas: canvas as unknown as HTMLCanvasElement,
      canvasContext: canvasContext as unknown as CanvasRenderingContext2D,
      viewport
    }).promise;

    const image = canvas.toBuffer("image/png");
    page.cleanup();

    return {
      image,
      contentType: "image/png"
    };
  } finally {
    await pdf.destroy();
  }
}

function isPdfFile(file: Pick<File, "type" | "name">, lowerName = file.name.toLowerCase()) {
  return file.type === "application/pdf" || lowerName.endsWith(".pdf");
}

function isImageFile(file: Pick<File, "type" | "name">, lowerName = file.name.toLowerCase()) {
  return file.type.startsWith("image/") || /\.(png|jpe?g|webp|bmp|tiff?)$/i.test(lowerName);
}

function normalizeImageContentType(value: string) {
  return value.startsWith("image/") ? value : "image/png";
}
