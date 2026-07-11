import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";
import { createRequire } from "node:module";
import { env, hasOcrConfig } from "@/lib/config";
import { parsePptx } from "@/lib/pptx";
import { buildProviderHeaders, renderJsonTemplate } from "@/lib/provider-http";

const nodeRequire = createRequire(import.meta.url);

const parser = new XMLParser({
  ignoreAttributes: false,
  preserveOrder: false,
  trimValues: true
});

const textLikeTypes = new Set(["text/plain", "text/markdown"]);
const excelTypes = new Set([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel"
]);
const imageExtensions = [".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tif", ".tiff"];

type ExtractedTextSection = {
  title: string;
  content: string;
  page?: number;
  section?: string;
  sheet?: string;
  cellRange?: string;
  parser?: string;
};

export type ExtractedText = {
  title: string;
  content: string;
  sections: ExtractedTextSection[];
};

export type ExtractTextProgress = {
  stage: "pdf_text" | "pdf_render" | "ocr" | "parsed";
  message: string;
  pages_total?: number | null;
  pages_done?: number | null;
  page?: number | null;
};

export type ExtractTextOptions = {
  onProgress?: (progress: ExtractTextProgress) => void;
};

type CanvasModule = {
  createCanvas: (width: number, height: number) => {
    getContext: (contextType: "2d") => unknown;
    toBuffer: (mimeType: "image/png") => Buffer;
  };
};

export async function extractTextFromFile(file: File, options: ExtractTextOptions = {}): Promise<ExtractedText> {
  const fileName = file.name;
  const lowerName = fileName.toLowerCase();

  if (textLikeTypes.has(file.type) || lowerName.endsWith(".txt") || lowerName.endsWith(".md")) {
    const content = await file.text();
    return {
      title: fileName,
      content,
      sections: splitMarkdownLikeSections(content, fileName, "text")
    };
  }

  if (file.type === "application/pdf" || lowerName.endsWith(".pdf")) {
    return extractPdfText(file, options);
  }

  if (isImageFile(file, lowerName)) {
    return recognizeTextWithOcr(file, options);
  }

  if (excelTypes.has(file.type) || lowerName.endsWith(".xlsx") || lowerName.endsWith(".xls")) {
    return extractExcelText(file);
  }

  if (lowerName.endsWith(".pptx")) {
    const slides = await parsePptx(file);
    const sections = slides.map((slide) => ({
      title: slide.title,
      content: [slide.title, ...slide.bullets, slide.notes, slide.rawText].filter(Boolean).join("\n"),
      page: slide.page,
      section: slide.title,
      parser: "pptx"
    }));

    return {
      title: fileName,
      content: sections.map((section) => section.content).join("\n\n"),
      sections
    };
  }

  if (lowerName.endsWith(".docx")) {
    const content = await extractDocxText(file);
    return {
      title: fileName,
      content,
      sections: splitMarkdownLikeSections(content, fileName, "docx")
    };
  }

  throw new Error("local_text 模式当前支持 TXT、Markdown、DOCX、PPTX、PDF、XLSX、XLS 和图片 OCR。扫描件 PDF 或图片资料需要先配置 OCR。");
}

export function isImageFile(file: File, lowerName = file.name.toLowerCase()) {
  return file.type.startsWith("image/") || imageExtensions.some((extension) => lowerName.endsWith(extension));
}

export function chunkExtractedText(input: {
  documentId: string;
  knowledgeBaseId: string;
  fileName: string;
  title: string;
  extracted: ExtractedText;
}) {
  const chunks: Array<{
    document_id: string;
    knowledge_base_id: string;
    chunk_index: number;
    content: string;
    token_estimate: number;
    metadata: {
      title: string;
      file_name: string;
      page?: number;
      section?: string;
      sheet?: string;
      cell_range?: string;
      parser?: string;
      source: string;
    };
  }> = [];
  let chunkIndex = 0;

  for (const section of input.extracted.sections) {
    for (const content of splitIntoChunks(section.content)) {
      const chunkContent = buildChunkContentWithContext({
        content,
        fileName: input.fileName,
        title: section.title || input.title,
        page: section.page,
        section: section.section ?? section.title,
        sheet: section.sheet,
        cellRange: section.cellRange
      });

      chunks.push({
        document_id: input.documentId,
        knowledge_base_id: input.knowledgeBaseId,
        chunk_index: chunkIndex,
        content: chunkContent,
        token_estimate: estimateTokens(chunkContent),
        metadata: {
          title: section.title || input.title,
          file_name: input.fileName,
          page: section.page,
          section: section.section ?? section.title,
          sheet: section.sheet,
          cell_range: section.cellRange,
          parser: section.parser,
          source: "local_text"
        }
      });
      chunkIndex += 1;
    }
  }

  return chunks;
}

