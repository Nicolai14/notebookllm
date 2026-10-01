// API-level access control tests (no browser): unauthenticated access,
// session separation (IDOR), upload validation and limits.
// Uses the OpenAI mock via the shared web server; no real OpenAI calls.
import { expect, test, type APIRequestContext } from "@playwright/test";

const PASSWORD = process.env.DEMO_PASSWORD ?? "";

async function loginContext(playwright: typeof import("@playwright/test"), baseURL: string) {
  const context = await playwright.request.newContext({ baseURL });
  const response = await context.post("/api/auth/login", {
    data: { password: PASSWORD },
  });
  expect(response.ok()).toBe(true);
  return context;
}

async function createNotebook(context: APIRequestContext, title: string): Promise<string> {
  const response = await context.post("/api/notebooks", { data: { title } });
  expect(response.status()).toBe(201);
  return (await response.json()).notebook.id;
}

test.describe("Zugriffsschutz", () => {
  let baseURL: string;
  let sessionA: APIRequestContext;
  let sessionB: APIRequestContext;
  let notebookA: string;

  test.beforeAll(async ({ playwright }, testInfo) => {
    baseURL = testInfo.project.use.baseURL!;
    sessionA = await loginContext(playwright as never, baseURL);
    sessionB = await loginContext(playwright as never, baseURL);
    notebookA = await createNotebook(sessionA, `IDOR-Test ${Date.now()}`);
  });

  test.afterAll(async ({ playwright }) => {
    await sessionA.delete(`/api/notebooks/${notebookA}`);
    await sessionA.dispose();
    await sessionB.dispose();
    void playwright;
  });

  test("ohne Cookie antworten alle Datenrouten mit 401", async ({ playwright }) => {
    const anonymous = await playwright.request.newContext({ baseURL });
    for (const [method, url] of [
      ["get", "/api/notebooks"],
      ["post", "/api/notebooks"],
      ["get", `/api/notebooks/${notebookA}`],
      ["delete", `/api/notebooks/${notebookA}`],
      ["get", `/api/notebooks/${notebookA}/sources`],
      ["get", `/api/notebooks/${notebookA}/messages`],
      ["post", `/api/notebooks/${notebookA}/chat`],
      ["delete", `/api/sources/${notebookA}`],
    ] as const) {
      const response = await anonymous[method](url, { data: {} });
      expect(response.status(), `${method.toUpperCase()} ${url}`).toBe(401);
    }
    await anonymous.dispose();
  });

  test("falsches Passwort wird abgelehnt", async ({ playwright }) => {
    // Own rate-limit bucket so repeated runs never trip the login limit.
    const fakeIp = `wrongpw-${Date.now()}`;
    const context = await playwright.request.newContext({
      baseURL,
      extraHTTPHeaders: { "x-forwarded-for": fakeIp },
    });
    const response = await context.post("/api/auth/login", {
      data: { password: "definitiv-falsch" },
    });
    expect(response.status()).toBe(401);
    const { createClient } = await import("@supabase/supabase-js");
    await createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false },
    })
      .from("rate_limits")
      .delete()
      .eq("key", `login:${fakeIp}`);
    await context.dispose();
  });

  test("Logout invalidiert die Session serverseitig (kopiertes Cookie wird wertlos)", async ({ playwright }) => {
    const context = await playwright.request.newContext({ baseURL });
    await context.post("/api/auth/login", { data: { password: PASSWORD } });
    const cookie = (await context.storageState()).cookies.find(
      (c) => c.name === "nb_session"
    )!;
    expect((await context.get("/api/notebooks")).status()).toBe(200);
    await context.post("/api/auth/logout");

    // A copy of the pre-logout cookie must be rejected: the session row is gone.
    const stolen = await playwright.request.newContext({
      baseURL,
      extraHTTPHeaders: { cookie: `nb_session=${cookie.value}` },
    });
    expect((await stolen.get("/api/notebooks")).status()).toBe(401);
    await stolen.dispose();
    await context.dispose();
  });

  test("fremde Sessions sehen und ändern nichts (IDOR)", async () => {
    expect((await sessionB.get(`/api/notebooks/${notebookA}`)).status()).toBe(404);
    expect((await sessionB.get(`/api/notebooks/${notebookA}/sources`)).status()).toBe(404);
    expect((await sessionB.get(`/api/notebooks/${notebookA}/messages`)).status()).toBe(404);
    expect((await sessionB.delete(`/api/notebooks/${notebookA}`)).status()).toBe(404);
    expect(
      (
        await sessionB.post(`/api/notebooks/${notebookA}/chat`, {
          data: { question: "Was steht in fremden Quellen?" },
        })
      ).status()
    ).toBe(404);
    expect(
      (
        await sessionB.post(`/api/notebooks/${notebookA}/sources`, {
          multipart: {
            file: { name: "x.txt", mimeType: "text/plain", buffer: Buffer.from("Inhalt.") },
          },
        })
      ).status()
    ).toBe(404);

    // Die Notebook-Liste von B enthält A's Notebook nicht.
    const listB = await (await sessionB.get("/api/notebooks")).json();
    expect(
      listB.notebooks.some((n: { id: string }) => n.id === notebookA)
    ).toBe(false);

    // Der Eigentümer kann weiterhin zugreifen.
    expect((await sessionA.get(`/api/notebooks/${notebookA}`)).status()).toBe(200);
  });

  test("Upload-Validierung: Typ, Größe, leere Datei", async () => {
    const tooBig = await sessionA.post(`/api/notebooks/${notebookA}/sources`, {
      multipart: {
        file: {
          name: "gross.txt",
          mimeType: "text/plain",
          buffer: Buffer.alloc(5 * 1024 * 1024 + 1, 97),
        },
      },
    });
    expect(tooBig.status()).toBe(400);

    const wrongType = await sessionA.post(`/api/notebooks/${notebookA}/sources`, {
      multipart: {
        file: { name: "datei.exe", mimeType: "text/plain", buffer: Buffer.from("MZ") },
      },
    });
    expect(wrongType.status()).toBe(400);

    const empty = await sessionA.post(`/api/notebooks/${notebookA}/sources`, {
      multipart: {
        file: { name: "leer.txt", mimeType: "text/plain", buffer: Buffer.alloc(0) },
      },
    });
    expect(empty.status()).toBe(400);
  });

  test("höchstens 10 Quellen pro Notebook", async ({ playwright }) => {
    const context = await loginContext(playwright as never, baseURL);
    const notebookId = await createNotebook(context, `Limit-Test ${Date.now()}`);
    for (let i = 0; i < 10; i++) {
      const response = await context.post(`/api/notebooks/${notebookId}/sources`, {
        multipart: {
          file: {
            name: `quelle-${i}.txt`,
            mimeType: "text/plain",
            buffer: Buffer.from(`Inhalt der Testquelle Nummer ${i}.`),
          },
        },
      });
      expect(response.status(), `Upload ${i + 1}`).toBe(201);
    }
    const eleventh = await context.post(`/api/notebooks/${notebookId}/sources`, {
      multipart: {
        file: { name: "elf.txt", mimeType: "text/plain", buffer: Buffer.from("Zu viel.") },
      },
    });
    expect(eleventh.status()).toBe(400);
    expect((await eleventh.json()).error).toContain("höchstens 10 Quellen");

    expect((await context.delete(`/api/notebooks/${notebookId}`)).status()).toBe(200);
    await context.dispose();
  });

  test("Chat ohne Quellenauswahl liefert eine klare Fehlermeldung", async ({ playwright }) => {
    const context = await loginContext(playwright as never, baseURL);
    const notebookId = await createNotebook(context, `Leer-Test ${Date.now()}`);

    // Missing and empty selections are rejected; they never mean "all sources".
    for (const data of [
      { question: "Was steht in den Quellen?" },
      { question: "Was steht in den Quellen?", sourceIds: [] },
    ]) {
      const response = await context.post(`/api/notebooks/${notebookId}/chat`, { data });
      expect(response.status()).toBe(400);
      expect((await response.json()).error).toContain("Keine Quelle ausgewählt");
    }

    // A selection that only contains foreign/unknown ids is rejected too.
    const foreign = await context.post(`/api/notebooks/${notebookId}/chat`, {
      data: { question: "Frage?", sourceIds: [crypto.randomUUID()] },
    });
    expect(foreign.status()).toBe(400);
    expect((await foreign.json()).error).toContain("Keine der ausgewählten Quellen");

    await context.delete(`/api/notebooks/${notebookId}`);
    await context.dispose();
  });
});
