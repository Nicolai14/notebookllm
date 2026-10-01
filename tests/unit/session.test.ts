import { describe, expect, it } from "vitest";
import {
  createSessionCookieValue,
  verifySessionCookieValue,
} from "@/lib/auth/session";

const SECRET = "test-secret-with-at-least-32-characters!";

describe("session cookie", () => {
  it("roundtrips a valid session", async () => {
    const value = await createSessionCookieValue("session-123", SECRET, 60_000);
    const payload = await verifySessionCookieValue(value, SECRET);
    expect(payload?.sid).toBe("session-123");
  });

  it("rejects a tampered payload", async () => {
    const value = await createSessionCookieValue("session-123", SECRET, 60_000);
    const [encoded, signature] = value.split(".");
    const forged = Buffer.from(
      JSON.stringify({ sid: "other-session", exp: Date.now() + 60_000 })
    )
      .toString("base64url");
    expect(await verifySessionCookieValue(`${forged}.${signature}`, SECRET)).toBeNull();
    expect(await verifySessionCookieValue(`${encoded}.AAAA`, SECRET)).toBeNull();
  });

  it("rejects a cookie signed with a different secret", async () => {
    const value = await createSessionCookieValue("session-123", "x".repeat(32), 60_000);
    expect(await verifySessionCookieValue(value, SECRET)).toBeNull();
  });

  it("rejects an expired cookie", async () => {
    const value = await createSessionCookieValue("session-123", SECRET, -1);
    expect(await verifySessionCookieValue(value, SECRET)).toBeNull();
  });

  it("rejects malformed values", async () => {
    expect(await verifySessionCookieValue(undefined, SECRET)).toBeNull();
    expect(await verifySessionCookieValue("", SECRET)).toBeNull();
    expect(await verifySessionCookieValue("abc", SECRET)).toBeNull();
    expect(await verifySessionCookieValue("a.b.c", SECRET)).toBeNull();
    expect(await verifySessionCookieValue("not-base64!.sig", SECRET)).toBeNull();
  });
});