function buildChunkContentWithContext(input: {
  content: string;
  fileName: string;
  title: string;
  page?: number;
  section?: string;
  sheet?: string;
  cellRange?: string;
}) {
  const locationParts = [
    input.page ? `第 ${input.page} 页` : null,
    input.section && input.section !== input.title ? input.section : null,
    input.sheet ? `工作表：${input.sheet}` : null,
    input.cellRange ? `范围：${input.cellRange}` : null
  ].filter(Boolean);
  const header = [
    `资料：${input.fileName}`,
    input.title && input.title !== input.fileName ? `标题：${input.title}` : null,
    locationParts.length > 0 ? `位置：${locationParts.join(" / ")}` : null
  ].filter(Boolean).join("\n");

  if (!header) {
    return input.content;
  }

  return `${header}\n\n${input.content}`.trim();
}

async function extractPdfText(file: File, options: ExtractTextOptions = {}): Promise<ExtractedText> {
  options.onProgress?.({
    stage: "pdf_text",
    message: "正在读取 PDF 文本层",
    pages_total: null,
    pages_done: null
  });
  const { PDFParse } = nodeRequire("pdf-parse") as typeof import("pdf-parse");
  const buffer = new Uint8Array(await file.arrayBuffer());
  const pdf = new PDFParse({ data: buffer });

  try {
    const result = await pdf.getText();
    const sections = result.pages
      .map((page) => {
        const content = normalizeContent(page.text);
        const section = inferSectionTitle(content, `第 ${page.num} 页`);

        return {
          title: `${file.name} ${section}`,
          content,
          page: page.num,
          section,
          parser: "pdf_text"
        };
      })
      .filter((section) => section.content.length > 0);
    const content = sections.map((section) => section.content).join("\n\n");

    if (content.replace(/\s/g, "").length < 20) {
      return extractPdfWithOcr(file, options);
    }

    options.onProgress?.({
      stage: "parsed",
      message: `PDF 文本层解析完成，共 ${sections.length} 页`,
      pages_total: sections.length,
      pages_done: sections.length
    });

    return {
      title: file.name,
      content,
      sections
    };
  } finally {
    await pdf.destroy();
  }
}

async function extractPdfWithOcr(file: File, options: ExtractTextOptions = {}): Promise<ExtractedText> {
  return recognizeTextWithOcr(file, options);
}

export async function recognizeTextWithOcr(file: File, options: ExtractTextOptions = {}): Promise<ExtractedText> {
  if (!hasOcrConfig()) {
    throw new Error("未配置 OCR。请在配置页接入 OCR_API_URL/OCR_API_KEY 后重试。");
  }

  if (isPdfFile(file)) {
    return recognizePdfPagesWithOcr(file, options);
  }

  options.onProgress?.({
    stage: "ocr",
    message: "正在调用 OCR 识别图片文字",
    pages_total: 1,
    pages_done: 0,
    page: 1
  });
  const extracted = await recognizeSingleFileWithOcr(file);
  options.onProgress?.({
    stage: "ocr",
    message: "图片 OCR 识别完成",
    pages_total: 1,
    pages_done: 1,
    page: 1
  });
  return extracted;
}

async function recognizeSingleFileWithOcr(file: File): Promise<ExtractedText> {
  const response = env.ocrRequestFormat === "json_base64"
    ? await postOcrJson(file)
    : await postOcrMultipart(file);

  if (!response.ok) {
    throw new Error(`OCR 识别失败：${response.status} ${response.statusText}`);
  }

  const data = await response.json() as unknown;
  const sections = parseOcrSections(data, file.name);

  if (sections.length === 0) {
    throw new Error("OCR 接口未返回可入库文字，请确认返回 JSON 包含 text 或 pages/results。");
  }

  return {
    title: file.name,
    content: sections.map((section) => section.content).join("\n\n"),
    sections
  };
}

