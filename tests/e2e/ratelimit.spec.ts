// Rate limits via HTTP: 429 with Retry-After, no OpenAI call when blocked,
// login lockout per IP. The AI counter is pre-seeded directly in the database
// (service role) instead of issuing 60 real requests.
import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { RATE_LIMIT_AI, RATE_LIMIT_LOGIN } from "../../src/lib/limits";

const PASSWORD = process.env.DEMO_PASSWORD ?? "";
const MOCK_BASE = "http://127.0.0.1:4105";

function db() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
}

function sessionIdFromCookie(cookieValue: string): string {
  const payload = cookieValue.split(".")[0];
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")).sid;
}

test("AI-Limit: 429 mit Retry-After und ohne OpenAI-Aufruf", async ({ playwright }, testInfo) => {
  const baseURL = testInfo.project.use.baseURL!;
  const session = await playwright.request.newContext({ baseURL });
  const mock = await playwright.request.newContext({ baseURL: MOCK_BASE });
  await session.post("/api/auth/login", { data: { password: PASSWORD } });

  const cookie = (await session.storageState()).cookies.find(
    (c) => c.name === "nb_session"
  )!;
  const sessionId = sessionIdFromCookie(cookie.value);

  const created = await session.post("/api/notebooks", {
    data: { title: `Limit ${Date.now()}` },
  });
  const notebookId = (await created.json()).notebook.id;
  const upload = await session.post(`/api/notebooks/${notebookId}/sources`, {
    multipart: {
      file: { name: "a.txt", mimeType: "text/plain", buffer: Buffer.from("Inhalt da.") },
    },
  });
  const sourceId = (await upload.json()).source.id;

  // Seed the counter to the limit; the next request must be the 429.
  const key = `ai:${sessionId}`;
  const { error } = await db()
    .from("rate_limits")
    .upsert({ key, window_start: new Date().toISOString(), count: RATE_LIMIT_AI.max });
  expect(error).toBeNull();

  await mock.post("/__reset");
  for (const path of ["chat", "summary"]) {
    const response = await session.post(`/api/notebooks/${notebookId}/${path}`, {
      data: { question: "Test?", sourceIds: [sourceId] },
    });
    expect(response.status(), path).toBe(429);
    const retryAfter = Number(response.headers()["retry-after"]);
    expect(retryAfter).toBeGreaterThanOrEqual(1);
    expect(retryAfter).toBeLessThanOrEqual(RATE_LIMIT_AI.windowSeconds);
    expect((await response.json()).error).toContain("Limit für KI-Anfragen");
  }
  const stats = await (await mock.get("/__stats")).json();
  expect(stats).toEqual({ embeddings: 0, chat: 0 });

  // Below the limit the same request goes through again.
  await db().from("rate_limits").delete().eq("key", key);
  const ok = await session.post(`/api/notebooks/${notebookId}/chat`, {
    data: { question: "Was steht in der Quelle?", sourceIds: [sourceId] },
  });
  expect(ok.status()).toBe(200);

  await session.delete(`/api/notebooks/${notebookId}`);
  await mock.dispose();
  await session.dispose();
});

test("Login-Limit sperrt nach zu vielen Fehlversuchen pro IP", async ({ playwright }, testInfo) => {
  const baseURL = testInfo.project.use.baseURL!;
  const fakeIp = `test-${Date.now()}`;
  const context = await playwright.request.newContext({
    baseURL,
    extraHTTPHeaders: { "x-forwarded-for": fakeIp },
  });

  for (let i = 0; i < RATE_LIMIT_LOGIN.max; i++) {
    const response = await context.post("/api/auth/login", {
      data: { password: "falsch-falsch" },
    });
    expect(response.status(), `Versuch ${i + 1}`).toBe(401);
  }

  // Attempt max+1 is blocked, even with the correct password.
  const blockedWrong = await context.post("/api/auth/login", {
    data: { password: "falsch-falsch" },
  });
  expect(blockedWrong.status()).toBe(429);
  expect(Number(blockedWrong.headers()["retry-after"])).toBeGreaterThanOrEqual(1);

  const blockedRight = await context.post("/api/auth/login", {
    data: { password: PASSWORD },
  });
  expect(blockedRight.status()).toBe(429);

  await db().from("rate_limits").delete().eq("key", `login:${fakeIp}`);
  // Keep the shared global backstop clean for repeated suite runs.
  await db().from("rate_limits").delete().eq("key", "login-global");
  await context.dispose();
});
