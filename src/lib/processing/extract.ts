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
  }));
}
