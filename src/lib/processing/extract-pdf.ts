import { extractText, getDocumentProxy } from "unpdf";
import { ValidationError } from "@/lib/errors";
import { MAX_PDF_PAGES } from "@/lib/limits";
import type { ExtractedUnit } from "./extract";

export interface PdfExtraction {
  units: ExtractedUnit[];
  pageCount: number;
}

/** Text-layer extraction only; scanned PDFs without text are rejected (no OCR). */
export async function extractPdf(buffer: Buffer): Promise<PdfExtraction> {
  let pdf;
  try {
    pdf = await getDocumentProxy(new Uint8Array(buffer));
  } catch (err) {
    throw mapPdfOpenError(err);
  }

  const pageCount = pdf.numPages;
  if (pageCount > MAX_PDF_PAGES) {
    throw new ValidationError(
      `Das PDF hat ${pageCount} Seiten; erlaubt sind höchstens ${MAX_PDF_PAGES}.`
    );
  }

  const { text } = await extractText(pdf, { mergePages: false });
  const units: ExtractedUnit[] = [];
  text.forEach((pageText, index) => {
    const cleaned = pageText.replace(/\s+/g, " ").trim();
    if (cleaned.length > 0) {
      units.push({ text: cleaned, page: index + 1, sectionPath: null });
    }
  });

  if (units.length === 0) {
    throw new ValidationError(
      "Das PDF enthält keinen extrahierbaren Text (vermutlich gescannt). Texterkennung (OCR) wird nicht unterstützt."
    );
  }

  return { units, pageCount };
}

export function mapPdfOpenError(err: unknown): ValidationError {
  const name = (err as { name?: string })?.name ?? "";
  if (name === "PasswordException") {
    return new ValidationError("Das PDF ist passwortgeschützt und kann nicht verarbeitet werden.");
  }
  console.error("pdf open failed:", err);
  return new ValidationError("Die Datei ist kein lesbares PDF.");
}