async function recognizePdfPagesWithOcr(file: File, options: ExtractTextOptions = {}): Promise<ExtractedText> {
  const pageImages = await renderPdfPagesAsImages(file, options);
  const sections: ExtractedTextSection[] = [];

  for (let index = 0; index < pageImages.length; index += 1) {
    const pageImage = pageImages[index];
    options.onProgress?.({
      stage: "ocr",
      message: `正在 OCR 识别 PDF 第 ${pageImage.page} 页`,
      pages_total: pageImages.length,
      pages_done: index,
      page: pageImage.page
    });
    const extracted = await recognizeSingleFileWithOcr(pageImage.file);
    for (const section of extracted.sections) {
      sections.push({
        ...section,
        title: `${file.name} 第 ${pageImage.page} 页 OCR`,
        page: pageImage.page,
        section: `第 ${pageImage.page} 页`,
        parser: "pdf_ocr"
      });
    }
    options.onProgress?.({
      stage: "ocr",
      message: `PDF 第 ${pageImage.page} 页 OCR 完成`,
      pages_total: pageImages.length,
      pages_done: index + 1,
      page: pageImage.page
    });
  }

  const content = sections.map((section) => section.content).join("\n\n");
  if (!content.trim()) {
    throw new Error("PDF OCR 未识别到可入库文字，请确认扫描件清晰或 OCR 服务支持图片识别。");
  }

  return {
    title: file.name,
    content,
    sections
  };
}

function isPdfFile(file: File) {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}

async function renderPdfPagesAsImages(file: File, options: ExtractTextOptions = {}) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const { createCanvas } = nodeRequire("@napi-rs/" + "canvas") as CanvasModule;
  const data = new Uint8Array(await file.arrayBuffer());
  const loadingTask = pdfjs.getDocument({
    data,
    useSystemFonts: true
  });
  const pdf = await loadingTask.promise;
  const baseName = file.name.replace(/\.pdf$/i, "") || "document";
  const pages: Array<{ page: number; file: File }> = [];

  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      options.onProgress?.({
        stage: "pdf_render",
        message: `正在渲染 PDF 第 ${pageNumber} 页供 OCR 识别`,
        pages_total: pdf.numPages,
        pages_done: pageNumber - 1,
        page: pageNumber
      });
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

      const imageBuffer = canvas.toBuffer("image/png");
      const imageData = imageBuffer.buffer.slice(
        imageBuffer.byteOffset,
        imageBuffer.byteOffset + imageBuffer.byteLength
      ) as ArrayBuffer;
      pages.push({
        page: pageNumber,
        file: new File([imageData], `${baseName}-page-${pageNumber}.png`, { type: "image/png" })
      });
      page.cleanup();
      options.onProgress?.({
        stage: "pdf_render",
        message: `PDF 第 ${pageNumber} 页图像已生成`,
        pages_total: pdf.numPages,
        pages_done: pageNumber,
        page: pageNumber
      });
    }
  } finally {
    await pdf.destroy();
  }

  if (pages.length === 0) {
    throw new Error("PDF 没有可识别页面。");
  }

  return pages;
}

async function postOcrMultipart(file: File) {
  const formData = new FormData();
  formData.append(env.ocrFileField || "file", file, file.name);

  if (env.ocrProviderField && env.ocrProviderField.toLowerCase() !== "none") {
    formData.append(env.ocrProviderField, env.ocrProvider);
  }

  if (env.ocrModel && env.ocrModelField && env.ocrModelField.toLowerCase() !== "none") {
    formData.append(env.ocrModelField, env.ocrModel);
  }

  return fetch(env.ocrApiUrl, {
    method: "POST",
    headers: buildProviderHeaders({
      apiKey: env.ocrApiKey,
      authHeader: env.ocrAuthHeader,
      extraHeaders: env.ocrHeaders
    }),
    body: formData
  });
}

