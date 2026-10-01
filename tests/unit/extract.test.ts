import { describe, expect, it } from "vitest";
import { extractTxt } from "@/lib/processing/extract";
import { ValidationError } from "@/lib/errors";

describe("extractTxt", () => {
  it("splits paragraphs and labels them sequentially", () => {
    const units = extractTxt(Buffer.from("Absatz eins.\n\nAbsatz zwei.\n\n\nAbsatz drei."));
    expect(units).toHaveLength(3);
    expect(units[0]).toEqual({
      text: "Absatz eins.",
      page: null,
      sectionPath: "Absatz 1",
      mergeKey: "txt",
    });
    expect(units[2].sectionPath).toBe("Absatz 3");
  });

  it("normalizes Windows line endings and strips the BOM", () => {
    const units = extractTxt(Buffer.from("﻿Eins.\r\n\r\nZwei."));
    expect(units).toHaveLength(2);
    expect(units[0].text).toBe("Eins.");
  });

  it("rejects files without extractable text", () => {
    expect(() => extractTxt(Buffer.from(""))).toThrow(ValidationError);
    expect(() => extractTxt(Buffer.from("   \n\n  \n"))).toThrow(
      "keinen extrahierbaren Text"
    );
  });
});
