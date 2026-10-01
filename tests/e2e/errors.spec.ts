// AI service error paths via mock fault injection: uploads end in a controlled
// error state, chat streams emit a clear error event, no half answers persist.
import { expect, test, type APIRequestContext } from "@playwright/test";

const PASSWORD = process.env.DEMO_PASSWORD ?? "";
const MOCK_BASE = "http://127.0.0.1:4105";

test.describe("KI-Dienst-Fehlerpfade", () => {
  let session: APIRequestContext;
  let mock: APIRequestContext;
  let notebookId: string;

  test.beforeAll(async ({ playwright }, testInfo) => {
    const baseURL = testInfo.project.use.baseURL!;
    session = await playwright.request.newContext({ baseURL });
    mock = await playwright.request.newContext({ baseURL: MOCK_BASE });
    await session.post("/api/auth/login", { data: { password: PASSWORD } });
    const created = await session.post("/api/notebooks", {
      data: { title: `Fehlerpfade ${Date.now()}` },
    });
    notebookId = (await created.json()).notebook.id;
  });

  test.afterAll(async () => {
    await mock.post("/__reset");
    await session.delete(`/api/notebooks/${notebookId}`);
    await session.dispose();
    await mock.dispose();
  });

  test("Upload endet bei Embedding-Fehler kontrolliert im Status error", async () => {
    await mock.post("/__fail", { data: { target: "embeddings", times: 3 } });
    const response = await session.post(`/api/notebooks/${notebookId}/sources`, {
      multipart: {
        file: { name: "kaputt.txt", mimeType: "text/plain", buffer: Buffer.from("Inhalt.") },
      },
    });
    expect(response.status()).toBe(201);
    const { source } = await response.json();
    expect(source.status).toBe("error");
    expect(source.error_message).toContain("KI-Dienst");
  });

  test("Chat-Fehler kommt als SSE-error-Event an; keine halbe Antwort im Verlauf", async () => {
    // A working source first (no induced failure).
    const upload = await session.post(`/api/notebooks/${notebookId}/sources`, {
      multipart: {
        file: {
          name: "ok.txt",
          mimeType: "text/plain",
          buffer: Buffer.from("Die Pumpe läuft im Dauerbetrieb."),
        },
      },
    });
    const sourceId = (await upload.json()).source.id;
    expect((await upload.json()).source.status).toBe("ready");

    const before = (
      await (await session.get(`/api/notebooks/${notebookId}/messages`)).json()
    ).messages.length;

    await mock.post("/__fail", { data: { target: "chat", times: 3 } });
    const response = await session.post(`/api/notebooks/${notebookId}/chat`, {
      data: { question: "Wie läuft die Pumpe?", sourceIds: [sourceId] },
    });
    expect(response.ok()).toBe(true);

    let errorEvent: { error?: string } | null = null;
    let doneEvent = false;
    for (const block of (await response.text()).split("\n\n")) {
      const line = block.trim();
      if (!line.startsWith("data: ")) continue;
      const event = JSON.parse(line.slice(6));
      if (event.type === "error") errorEvent = event;
      if (event.type === "done") doneEvent = true;
    }
    expect(errorEvent?.error).toContain("KI-Dienst");
    expect(doneEvent).toBe(false);

    // The user question is persisted (documented behavior), but no assistant
    // fragment may appear.
    const after = (
      await (await session.get(`/api/notebooks/${notebookId}/messages`)).json()
    ).messages as { role: string }[];
    expect(after.length).toBe(before + 1);
    expect(after[after.length - 1].role).toBe("user");
  });

  test("Frage über dem Längenlimit wird abgewiesen", async () => {
    const response = await session.post(`/api/notebooks/${notebookId}/chat`, {
      data: { question: "x".repeat(2001), sourceIds: [crypto.randomUUID()] },
    });
    expect(response.status()).toBe(400);
    expect((await response.json()).error).toContain("2000 Zeichen");
  });

  test("Upload-Limit liefert 429 ohne OpenAI-Aufruf", async ({ playwright }, testInfo) => {
    const baseURL = testInfo.project.use.baseURL!;
    const fresh = await playwright.request.newContext({ baseURL });
    await fresh.post("/api/auth/login", { data: { password: PASSWORD } });
    const cookie = (await fresh.storageState()).cookies.find((c) => c.name === "nb_session")!;
    const sessionId = JSON.parse(
      Buffer.from(cookie.value.split(".")[0], "base64url").toString("utf8")
    ).sid;

    const { createClient } = await import("@supabase/supabase-js");
    const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false },
    });
    await db.from("rate_limits").upsert({
      key: `upload:${sessionId}`,
      window_start: new Date().toISOString(),
      count: 30,
    });

    const created = await fresh.post("/api/notebooks", { data: { title: "Upload-Limit" } });
    const freshNotebook = (await created.json()).notebook.id;

    await mock.post("/__reset");
    const blocked = await fresh.post(`/api/notebooks/${freshNotebook}/sources`, {
      multipart: {
        file: { name: "x.txt", mimeType: "text/plain", buffer: Buffer.from("Inhalt.") },
      },
    });
    expect(blocked.status()).toBe(429);
    expect(Number(blocked.headers()["retry-after"])).toBeGreaterThanOrEqual(1);
    const stats = await (await mock.get("/__stats")).json();
    expect(stats.embeddings).toBe(0);

    await db.from("rate_limits").delete().eq("key", `upload:${sessionId}`);
    await fresh.delete(`/api/notebooks/${freshNotebook}`);
    await fresh.dispose();
  });
});
