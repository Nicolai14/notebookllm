import { describe, expect, it } from "vitest";
import { extractMarkdown } from "@/lib/processing/extract";
import { ValidationError } from "@/lib/errors";

describe("extractMarkdown", () => {
  it("builds heading paths across levels", () => {
    const md = [
      "# Handbuch",
      "",
      "Einleitungstext.",
      "",
      "## Installation",
      "",
      "Schritt eins.",
      "",
      "### Docker",
      "",
      "Docker-Details.",
      "",
      "## Betrieb",
      "",
      "Betriebshinweise.",
    ].join("\n");
    const units = extractMarkdown(Buffer.from(md));
    expect(units.map((u) => u.sectionPath)).toEqual([
      "Handbuch",
      "Handbuch > Installation",
      "Handbuch > Installation > Docker",
      "Handbuch > Betrieb",
    ]);
    expect(units[2].text).toBe("Docker-Details.");
    expect(units.every((u) => u.page === null)).toBe(true);
  });

  it("resets deeper heading levels when a higher level starts", () => {
    const md = "## A\n\n### B\n\nText B.\n\n## C\n\nText C.";
    const units = extractMarkdown(Buffer.from(md));
    expect(units.map((u) => u.sectionPath)).toEqual(["A > B", "C"]);
  });

  it("falls back to paragraph labels without headings", () => {
    const units = extractMarkdown(Buffer.from("Erster Block.\n\nZweiter Block."));
    expect(units.map((u) => u.sectionPath)).toEqual(["Absatz 1", "Absatz 2"]);
  });

  it("does not treat # inside a paragraph as a heading", () => {
    const units = extractMarkdown(Buffer.from("Zeile eins\n# keine Überschrift mitten im Block"));
    expect(units).toHaveLength(1);
    expect(units[0].sectionPath).toBe("Absatz 1");
  });

  it("rejects heading-only files as empty", () => {
    expect(() => extractMarkdown(Buffer.from("# Nur Titel\n\n## Noch einer"))).toThrow(
      ValidationError
    );
  });
});
