// Kill switch (AI_FEATURES_ENABLED=false): chat, summary and processing refuse
// with clear messages and WITHOUT any OpenAI call; management keeps working.
// Runs against the dedicated instance on KILL_SWITCH_PORT.
import { expect, test, type APIRequestContext } from "@playwright/test";
import { KILL_SWITCH_PORT } from "../../playwright.config";

const PASSWORD = process.env.DEMO_PASSWORD ?? "";
const BASE = `http://127.0.0.1:${KILL_SWITCH_PORT}`;
const MOCK_BASE = "http://127.0.0.1:4105";

test.describe("Kill-Switch", () => {
  let session: APIRequestContext;
  let mock: APIRequestContext;
  let notebookId: string;

  test.beforeAll(async ({ playwright }) => {
    session = await playwright.request.newContext({ baseURL: BASE });
    mock = await playwright.request.newContext({ baseURL: MOCK_BASE });
    const login = await session.post("/api/auth/login", { data: { password: PASSWORD } });
    expect(login.ok()).toBe(true);
    const created = await session.post("/api/notebooks", {
      data: { title: `Killswitch ${Date.now()}` },
    });
    expect(created.status()).toBe(201);
    notebookId = (await created.json()).notebook.id;
  });

  test.afterAll(async () => {
    await session.delete(`/api/notebooks/${notebookId}`);
    await session.dispose();
    await mock.dispose();
  });

  test("Chat und Zusammenfassung antworten 503 ohne OpenAI-Aufruf", async () => {
    await mock.post("/__reset");
    for (const path of ["chat", "summary"]) {
      const response = await session.post(`/api/notebooks/${notebookId}/${path}`, {
        data: { question: "Test?", sourceIds: [crypto.randomUUID()] },
      });
      expect(response.status(), path).toBe(503);
      expect((await response.json()).error).toContain("deaktiviert");
    }
    const stats = await (await mock.get("/__stats")).json();
    expect(stats).toEqual({ embeddings: 0, chat: 0 });
  });

  test("Upload endet kontrolliert ohne Embedding-Aufruf", async () => {
    await mock.post("/__reset");
    const response = await session.post(`/api/notebooks/${notebookId}/sources`, {
      multipart: {
        file: { name: "doc.txt", mimeType: "text/plain", buffer: Buffer.from("Inhalt.") },
      },
    });
    expect(response.status()).toBe(201);
    const { source } = await response.json();
    expect(source.status).toBe("error");
    expect(source.error_message).toContain("deaktiviert");
    const stats = await (await mock.get("/__stats")).json();
    expect(stats.embeddings).toBe(0);
  });

  test("Verwaltung funktioniert weiter: Liste, Verlauf, Löschen", async () => {
    expect((await session.get("/api/notebooks")).status()).toBe(200);
    expect((await session.get(`/api/notebooks/${notebookId}/sources`)).status()).toBe(200);
    expect((await session.get(`/api/notebooks/${notebookId}/messages`)).status()).toBe(200);

    const sources = (await (await session.get(`/api/notebooks/${notebookId}/sources`)).json())
      .sources as { id: string }[];
    for (const source of sources) {
      expect((await session.delete(`/api/sources/${source.id}`)).status()).toBe(200);
    }

    const temp = await session.post("/api/notebooks", { data: { title: "CRUD-Check" } });
    expect(temp.status()).toBe(201);
    expect(
      (await session.delete(`/api/notebooks/${(await temp.json()).notebook.id}`)).status()
    ).toBe(200);
  });
});
