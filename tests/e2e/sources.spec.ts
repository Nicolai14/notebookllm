// API-level tests for M3: upload validation of the new types, processing error
// states and the authorized file proxy. Embeddings go to the OpenAI mock.
import { expect, test, type APIRequestContext } from "@playwright/test";
import { PDFDocument, StandardFonts } from "pdf-lib";

const PASSWORD = process.env.DEMO_PASSWORD ?? "";

async function loginContext(playwright: typeof import("@playwright/test"), baseURL: string) {
  const context = await playwright.request.newContext({ baseURL });
  const response = await context.post("/api/auth/login", { data: { password: PASSWORD } });
  expect(response.ok()).toBe(true);
  return context;
}

async function pdfBuffer(texts: (string | null)[]): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const text of texts) {
    const page = doc.addPage([400, 300]);
    if (text) page.drawText(text, { x: 40, y: 200, size: 12, font });
  }
  return Buffer.from(await doc.save());
}

async function upload(
  context: APIRequestContext,
  notebookId: string,
  name: string,
  mimeType: string,
  buffer: Buffer
) {
  return context.post(`/api/notebooks/${notebookId}/sources`, {
    multipart: { file: { name, mimeType, buffer } },
  });
}

test.describe("Quellen: PDF, Markdown, Datei-Proxy", () => {
  let baseURL: string;
  let session: APIRequestContext;
  let notebookId: string;

  test.beforeAll(async ({ playwright }, testInfo) => {
    baseURL = testInfo.project.use.baseURL!;
    session = await loginContext(playwright as never, baseURL);
    const created = await session.post("/api/notebooks", {
      data: { title: `M3-Quellen ${Date.now()}` },
    });
    notebookId = (await created.json()).notebook.id;
  });

  test.afterAll(async () => {
    await session.delete(`/api/notebooks/${notebookId}`);
    await session.dispose();
  });

  test("PDF mit Text wird verarbeitet und trägt die Seitenzahl", async () => {
    const buffer = await pdfBuffer(["Seite eins Inhalt.", "Seite zwei Inhalt."]);
    const response = await upload(session, notebookId, "doku.pdf", "application/pdf", buffer);
    expect(response.status()).toBe(201);
    const { source } = await response.json();
    expect(source.status).toBe("ready");
    expect(source.page_count).toBe(2);
  });

  test("PDF ohne Textebene endet mit verständlicher Meldung", async () => {
    const buffer = await pdfBuffer([null, null]);
    const response = await upload(session, notebookId, "scan.pdf", "application/pdf", buffer);
    expect(response.status()).toBe(201);
    const { source } = await response.json();
    expect(source.status).toBe("error");
    expect(source.error_message).toContain("OCR");
  });

  test("Datei mit PDF-Endung aber falschem Inhalt wird abgelehnt", async () => {
    const response = await upload(
      session,
      notebookId,
      "fake.pdf",
      "application/pdf",
      Buffer.from("kein pdf inhalt")
    );
    expect(response.status()).toBe(400);
    expect((await response.json()).error).toContain("kein gültiges PDF");
  });

  test("Markdown wird verarbeitet", async () => {
    const md = "# Titel\n\n## Abschnitt\n\nInhalt des Abschnitts mit genug Text.";
    const response = await upload(
      session,
      notebookId,
      "notizen.md",
      "text/markdown",
      Buffer.from(md)
    );
    expect(response.status()).toBe(201);
    expect((await response.json()).source.status).toBe("ready");
  });

  test("Datei-Proxy liefert die Datei nur der eigenen Session", async ({ playwright }) => {
    const buffer = await pdfBuffer(["Proxy-Testseite."]);
    const uploaded = await upload(session, notebookId, "proxy.pdf", "application/pdf", buffer);
    const sourceId = (await uploaded.json()).source.id;

    const own = await session.get(`/api/sources/${sourceId}/file`);
    expect(own.status()).toBe(200);
    expect(own.headers()["content-type"]).toContain("application/pdf");
    expect(own.headers()["content-disposition"]).toContain("inline");

    const other = await loginContext(playwright as never, baseURL);
    expect((await other.get(`/api/sources/${sourceId}/file`)).status()).toBe(404);
    await other.dispose();

    const anonymous = await playwright.request.newContext({ baseURL });
    expect((await anonymous.get(`/api/sources/${sourceId}/file`)).status()).toBe(401);
    await anonymous.dispose();
  });

  test("Markdown und TXT werden über den Proxy als reiner Text ausgeliefert", async () => {
    const response = await upload(
      session,
      notebookId,
      "roh.md",
      "text/markdown",
      Buffer.from("# Titel\n\n<script>alert(1)</script> bleibt Text.")
    );
    const sourceId = (await response.json()).source.id;
    const file = await session.get(`/api/sources/${sourceId}/file`);
    expect(file.headers()["content-type"]).toContain("text/plain");
    expect(file.headers()["x-content-type-options"]).toBe("nosniff");
  });
});
