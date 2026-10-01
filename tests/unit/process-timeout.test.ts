import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/config", () => ({
  getConfig: () => ({ AI_FEATURES_ENABLED: true }),
}));
vi.mock("@/lib/db/embeddingConfig", () => ({
  ensureEmbeddingConfigMatches: vi.fn(async () => {}),
}));
const updateSourceStatus = vi.fn(async () => {});
vi.mock("@/lib/db/sources", () => ({
  updateSourceStatus: (...args: unknown[]) => updateSourceStatus(...(args as [])),
}));
const insertChunks = vi.fn(async () => {});
vi.mock("@/lib/db/chunks", () => ({
  insertChunks: (...args: unknown[]) => insertChunks(...(args as [])),
}));
vi.mock("@/lib/openai", () => ({
  embedTexts: async (texts: string[]) => {
    await new Promise((resolve) => setTimeout(resolve, 150));
    return texts.map(() => [0]);
  },
}));

import { processSource } from "@/lib/processing/process";
import type { SourceRow } from "@/lib/db/types";

const source: SourceRow = {
  id: "s1",
  notebook_id: "n1",
  filename: "slow.txt",
  mime_type: "text/plain",
  size_bytes: 10,
  storage_path: "p",
  status: "pending",
  error_message: null,
  page_count: null,
  extracted_chars: null,
  created_at: "",
  updated_at: "",
};

beforeEach(() => {
  updateSourceStatus.mockClear();
  insertChunks.mockClear();
});

describe("processSource timeout", () => {
  it("ends in a controlled error state when processing exceeds the limit", async () => {
    const result = await processSource(source, Buffer.from("Inhalt."), 20);
    expect(result.status).toBe("error");
    expect(result.error_message).toContain("zu lange gedauert");

    const lastCall = updateSourceStatus.mock.calls.at(-1) as unknown[];
    expect(lastCall[1]).toBe("error");
    expect(insertChunks).not.toHaveBeenCalled();

    // The losing pipeline promise keeps running after the timeout; the guard
    // must prevent it from writing chunks for the already-failed source.
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(insertChunks).not.toHaveBeenCalled();
  });

  it("completes normally when within the limit", async () => {
    const result = await processSource(source, Buffer.from("Inhalt."), 5_000);
    expect(result.status).toBe("ready");
    expect(insertChunks).toHaveBeenCalledTimes(1);
  });

  it("rejects documents above the extracted-token limit with a clear message", async () => {
    // ~130k estimated tokens > MAX_EXTRACTED_TOKENS (120k)
    const huge = Buffer.from("Wort ".repeat(104_000));
    const result = await processSource(source, huge, 10_000);
    expect(result.status).toBe("error");
    expect(result.error_message).toContain("Verarbeitungslimit");
    expect(insertChunks).not.toHaveBeenCalled();
  });
});
