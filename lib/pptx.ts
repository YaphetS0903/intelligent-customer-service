import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";

export type ParsedSlide = {
  page: number;
  title: string;
  bullets: string[];
  notes: string;
  rawText: string;
};

const parser = new XMLParser({
  ignoreAttributes: false,
  preserveOrder: false,
  trimValues: true
});

export async function parsePptx(file: File): Promise<ParsedSlide[]> {
  const buffer = await file.arrayBuffer();
  return parsePptxBuffer(Buffer.from(buffer));
}

export async function parsePptxBuffer(buffer: Buffer): Promise<ParsedSlide[]> {
  const zip = await JSZip.loadAsync(buffer);
  const slideFiles = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => slideNumber(a) - slideNumber(b));

  const slides: ParsedSlide[] = [];

  for (const slideFile of slideFiles) {
    const xml = await zip.file(slideFile)?.async("text");
    if (!xml) {
      continue;
    }

    const parsed = parser.parse(xml);
    const texts: string[] = [];
    collectText(parsed, texts);
    const cleaned = normalizeTexts(texts);
    const [title = `第 ${slides.length + 1} 页`, ...bullets] = cleaned;
    const page = slides.length + 1;
    const notes = await parseNotes(zip, page);

    slides.push({
      page,
      title,
      bullets: bullets.slice(0, 8),
      notes,
      rawText: cleaned.join("\n")
    });
  }

  return slides;
}

async function parseNotes(zip: JSZip, page: number) {
  const notesPath = `ppt/notesSlides/notesSlide${page}.xml`;
  const xml = await zip.file(notesPath)?.async("text");
  if (!xml) {
    return "";
  }

  const parsed = parser.parse(xml);
  const texts: string[] = [];
  collectText(parsed, texts);
  return normalizeTexts(texts)
    .filter((text) => !/^Slide \d+$/i.test(text))
    .join("\n");
}

function slideNumber(path: string) {
  return Number(path.match(/slide(\d+)\.xml$/)?.[1] ?? 0);
}

function collectText(value: unknown, texts: string[]) {
  if (value === null || value === undefined) {
    return;
  }

  if (typeof value === "string" || typeof value === "number") {
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectText(item, texts);
    }
    return;
  }

  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const textNode = record["a:t"];
    if (typeof textNode === "string") {
      texts.push(textNode);
    }

    for (const item of Object.values(record)) {
      collectText(item, texts);
    }
  }
}

function normalizeTexts(texts: string[]) {
  const result: string[] = [];
  const seen = new Set<string>();

  for (const item of texts) {
    const normalized = item.replace(/\s+/g, " ").trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    result.push(normalized);
  }

  return result;
}
