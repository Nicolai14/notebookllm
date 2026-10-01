import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { extractPdf, mapPdfOpenError } from "@/lib/processing/extract-pdf";
import { ValidationError } from "@/lib/errors";
import { MAX_PDF_PAGES } from "@/lib/limits";

async function pdfWithPages(texts: (string | null)[]): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const text of texts) {
    const page = doc.addPage([400, 300]);
    if (text) {
      page.drawText(text, { x: 40, y: 200, size: 12, font });
    }
  }
  return Buffer.from(await doc.save());
}

describe("extractPdf", () => {
  it("extracts text per page with correct page numbers", async () => {
    const buffer = await pdfWithPages([
      "Inhalt der ersten Seite.",
      "Inhalt der zweiten Seite.",
      "Inhalt der dritten Seite.",
    ]);
    const { units, pageCount } = await extractPdf(buffer);
    expect(pageCount).toBe(3);
    expect(units).toHaveLength(3);
    expect(units[0]).toMatchObject({ page: 1 });
    expect(units[0].text).toContain("ersten Seite");
    expect(units[2]).toMatchObject({ page: 3 });
    expect(units[2].text).toContain("dritten Seite");
  });

  it("skips empty pages but keeps the numbering of the rest", async () => {
    const buffer = await pdfWithPages(["Seite eins.", null, "Seite drei."]);
    const { units } = await extractPdf(buffer);
    expect(units.map((u) => u.page)).toEqual([1, 3]);
  });

  it("rejects PDFs without any extractable text with an OCR hint", async () => {
    const buffer = await pdfWithPages([null, null]);
    await expect(extractPdf(buffer)).rejects.toThrow(/gescannt|OCR/);
  });

  it("rejects PDFs above the page limit", async () => {
    const buffer = await pdfWithPages(
      Array.from({ length: MAX_PDF_PAGES + 1 }, (_, i) => `Seite ${i + 1}.`)
    );
    await expect(extractPdf(buffer)).rejects.toThrow(/höchstens 100/);
  });

  it("rejects corrupt files as unreadable PDFs", async () => {
    await expect(extractPdf(Buffer.from("%PDF-1.4 kaputt"))).rejects.toThrow(
      ValidationError
    );
  });

  it("maps a password exception to a clear German message", () => {
    const err = Object.assign(new Error("No password given"), {
      name: "PasswordException",
    });
    expect(mapPdfOpenError(err).message).toContain("passwortgeschützt");
  });
});
