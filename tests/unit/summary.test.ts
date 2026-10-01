import { describe, expect, it } from "vitest";
import { buildOmissionNote, planSummary } from "@/lib/rag/summary";

function chunk(sourceId: string, index: number, tokens: number, filename: string) {
  return {
    id: `${sourceId}-${index}`,
    source_id: sourceId,
    chunk_index: index,
    content: "w".repeat(tokens * 4), // estimateTokens = chars / 4
    page_start: null,
    page_end: null,
    section_path: `Absatz ${index + 1}`,
    filename,
  };
}

describe("planSummary", () => {
  it("uses one direct call for short selections and numbers all chunks", () => {
    const chunks = [chunk("a", 0, 100, "a.txt"), chunk("b", 0, 100, "b.txt")];
    const plan = planSummary(chunks, { directTokenBudget: 500 });
    expect(plan.mode).toBe("direct");
    expect(plan.batches).toHaveLength(1);
    expect(plan.included.map((c) => c.marker)).toEqual([1, 2]);
    expect(plan.omissions).toEqual([]);
  });

  it("switches to staged mode above the direct budget and respects the batch budget", () => {
    const chunks = Array.from({ length: 6 }, (_, i) => chunk("a", i, 100, "a.txt"));
    const plan = planSummary(chunks, {
      directTokenBudget: 300,
      batchTokenBudget: 250,
      maxBatchesPerSource: 10,
      maxMapCalls: 10,
    });
    expect(plan.mode).toBe("staged");
    expect(plan.batches).toHaveLength(3);
    expect(plan.included).toHaveLength(6);
    for (const batch of plan.batches) {
      expect(batch.chunks.length).toBeLessThanOrEqual(2);
    }
    expect(plan.omissions).toEqual([]);
  });

  it("caps batches per source and reports omissions with the first omitted location", () => {
    const chunks = Array.from({ length: 5 }, (_, i) => chunk("a", i, 100, "a.txt"));
    const plan = planSummary(chunks, {
      directTokenBudget: 100,
      batchTokenBudget: 100,
      maxBatchesPerSource: 2,
      maxMapCalls: 10,
    });
    expect(plan.batches).toHaveLength(2);
    expect(plan.included).toHaveLength(2);
    expect(plan.omissions).toEqual([{ filename: "a.txt", fromLabel: "Absatz 3" }]);
  });

  it("applies the global map-call cap across sources", () => {
    const chunks = [
      ...Array.from({ length: 2 }, (_, i) => chunk("a", i, 100, "a.txt")),
      ...Array.from({ length: 2 }, (_, i) => chunk("b", i, 100, "b.txt")),
    ];
    const plan = planSummary(chunks, {
      directTokenBudget: 100,
      batchTokenBudget: 100,
      maxBatchesPerSource: 10,
      maxMapCalls: 3,
    });
    expect(plan.batches).toHaveLength(3);
    expect(plan.omissions).toEqual([{ filename: "b.txt", fromLabel: "Absatz 2" }]);
  });

  it("keeps global markers unique and ordered across batches", () => {
    const chunks = [
      ...Array.from({ length: 3 }, (_, i) => chunk("a", i, 100, "a.txt")),
      ...Array.from({ length: 3 }, (_, i) => chunk("b", i, 100, "b.txt")),
    ];
    const plan = planSummary(chunks, {
      directTokenBudget: 100,
      batchTokenBudget: 200,
      maxBatchesPerSource: 10,
      maxMapCalls: 10,
    });
    expect(plan.included.map((c) => c.marker)).toEqual([1, 2, 3, 4, 5, 6]);
    const flattened = plan.batches.flatMap((b) => b.chunks.map((c) => c.marker));
    expect(flattened).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe("buildOmissionNote", () => {
  it("is empty without omissions", () => {
    expect(buildOmissionNote([])).toBe("");
  });

  it("names file and location of omitted content", () => {
    const note = buildOmissionNote([{ filename: "lang.pdf", fromLabel: "Seite 42" }]);
    expect(note).toContain("lang.pdf");
    expect(note).toContain("Seite 42");
    expect(note).toContain("nicht alle Inhalte");
  });
});
