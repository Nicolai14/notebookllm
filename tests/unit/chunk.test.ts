import { describe, expect, it } from "vitest";
import { buildChunks } from "@/lib/processing/chunk";
import type { ExtractedUnit } from "@/lib/processing/extract";

function unit(
  text: string,
  page: number | null,
  sectionPath: string | null,
  mergeKey?: string
): ExtractedUnit {
  return {
    text,
    page,
    sectionPath,
    mergeKey: mergeKey ?? (page !== null ? `page-${page}` : "txt"),
  };
}

describe("buildChunks", () => {
  it("merges consecutive small paragraphs into one chunk with a range label", () => {
    const units = [
      unit("Erster Absatz.", null, "Absatz 1"),
      unit("Zweiter Absatz.", null, "Absatz 2"),
      unit("Dritter Absatz.", null, "Absatz 3"),
    ];
    const chunks = buildChunks(units, { targetTokens: 500, overlapTokens: 50 });
    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toContain("Erster Absatz.");
    expect(chunks[0].content).toContain("Dritter Absatz.");
    expect(chunks[0].sectionPath).toBe("Absatz 1 bis Absatz 3");
    expect(chunks[0].chunkIndex).toBe(0);
  });

  it("starts a new chunk when the target size is reached", () => {
    const big = "Wort ".repeat(300).trim(); // ~375 estimated tokens
    const units = [unit(big, null, "Absatz 1"), unit(big, null, "Absatz 2")];
    const chunks = buildChunks(units, { targetTokens: 400, overlapTokens: 50 });
    expect(chunks).toHaveLength(2);
    expect(chunks[0].sectionPath).toBe("Absatz 1");
    expect(chunks[1].sectionPath).toBe("Absatz 2");
  });

  it("never merges markdown units across section boundaries", () => {
    const units = [
      unit("Inhalt Inbetriebnahme.", null, "Handbuch > Inbetriebnahme", "Handbuch > Inbetriebnahme"),
      unit("Inhalt Filterwechsel.", null, "Handbuch > Filterwechsel", "Handbuch > Filterwechsel"),
    ];
    const chunks = buildChunks(units, { targetTokens: 500, overlapTokens: 50 });
    expect(chunks).toHaveLength(2);
    expect(chunks[0].sectionPath).toBe("Handbuch > Inbetriebnahme");
    expect(chunks[1].sectionPath).toBe("Handbuch > Filterwechsel");
  });

  it("never merges units across page boundaries", () => {
    const units = [
      unit("Kurzer Text Seite eins.", 1, null),
      unit("Kurzer Text Seite zwei.", 2, null),
    ];
    const chunks = buildChunks(units, { targetTokens: 500, overlapTokens: 50 });
    expect(chunks).toHaveLength(2);
    expect(chunks[0].pageStart).toBe(1);
    expect(chunks[0].pageEnd).toBe(1);
    expect(chunks[1].pageStart).toBe(2);
  });

  it("splits an oversized unit at sentence boundaries with overlap", () => {
    const sentences = Array.from(
      { length: 40 },
      (_, i) => `Dies ist der inhaltlich eindeutige Beispielsatz Nummer ${i + 1}.`
    );
    const units = [unit(sentences.join(" "), 3, null)];
    const chunks = buildChunks(units, { targetTokens: 120, overlapTokens: 30 });

    expect(chunks.length).toBeGreaterThan(2);
    for (const chunk of chunks) {
      expect(chunk.pageStart).toBe(3);
      expect(chunk.pageEnd).toBe(3);
    }
    // Overlap: the first sentence of chunk 2 must already appear in chunk 1.
    const firstSentenceOfSecond = chunks[1].content.split(".")[0];
    expect(chunks[0].content).toContain(firstSentenceOfSecond.trim());
    // No content is lost.
    const merged = chunks.map((c) => c.content).join(" ");
    for (const sentence of sentences) {
      expect(merged).toContain(sentence);
    }
  });

  it("assigns sequential chunk indexes", () => {
    const units = Array.from({ length: 5 }, (_, i) =>
      unit("Wort ".repeat(200).trim(), null, `Absatz ${i + 1}`)
    );
    const chunks = buildChunks(units, { targetTokens: 260, overlapTokens: 30 });
    expect(chunks.map((c) => c.chunkIndex)).toEqual(chunks.map((_, i) => i));
  });

  it("returns no chunks for empty input", () => {
    expect(buildChunks([])).toHaveLength(0);
  });
});