async function postOcrJson(file: File) {
  const arrayBuffer = await file.arrayBuffer();
  const fileBase64 = Buffer.from(arrayBuffer).toString("base64");
  const mimeType = file.type || "application/octet-stream";
  const fileDataUrl = `data:${mimeType};base64,${fileBase64}`;
  const body = renderJsonTemplate(
    env.ocrPayloadTemplate,
    {
      file_base64: fileBase64,
      image_base64: fileBase64,
      file_data_url: fileDataUrl,
      image_data_url: fileDataUrl,
      file_name: file.name,
      mime_type: mimeType,
      model: env.ocrModel,
      provider: env.ocrProvider
    },
    {
      file_base64: fileBase64,
      image_base64: fileBase64,
      file_data_url: fileDataUrl,
      image_data_url: fileDataUrl,
      file_name: file.name,
      mime_type: mimeType,
      model: env.ocrModel || undefined
    }
  );

  return fetch(env.ocrApiUrl, {
    method: "POST",
    headers: buildProviderHeaders({
      apiKey: env.ocrApiKey,
      authHeader: env.ocrAuthHeader,
      extraHeaders: env.ocrHeaders,
      contentType: "application/json"
    }),
    body: JSON.stringify(body)
  });
}

async function extractExcelText(file: File): Promise<ExtractedText> {
  const XLSX = await import("xlsx");
  const workbook = XLSX.read(await file.arrayBuffer(), {
    type: "array",
    cellDates: true
  });
  const sections: ExtractedTextSection[] = [];
  const rowsPerSection = 40;

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) {
      continue;
    }

    const rows = XLSX.utils.sheet_to_json<Array<string | number | boolean | Date | null>>(sheet, {
      header: 1,
      blankrows: false,
      defval: "",
      raw: false
    }).filter((row) => row.some((cell) => String(cell ?? "").trim()));

    if (rows.length === 0) {
      continue;
    }

    const sheetRange = sheet["!ref"];
    for (let start = 0; start < rows.length; start += rowsPerSection) {
      const batch = rows.slice(start, start + rowsPerSection);
      const rowStart = start + 1;
      const rowEnd = start + batch.length;
      const cellRange = sheetRange ? `${sheetName}!${rowStart}:${rowEnd} / ${sheetRange}` : `${sheetName}!${rowStart}:${rowEnd}`;
      const title = `${file.name} - ${sheetName} 第 ${rowStart}-${rowEnd} 行`;
      const content = [
        `工作表：${sheetName}`,
        `范围：${cellRange}`,
        rowsToMarkdownTable(batch)
      ].join("\n");

      sections.push({
        title,
        content,
        section: `${sheetName} 第 ${rowStart}-${rowEnd} 行`,
        sheet: sheetName,
        cellRange,
        parser: "excel"
      });
    }
  }

  return {
    title: file.name,
    content: sections.map((section) => section.content).join("\n\n"),
    sections
  };
}

async function extractDocxText(file: File) {
  const buffer = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(buffer);
  const xml = await zip.file("word/document.xml")?.async("text");

  if (!xml) {
    return "";
  }

  const parsed = parser.parse(xml);
  const texts: string[] = [];
  collectOfficeText(parsed, texts);
  return normalizeTexts(texts).join("\n");
}

