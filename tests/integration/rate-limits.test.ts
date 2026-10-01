// Atomic rate limiting against the real database; no OpenAI involved.
import { afterAll, describe, expect, it } from "vitest";
import { hitRateLimit, resetRateLimit } from "@/lib/db/rateLimits";

const keys: string[] = [];

function testKey(): string {
  const key = `test:${crypto.randomUUID()}`;
  keys.push(key);
  return key;
}

afterAll(async () => {
  for (const key of keys) await resetRateLimit(key);
});

describe("rate_limit_hit", () => {
  it("allows up to the limit and rejects afterwards with a retry hint", async () => {
    const key = testKey();
    for (let i = 0; i < 3; i++) {
      const result = await hitRateLimit(key, 60, 3);
      expect(result.allowed).toBe(true);
    }
    const rejected = await hitRateLimit(key, 60, 3);
    expect(rejected.allowed).toBe(false);
    expect(rejected.retryAfterSeconds).toBeGreaterThanOrEqual(1);
    expect(rejected.retryAfterSeconds).toBeLessThanOrEqual(60);
  });

  it("opens a new window after the old one expires", async () => {
    const key = testKey();
    expect((await hitRateLimit(key, 1, 1)).allowed).toBe(true);
    expect((await hitRateLimit(key, 1, 1)).allowed).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 1200));
    expect((await hitRateLimit(key, 1, 1)).allowed).toBe(true);
  });

  it("counts concurrent requests atomically: exactly max are allowed", async () => {
    const key = testKey();
    const results = await Promise.all(
      Array.from({ length: 20 }, () => hitRateLimit(key, 60, 10))
    );
    const allowed = results.filter((r) => r.allowed).length;
    expect(allowed).toBe(10);
  });

  it("reset clears the counter", async () => {
    const key = testKey();
    expect((await hitRateLimit(key, 60, 1)).allowed).toBe(true);
    expect((await hitRateLimit(key, 60, 1)).allowed).toBe(false);
    await resetRateLimit(key);
    expect((await hitRateLimit(key, 60, 1)).allowed).toBe(true);
  });
});
