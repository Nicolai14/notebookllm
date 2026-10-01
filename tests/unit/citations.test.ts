import { describe, expect, it } from "vitest";
import { validateCitations, type RetrievedChunkWithMeta } from "@/lib/rag/citations";

function retrievedChunk(overrides: Partial<RetrievedChunkWithMeta> = {}): RetrievedChunkWithMeta {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    source_id: "22222222-2222-4222-8222-222222222222",
    chunk_index: 0,
    content: "Die Wartung erfolgt jährlich im Juli.",
    page_start: null,
    page_end: null,
    section_path: "Absatz 2",
    similarity: 0.9,
    filename: "handbuch.txt",
    ...overrides,
  };
}

describe("validateCitations", () => {
  it("keeps valid markers and resolves metadata from the retrieved chunks", () => {
    const retrieved = [retrievedChunk(), retrievedChunk({ id: "33333333-3333-4333-8333-333333333333", section_path: "Absatz 5" })];
    const { content, citations } = validateCitations(
      "Die Wartung erfolgt im Juli [1]. Der Speicher fasst 120 Kubikmeter [2].",
      retrieved
    );
    expect(content).toContain("[1]");
    expect(content).toContain("[2]");
    expect(citations).toHaveLength(2);
    expect(citations[0]).toMatchObject({
      marker: 1,
      chunk_id: retrieved[0].id,
      filename: "handbuch.txt",
      section_path: "Absatz 2",
      passage: retrieved[0].content,
    });
    expect(citations[1].section_path).toBe("Absatz 5");
  });

  it("strips markers that do not point to a provided chunk", () => {
    const { content, citations } = validateCitations(
      "Belegt [1]. Erfunden [7]. Auch erfunden [99].",
      [retrievedChunk()]
    );
    expect(content).toBe("Belegt [1]. Erfunden. Auch erfunden.");
    expect(citations).toHaveLength(1);
    expect(citations[0].marker).toBe(1);
  });

  it("strips marker zero and keeps text intact", () => {
    const { content, citations } = validateCitations("Aussage [0].", [retrievedChunk()]);
    expect(content).toBe("Aussage.");
    expect(citations).toHaveLength(0);
  });

  it("returns no citations when the model cites nothing", () => {
    const { content, citations } = validateCitations("Keine Belege vorhanden.", [
      retrievedChunk(),
    ]);
    expect(content).toBe("Keine Belege vorhanden.");
    expect(citations).toHaveLength(0);
  });

  it("deduplicates repeated markers into one citation", () => {
    const { citations } = validateCitations("A [1]. B [1]. C [1][1].", [retrievedChunk()]);
    expect(citations).toHaveLength(1);
  });

  it("ignores citation-like text invented by document content (fake formats)", () => {
    // A document could contain "[Quelle 3]" or "(siehe [12])" style injections;
    // only plain [n] markers within range survive, everything else is removed
    // or left as inert text.
    const { content, citations } = validateCitations(
      "Behauptung [Quelle 3] bleibt Text. Injektion [12] wird entfernt [1].",
      [retrievedChunk()]
    );
    expect(content).toContain("[Quelle 3]");
    expect(content).not.toContain("[12]");
    expect(citations).toHaveLength(1);
  });
});