function splitMarkdownLikeSections(content: string, fallbackTitle: string, parserName: string) {
  const normalized = normalizeContent(content);
  const lines = normalized.split("\n");
  const sections: ExtractedTextSection[] = [];
  let currentTitle = fallbackTitle;
  let currentLines: string[] = [];

  function pushSection() {
    const sectionContent = currentLines.join("\n").trim();
    if (!sectionContent) {
      return;
    }

    sections.push({
      title: currentTitle,
      content: sectionContent,
      section: currentTitle,
      parser: parserName
    });
  }

  for (const line of lines) {
    const heading = line.match(/^#{1,4}\s+(.+)$/);
    if (heading) {
      pushSection();
      currentTitle = heading[1].trim();
      currentLines = [currentTitle];
      continue;
    }

    currentLines.push(line);
  }

  pushSection();

  if (sections.length === 0 && normalized) {
    sections.push({
      title: fallbackTitle,
      content: normalized,
      section: fallbackTitle,
      parser: parserName
    });
  }

  return sections;
}

function parseOcrSections(data: unknown, fileName: string): ExtractedTextSection[] {
  const payload = unwrapOcrPayload(data);
  const pageItems = readOcrPageItems(payload);

  if (pageItems.length > 0) {
    return pageItems
      .map((item, index) => {
        const content = normalizeContent(item.text);
        const page = item.page ?? index + 1;

        return {
          title: `${fileName} 第 ${page} 页 OCR`,
          content,
          page,
          section: `第 ${page} 页`,
          parser: "ocr"
        };
      })
      .filter((section) => section.content.length > 0);
  }

  const text = readStringProperty(payload, "text") ?? readStringProperty(payload, "content") ?? readStringProperty(payload, "result");
  const content = normalizeContent(text ?? readMultimodalText(payload) ?? "");

  if (!content) {
    return [];
  }

  return [{
    title: `${fileName} OCR`,
    content,
    section: "OCR 识别全文",
    parser: "ocr"
  }];
}

function unwrapOcrPayload(data: unknown): unknown {
  if (!data || typeof data !== "object") {
    return data;
  }

  const record = data as Record<string, unknown>;
  return record.data ?? record.result ?? record;
}

function readOcrPageItems(data: unknown): Array<{ page?: number; text: string }> {
  if (!data || typeof data !== "object") {
    return [] as Array<{ page?: number; text: string }>;
  }

  const record = data as Record<string, unknown>;
  const rawPages = Array.isArray(record.pages)
    ? record.pages
    : Array.isArray(record.results)
      ? record.results
      : [];

  const items: Array<{ page?: number; text: string }> = [];

  for (const item of rawPages) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const pageRecord = item as Record<string, unknown>;
    const text = readStringProperty(pageRecord, "text") ?? readStringProperty(pageRecord, "content") ?? readStringProperty(pageRecord, "result");
    const pageValue = pageRecord.page ?? pageRecord.pageNumber ?? pageRecord.page_num;
    const page = Number(pageValue);

    if (!text) {
      continue;
    }

    items.push({
      page: Number.isFinite(page) ? page : undefined,
      text
    });
  }

  return items;
}

function readStringProperty(record: unknown, key: string) {
  if (!record || typeof record !== "object") {
    return null;
  }

  const value = (record as Record<string, unknown>)[key];
  return typeof value === "string" ? value : null;
}

function readMultimodalText(data: unknown) {
  if (!data || typeof data !== "object") {
    return null;
  }

  const record = data as Record<string, unknown>;
  const direct = readStringProperty(record, "output_text") ?? readStringProperty(record, "answer");
  if (direct) {
    return direct;
  }

  const choiceText = readChoicesText(record.choices);
  if (choiceText) {
    return choiceText;
  }

  const responseText = readResponseOutputText(record.output);
  if (responseText) {
    return responseText;
  }

  return null;
}

function readChoicesText(value: unknown) {
  if (!Array.isArray(value)) {
    return null;
  }

  const parts: string[] = [];

  for (const item of value) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const choice = item as Record<string, unknown>;
    parts.push(
      ...readContentParts(choice.message),
      ...readContentParts(choice.delta),
      ...readContentParts(choice)
    );
  }

  return parts.filter(Boolean).join("\n\n") || null;
}

function readResponseOutputText(value: unknown) {
  if (!Array.isArray(value)) {
    return null;
  }

  const parts: string[] = [];

  for (const item of value) {
    parts.push(...readContentParts(item));
  }

  return parts.filter(Boolean).join("\n\n") || null;
}

function readContentParts(value: unknown): string[] {
  if (!value) {
    return [];
  }

  if (typeof value === "string") {
    return [value];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => readContentParts(item));
  }

  if (typeof value !== "object") {
    return [];
  }

  const record = value as Record<string, unknown>;
  const direct = readStringProperty(record, "text") ??
    readStringProperty(record, "content") ??
    readStringProperty(record, "output_text");

  if (direct) {
    return [direct];
  }

  return readContentParts(record.content);
}

