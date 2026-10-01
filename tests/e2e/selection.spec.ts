// M4: the source selection verifiably restricts retrieval. Two sources with
// disjoint vocabulary; the question matches source B, but only source A is
// selected, so every citation must come from A. OpenAI mock only.
import { expect, test, type APIRequestContext } from "@playwright/test";

const PASSWORD = process.env.DEMO_PASSWORD ?? "";

async function finalMessage(response: { text(): Promise<string> }) {
  const body = await response.text();
  for (const block of body.split("\n\n")) {
    const line = block.trim();
    if (!line.startsWith("data: ")) continue;
    const event = JSON.parse(line.slice(6));
    if (event.type === "done") return event.message;
    if (event.type === "error") throw new Error(event.error);
  }
  throw new Error("no done event in stream");
}

test("Quellenauswahl schränkt das Retrieval ein", async ({ playwright }, testInfo) => {
  const baseURL = testInfo.project.use.baseURL!;
  const session: APIRequestContext = await playwright.request.newContext({ baseURL });
  await session.post("/api/auth/login", { data: { password: PASSWORD } });

  const created = await session.post("/api/notebooks", {
    data: { title: `M4-Auswahl ${Date.now()}` },
  });
  const notebookId = (await created.json()).notebook.id;

  async function uploadTxt(name: string, content: string): Promise<string> {
    const response = await session.post(`/api/notebooks/${notebookId}/sources`, {
      multipart: {
        file: { name, mimeType: "text/plain", buffer: Buffer.from(content) },
      },
    });
    expect(response.status()).toBe(201);
    const { source } = await response.json();
    expect(source.status).toBe("ready");
    return source.id;
  }

  const pumpenId = await uploadTxt(
    "pumpen.txt",
    "Das Pumpenlager wird vierteljährlich geschmiert und jährlich getauscht."
  );
  const dachId = await uploadTxt(
    "dach.txt",
    "Die Dachziegel bestehen aus Ton und halten etwa fünfzig Jahre."
  );

  const question = "Woraus bestehen die Dachziegel und wie lange halten sie?";

  // Full selection: the best match for the question is dach.txt.
  const both = await finalMessage(
    await session.post(`/api/notebooks/${notebookId}/chat`, {
      data: { question, sourceIds: [pumpenId, dachId] },
    })
  );
  expect(both.citations.length).toBeGreaterThan(0);
  expect(both.citations[0].filename).toBe("dach.txt");

  // Restricted selection: dach.txt is deselected, so no citation may use it.
  // Both legitimate outcomes are asserted explicitly so the test can never
  // pass vacuously: either a grounded refusal (no citations) or an answer
  // backed exclusively by the allowed source.
  const restricted = await finalMessage(
    await session.post(`/api/notebooks/${notebookId}/chat`, {
      data: { question, sourceIds: [pumpenId] },
    })
  );
  expect(restricted.content).not.toContain("Ton");
  if (restricted.citations.length === 0) {
    expect(restricted.content).toMatch(/keine Grundlage|nicht beantwort|keine Angaben/i);
  } else {
    for (const citation of restricted.citations) {
      expect(citation.filename).toBe("pumpen.txt");
      expect(citation.source_id).toBe(pumpenId);
    }
  }

  await session.delete(`/api/notebooks/${notebookId}`);
  await session.dispose();
});
