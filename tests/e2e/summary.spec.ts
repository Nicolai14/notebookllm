// M5: summary over the selected sources (OpenAI mock). Covers the direct path,
// the staged path for long sources, selection restriction and empty selection.
import { expect, test, type APIRequestContext } from "@playwright/test";

const PASSWORD = process.env.DEMO_PASSWORD ?? "";

async function finalMessage(response: { text(): Promise<string> }) {
  for (const block of (await response.text()).split("\n\n")) {
    const line = block.trim();
    if (!line.startsWith("data: ")) continue;
    const event = JSON.parse(line.slice(6));
    if (event.type === "done") return event.message;
    if (event.type === "error") throw new Error(event.error);
  }
  throw new Error("no done event in stream");
}

test.describe("Zusammenfassung", () => {
  let baseURL: string;
  let session: APIRequestContext;
  let notebookId: string;
  let sourceA: string;
  let sourceB: string;

  async function uploadTxt(name: string, content: string): Promise<string> {
    const response = await session.post(`/api/notebooks/${notebookId}/sources`, {
      multipart: { file: { name, mimeType: "text/plain", buffer: Buffer.from(content) } },
    });
    expect(response.status()).toBe(201);
    const { source } = await response.json();
    expect(source.status).toBe("ready");
    return source.id;
  }

  test.beforeAll(async ({ playwright }, testInfo) => {
    baseURL = testInfo.project.use.baseURL!;
    session = await playwright.request.newContext({ baseURL });
    await session.post("/api/auth/login", { data: { password: PASSWORD } });
    const created = await session.post("/api/notebooks", {
      data: { title: `M5-Zusammenfassung ${Date.now()}` },
    });
    notebookId = (await created.json()).notebook.id;
    sourceA = await uploadTxt(
      "anlage.txt",
      "Die Anlage produziert täglich zweihundert Einheiten im Dreischichtbetrieb."
    );
    sourceB = await uploadTxt(
      "personal.txt",
      "Das Personal durchläuft jährlich eine zweitägige Sicherheitsschulung."
    );
  });

  test.afterAll(async () => {
    await session.delete(`/api/notebooks/${notebookId}`);
    await session.dispose();
  });

  test("direkter Pfad referenziert beide Quellen und entfernt erfundene Marker", async () => {
    const message = await finalMessage(
      await session.post(`/api/notebooks/${notebookId}/summary`, {
        data: { sourceIds: [sourceA, sourceB] },
      })
    );
    const filenames = message.citations.map((c: { filename: string }) => c.filename);
    expect(filenames).toContain("anlage.txt");
    expect(filenames).toContain("personal.txt");
    expect(message.content).not.toContain("[77]");
    // The summary is persisted in the notebook history.
    const history = await (
      await session.get(`/api/notebooks/${notebookId}/messages`)
    ).json();
    const last = history.messages[history.messages.length - 1];
    expect(last.role).toBe("assistant");
    expect(last.content).toBe(message.content);
  });

  test("Auswahl beschränkt die Zusammenfassung auf die gewählte Quelle", async () => {
    const message = await finalMessage(
      await session.post(`/api/notebooks/${notebookId}/summary`, {
        data: { sourceIds: [sourceB] },
      })
    );
    expect(message.citations.length).toBeGreaterThan(0);
    for (const citation of message.citations) {
      expect(citation.filename).toBe("personal.txt");
      expect(citation.source_id).toBe(sourceB);
    }
  });

  test("leere oder fehlende Auswahl wird abgewiesen", async () => {
    for (const data of [{}, { sourceIds: [] }]) {
      const response = await session.post(`/api/notebooks/${notebookId}/summary`, { data });
      expect(response.status()).toBe(400);
      expect((await response.json()).error).toContain("Keine Quelle ausgewählt");
    }
  });

  test("fremde Sessions können keine Zusammenfassung fremder Notebooks anstoßen", async ({ playwright }) => {
    const other = await playwright.request.newContext({ baseURL });
    await other.post("/api/auth/login", { data: { password: PASSWORD } });
    const response = await other.post(`/api/notebooks/${notebookId}/summary`, {
      data: { sourceIds: [sourceA] },
    });
    expect(response.status()).toBe(404);
    await other.dispose();
  });

  test("langer Text nutzt den mehrstufigen Pfad und bleibt zitierbar", async ({ playwright }) => {
    const context = await playwright.request.newContext({ baseURL });
    await context.post("/api/auth/login", { data: { password: PASSWORD } });
    const created = await context.post("/api/notebooks", {
      data: { title: `M5-Lang ${Date.now()}` },
    });
    const longNotebook = (await created.json()).notebook.id;

    // ~40k characters => ~10k estimated tokens: beyond the direct budget.
    const paragraphs = Array.from(
      { length: 100 },
      (_, i) =>
        `Abschnitt ${i + 1}: Der Prozessschritt Nummer ${i + 1} dauert zwölf Minuten und wird protokolliert. `.repeat(4)
    );
    const upload = await context.post(`/api/notebooks/${longNotebook}/sources`, {
      multipart: {
        file: {
          name: "prozesse.txt",
          mimeType: "text/plain",
          buffer: Buffer.from(paragraphs.join("\n\n")),
        },
      },
    });
    expect(upload.status()).toBe(201);
    const sourceId = (await upload.json()).source.id;

    const message = await finalMessage(
      await context.post(`/api/notebooks/${longNotebook}/summary`, {
        data: { sourceIds: [sourceId] },
      })
    );
    expect(message.citations.length).toBeGreaterThan(0);
    for (const citation of message.citations) {
      expect(citation.filename).toBe("prozesse.txt");
      expect(citation.passage.length).toBeGreaterThan(0);
    }

    await context.delete(`/api/notebooks/${longNotebook}`);
    await context.dispose();
  });
});
