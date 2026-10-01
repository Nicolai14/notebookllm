import { ValidationError } from "@/lib/errors";

/**
 * One structural unit of a document: a paragraph (TXT), a heading section (MD)
 * or a page (PDF). Chunks never span unit boundaries except when merging
 * consecutive small units, which keeps page/section attribution exact.
 */
export interface ExtractedUnit {
  text: string;
  page: number | null;
  sectionPath: string | null;
  /**
   * Units may only be merged into one chunk when their mergeKey matches:
   * PDF pages and Markdown sections stay separate so citation locations are
   * exact; TXT paragraphs (artificial labels) may merge freely.
   */
  mergeKey: string;
}

export function extractMarkdown(buffer: Buffer): ExtractedUnit[] {
  let text = buffer.toString("utf8");
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  text = text.replace(/\r\n?/g, "\n");

  const units: ExtractedUnit[] = [];
  // Heading path per level, e.g. "Installation > Docker".
  const headingPath: string[] = [];
  let paragraphFallback = 0;

  for (const block of text.split(/\n{2,}/)) {
    const trimmed = block.trim();
    if (trimmed.length === 0) continue;

    const headingMatch = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(trimmed);
    if (headingMatch && !trimmed.includes("\n")) {
      const level = headingMatch[1].length;
      headingPath.splice(level - 1);
      headingPath[level - 1] = headingMatch[2];
      continue;
    }

    const sectionPath =
      headingPath.filter(Boolean).join(" > ") || `Absatz ${++paragraphFallback}`;
    units.push({ text: trimmed, page: null, sectionPath, mergeKey: sectionPath });
  }

  if (units.length === 0) {
    throw new ValidationError("Die Datei enthält keinen extrahierbaren Text.");
  }
  return units;
}

export function extractTxt(buffer: Buffer): ExtractedUnit[] {
  let text = buffer.toString("utf8");
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  text = text.replace(/\r\n?/g, "\n");

  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  if (paragraphs.length === 0) {
    throw new ValidationError("Die Datei enthält keinen extrahierbaren Text.");
  }

  return paragraphs.map((p, i) => ({
    text: p,
    page: null,
    sectionPath: `Absatz ${i + 1}`,
    mergeKey: "txt",
  }));
}
