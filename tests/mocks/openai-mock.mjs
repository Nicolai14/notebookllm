// Minimal OpenAI-compatible mock for deterministic E2E tests.
// - /v1/embeddings: bag-of-words vectors, so shared words = high similarity.
// - /v1/chat/completions: streams a fixed German answer that cites [1] and
//   also emits the invalid marker [9] to exercise server-side validation.
import { createServer } from "node:http";

const PORT = Number(process.env.MOCK_PORT ?? 4100);

function hashWord(word) {
  let hash = 5381;
  for (let i = 0; i < word.length; i++) {
    hash = ((hash << 5) + hash + word.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function embed(text, dimensions) {
  const vector = new Array(dimensions).fill(0);
  const words = text
    .toLowerCase()
    .replace(/[^a-zäöüß0-9\s]/gi, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2);
  for (const word of words) {
    vector[hashWord(word) % dimensions] += 1;
  }
  const norm = Math.sqrt(vector.reduce((acc, v) => acc + v * v, 0)) || 1;
  return vector.map((v) => v / norm);
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(JSON.parse(data || "{}")));
  });
}

const ANSWER_PARTS = [
  "Die Wartung der Biomassekessel erfolgt ",
  "jährlich im Juli, weil dann der Wärmebedarf ",
  "am geringsten ist [1]. Diese Angabe ist frei erfunden [9].",
];

const server = createServer(async (req, res) => {
  const body = await readBody(req);

  if (req.url?.endsWith("/embeddings")) {
    const inputs = Array.isArray(body.input) ? body.input : [body.input];
    const dimensions = body.dimensions ?? 1536;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        object: "list",
        data: inputs.map((text, index) => ({
          object: "embedding",
          index,
          embedding: embed(String(text), dimensions),
        })),
        model: body.model,
        usage: { prompt_tokens: 0, total_tokens: 0 },
      })
    );
    return;
  }

  if (req.url?.endsWith("/chat/completions")) {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
    });
    const chunk = (delta, finish = null) =>
      `data: ${JSON.stringify({
        id: "mock",
        object: "chat.completion.chunk",
        created: 0,
        model: body.model,
        choices: [{ index: 0, delta, finish_reason: finish }],
      })}\n\n`;
    res.write(chunk({ role: "assistant" }));
    for (const part of ANSWER_PARTS) {
      res.write(chunk({ content: part }));
    }
    res.write(chunk({}, "stop"));
    res.write("data: [DONE]\n\n");
    res.end();
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: { message: `no mock for ${req.url}` } }));
});

server.listen(PORT, () => {
  console.log(`openai mock listening on :${PORT}`);
});