function rowsToMarkdownTable(rows: Array<Array<string | number | boolean | Date | null>>) {
  const maxColumns = Math.max(...rows.map((row) => row.length));
  const normalizedRows = rows.map((row) =>
    Array.from({ length: maxColumns }, (_, index) => formatCell(row[index]))
  );
  const header = normalizedRows[0] ?? [];
  const body = normalizedRows.slice(1);

  return [
    `| ${header.join(" | ")} |`,
    `| ${header.map(() => "---").join(" | ")} |`,
    ...body.map((row) => `| ${row.join(" | ")} |`)
  ].join("\n");
}

function formatCell(value: string | number | boolean | Date | null | undefined) {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }

  return String(value ?? "").replace(/\r?\n/g, " ").replace(/\|/g, "\\|").trim();
}

function inferSectionTitle(content: string, fallback: string) {
  const firstLine = content
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0 && line.length <= 80);

  if (!firstLine) {
    return fallback;
  }

  return firstLine.replace(/^#{1,6}\s+/, "") || fallback;
}

function splitIntoChunks(content: string) {
  const normalized = normalizeContent(content);
  const paragraphs = splitSemanticBlocks(normalized);
  const chunks: string[] = [];
  let current = "";

  for (const paragraph of paragraphs.length > 0 ? paragraphs : [normalized]) {
    const next = `${current}\n\n${paragraph}`.trim();

    if (next.length > 1100 && current) {
      chunks.push(current.trim());
      current = withOverlap(current, paragraph);
      continue;
    }

    current = next;
  }

  if (current) {
    chunks.push(current.trim());
  }

  return chunks.flatMap((chunk) => hardSplit(chunk, 1400));
}

function splitSemanticBlocks(content: string) {
  const rawParagraphs = content.split(/\n{2,}/).map((item) => item.trim()).filter(Boolean);
  const blocks: string[] = [];

  for (const paragraph of rawParagraphs.length > 0 ? rawParagraphs : [content]) {
    if (paragraph.length <= 700) {
      blocks.push(paragraph);
      continue;
    }

    blocks.push(...splitLongParagraph(paragraph));
  }

  return blocks.filter(Boolean);
}

function splitLongParagraph(paragraph: string) {
  const lines = paragraph.split("\n").map((line) => line.trim()).filter(Boolean);
  const blocks: string[] = [];
  let current = "";

  for (const line of lines.length > 1 ? lines : splitSentences(paragraph)) {
    const isHeading = /^(第[一二三四五六七八九十百\d]+[章节条款项]|[一二三四五六七八九十]+、|\d+[.、])/.test(line);
    if ((isHeading || `${current}${line}`.length > 650) && current) {
      blocks.push(current.trim());
      current = line;
      continue;
    }

    current = `${current}${current ? "\n" : ""}${line}`.trim();
  }

  if (current) {
    blocks.push(current.trim());
  }

  return blocks;
}

function splitSentences(content: string) {
  return content
    .split(/(?<=[。！？；.!?;])\s*/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function withOverlap(previous: string, next: string) {
  const sentences = splitSentences(previous.replace(/\n+/g, " "));
  const tail = sentences.slice(-2).join("");

  if (!tail || tail.length > 220) {
    return next;
  }

  return `${tail}\n\n${next}`;
}

function hardSplit(content: string, maxLength: number) {
  const result: string[] = [];
  const overlap = 120;

  for (let index = 0; index < content.length; index += maxLength - overlap) {
    result.push(content.slice(index, index + maxLength).trim());
  }

  return result;
}

function estimateTokens(content: string) {
  return Math.ceil(content.length / 2);
}

function normalizeContent(content: string) {
  return content.replace(/\r/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function collectOfficeText(value: unknown, texts: string[]) {
  if (value === null || value === undefined) {
    return;
  }

  if (typeof value === "string" || typeof value === "number") {
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectOfficeText(item, texts);
    }
    return;
  }

  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const textNode = record["w:t"] ?? record["a:t"];
    if (typeof textNode === "string") {
      texts.push(textNode);
    }

    for (const item of Object.values(record)) {
      collectOfficeText(item, texts);
    }
  }
}

function normalizeTexts(texts: string[]) {
  return texts.map((item) => item.replace(/\s+/g, " ").trim()).filter(Boolean);
}
