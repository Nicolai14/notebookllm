// Live evaluation against the real OpenAI configuration (docs/architecture.md
// section 8). Starts a production server, runs the versioned dataset and
// writes a JSON result file plus a Markdown report under docs/eval/.
//
// Check methods are labeled: "auto" (deterministic assertion) or
// "ai-reviewer" (judged by the configured chat model; NOT a human review).
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument, StandardFonts } from "pdf-lib";
import OpenAI from "openai";
import { CASES, DOCUMENTS, REFUSAL_PATTERNS } from "./dataset.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
process.loadEnvFile(join(root, ".env"));

const PORT = 3190;
const BASE = `http://127.0.0.1:${PORT}`;
const now = new Date();
const DATE = `${now.toISOString().slice(0, 10)}-${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}`;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
// Judge model may differ from the system under test; falls back to the same
// model (self-evaluation), which the report flags explicitly.
const JUDGE_MODEL = process.env.OPENAI_JUDGE_MODEL || process.env.OPENAI_CHAT_MODEL;
const judgeUsage = { prompt: 0, completion: 0, calls: 0 };

// ---------------------------------------------------------------- server ----
function startServer() {
  const child = spawn("npx", ["next", "start", "-p", String(PORT)], {
    cwd: root,
    env: { ...process.env, COOKIE_SECURE: "false" },
    stdio: ["ignore", "ignore", "inherit"],
  });
  return child;
}

async function waitForHealth() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("server did not become healthy");
}

// ------------------------------------------------------------------- api ----
let cookie = "";

async function api(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: { ...(options.headers ?? {}), cookie },
  });
  return res;
}

async function login() {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: process.env.DEMO_PASSWORD }),
  });
  if (!res.ok) throw new Error(`login failed: ${res.status}`);
  cookie = (res.headers.get("set-cookie") ?? "").split(";")[0];
}

async function buildDocumentBuffer(name) {
  const doc = DOCUMENTS[name];
  if (doc.pages) {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    for (const text of doc.pages) {
      const page = pdf.addPage([595, 842]);
      page.drawText(text, { x: 50, y: 700, size: 11, font, maxWidth: 480, lineHeight: 16 });
    }
    return Buffer.from(await pdf.save());
  }
  return Buffer.from(doc.content, "utf8");
}

async function createNotebook(title) {
  const res = await api("/api/notebooks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });
  if (res.status !== 201) throw new Error(`createNotebook: ${res.status}`);
  return (await res.json()).notebook.id;
}

async function uploadDocument(notebookId, name) {
  const buffer = await buildDocumentBuffer(name);
  const form = new FormData();
  form.append(
    "file",
    new File([buffer], name, { type: DOCUMENTS[name].type }),
    name
  );
  const res = await api(`/api/notebooks/${notebookId}/sources`, {
    method: "POST",
    body: form,
  });
  const data = await res.json();
  if (res.status !== 201 || data.source.status !== "ready") {
    throw new Error(`upload ${name}: ${res.status} ${data.source?.error_message ?? data.error}`);
  }
  return data.source.id;
}

async function runSse(path, body) {
  const started = Date.now();
  const res = await api(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(`${path}: ${res.status} ${data?.error ?? ""}`);
  }
  let buffer = "";
  let deltas = 0;
  let message = null;
  const decoder = new TextDecoder();
  for await (const chunk of res.body) {
    buffer += decoder.decode(chunk, { stream: true });
    const blocks = buffer.split("\n\n");
    buffer = blocks.pop() ?? "";
    for (const block of blocks) {
      const line = block.trim();
      if (!line.startsWith("data: ")) continue;
      const event = JSON.parse(line.slice(6));
      if (event.type === "delta") deltas += 1;
      if (event.type === "done") message = event.message;
      if (event.type === "error") throw new Error(`stream error: ${event.error}`);
    }
  }
  if (!message) throw new Error("stream ended without done event");
  return { message, deltas, durationMs: Date.now() - started };
}

// ----------------------------------------------------------------- judge ----
async function judge(systemAsk, payload) {
  const res = await openai.chat.completions.create({
    model: JUDGE_MODEL,
    ...(process.env.OPENAI_REASONING_EFFORT
      ? { reasoning_effort: process.env.OPENAI_REASONING_EFFORT }
      : {}),
    max_completion_tokens: 500,
    messages: [
      {
        role: "user",
        content: `${systemAsk}\n\nAntworte AUSSCHLIESSLICH mit einem JSON-Objekt, ohne Markdown.\n\n${payload}`,
      },
    ],
  });
  judgeUsage.calls += 1;
  judgeUsage.prompt += res.usage?.prompt_tokens ?? 0;
  judgeUsage.completion += res.usage?.completion_tokens ?? 0;
  const text = res.choices[0]?.message?.content ?? "{}";
  const match = text.match(/\{[\s\S]*\}/);
  return JSON.parse(match ? match[0] : "{}");
}

async function judgeFaithfulness(question, message) {
  const citations = message.citations
    .map((c) => `[${c.marker}] (${c.filename}) ${c.passage}`)
    .join("\n\n");
  return judge(
    "Du prüfst streng, ob eine Antwort durch die zitierten Passagen belegt ist. " +
      'Format: {"belegt": true/false, "zitate_passend": true/false, "begruendung": "..."}. ' +
      '"belegt": Jede faktische Aussage der Antwort steht sinngemäß in den Passagen. ' +
      '"zitate_passend": Jede zitierte Passage stützt die Aussage, an der ihr Marker steht.',
    `Frage: ${question}\n\nAntwort:\n${message.content}\n\nZitierte Passagen:\n${citations}`
  );
}

async function judgeSummary(message, keyPoints, sourceText) {
  const truncated = sourceText.length > 12_000;
  return judge(
    "Du prüfst eine automatisch erstellte Zusammenfassung gegen den Quelltext. " +
      'Format: {"inhalt_korrekt": true/false, "kernpunkte_abgedeckt": true/false, "fehlende_kernpunkte": ["..."], "begruendung": "..."}. ' +
      '"inhalt_korrekt": Keine Aussage widerspricht dem gezeigten Quelltext oder ist erfunden. ' +
      (truncated
        ? "WICHTIG: Der Quelltext ist gekürzt; werte nur Widersprüche zum gezeigten Teil, nicht fehlende Bestätigung. "
        : "") +
      '"kernpunkte_abgedeckt": Alle genannten Kernpunkte kommen sinngemäß vor.',
    `Erwartete Kernpunkte:\n${keyPoints.map((k) => `- ${k}`).join("\n")}\n\n` +
      `Quelltext${truncated ? " (gekürzt)" : ""}:\n${sourceText.slice(0, 12_000)}\n\nZusammenfassung:\n${message.content}`
  );
}

async function judgeNoCarryOver(question, message, fact) {
  return judge(
    "Im Gesprächsverlauf stand eine frühere Antwort mit einem Fakt, dessen Quelle inzwischen abgewählt ist. " +
      'Format: {"uebernommen": true/false, "begruendung": "..."}. ' +
      '"uebernommen" ist true, wenn die Antwort den Fakt als gültige/belegte Information präsentiert. ' +
      "Es ist false, wenn die Antwort den Fakt gar nicht nennt ODER ihn ausdrücklich als nicht belegt zurückweist.",
    `Fakt aus dem Verlauf: ${fact}\n\nFrage: ${question}\n\nAntwort:\n${message.content}`
  );
}

// ------------------------------------------------------------ evaluation ----
function autoChecks(testCase, message, selectedIds, sourceIdByName) {
  const checks = [];
  const expect = testCase.expect;
  const add = (name, pass, detail = "") =>
    checks.push({ name, method: "auto", pass, detail });

  for (const pattern of expect.mustContain ?? []) {
    add(`enthält ${pattern}`, pattern.test(message.content));
  }
  for (const pattern of expect.mustNotContain ?? []) {
    add(`enthält nicht ${pattern}`, !pattern.test(message.content));
  }
  if (expect.refusal) {
    const refused = REFUSAL_PATTERNS.some((p) => p.test(message.content));
    add("verweigert ohne Grundlage", refused, refused ? "" : message.content.slice(0, 200));
  }
  if (expect.citationFiles) {
    const files = message.citations.map((c) => c.filename);
    add(
      `zitiert nur ${expect.citationFiles.join(", ")}`,
      files.length > 0 && files.every((f) => expect.citationFiles.includes(f)),
      `zitiert: ${files.join(", ") || "nichts"}`
    );
  }
  if (expect.citationFilesInclude) {
    const files = new Set(message.citations.map((c) => c.filename));
    for (const required of expect.citationFilesInclude) {
      add(`zitiert ${required}`, files.has(required));
    }
  }
  if (expect.citationPage) {
    const hit = message.citations.some(
      (c) => c.page_start <= expect.citationPage && expect.citationPage <= (c.page_end ?? c.page_start)
    );
    add(
      `Beleg auf Seite ${expect.citationPage}`,
      hit,
      `Seiten: ${message.citations.map((c) => c.page_start).join(", ") || "keine"}`
    );
  }
  if (expect.citationSectionIncludes) {
    add(
      `Beleg im Abschnitt "${expect.citationSectionIncludes}"`,
      message.citations.some((c) => c.section_path?.includes(expect.citationSectionIncludes)),
      `Abschnitte: ${message.citations.map((c) => c.section_path).join(" | ") || "keine"}`
    );
  }
  if (expect.citationsSubsetOfSelection) {
    add(
      "Zitate nur aus ausgewählten Quellen",
      message.citations.every((c) => selectedIds.includes(c.source_id))
    );
  }
  // Technical citation validity for every case: known source, non-empty passage.
  const validRefs = message.citations.every(
    (c) =>
      typeof c.passage === "string" &&
      c.passage.length > 0 &&
      [...Object.values(sourceIdByName)].includes(c.source_id)
  );
  add("Zitatreferenzen technisch gültig", validRefs);
  return checks;
}

// ------------------------------------------------------------------ main ----
const server = startServer();
const results = [];
try {
  await waitForHealth();
  await login();

  const notebooks = new Map(); // group -> { id, sourceIdByName }

  for (const testCase of CASES) {
    process.stdout.write(`case ${testCase.id} ...\n`);
    let outcome;
    try {
      // Setup failures count as a failed case instead of aborting the run.
      const groupKey = testCase.notebookGroup ?? testCase.id;
      if (!notebooks.has(groupKey)) {
        notebooks.set(groupKey, {
          id: await createNotebook(`Eval ${groupKey}`),
          sourceIdByName: {},
        });
      }
      const notebook = notebooks.get(groupKey);
      for (const doc of testCase.docs ?? []) {
        if (!notebook.sourceIdByName[doc]) {
          process.stdout.write(`  upload ${doc} ...\n`);
          notebook.sourceIdByName[doc] = await uploadDocument(notebook.id, doc);
        }
      }
      const selectedIds = testCase.select.map((name) => {
        const id = notebook.sourceIdByName[name];
        if (!id) throw new Error(`case ${testCase.id}: source ${name} not uploaded`);
        return id;
      });

      const path =
        testCase.kind === "chat"
          ? `/api/notebooks/${notebook.id}/chat`
          : `/api/notebooks/${notebook.id}/summary`;
      const body =
        testCase.kind === "chat"
          ? { question: testCase.question, sourceIds: selectedIds }
          : { sourceIds: selectedIds };

      const { message, deltas, durationMs } = await runSse(path, body);
      const checks = autoChecks(testCase, message, selectedIds, notebook.sourceIdByName);

      if (testCase.expect.judgeFaithfulness && message.citations.length === 0) {
        // An uncited answer must not silently skip the faithfulness judge.
        checks.push({
          name: "Antwort ohne Zitate (Belegtreue nicht prüfbar)",
          method: "auto",
          pass: false,
          detail: message.content.slice(0, 160),
        });
      }
      if (testCase.expect.judgeNoCarryOver) {
        const verdict = await judgeNoCarryOver(
          testCase.question,
          message,
          testCase.expect.judgeNoCarryOver.fact
        );
        checks.push({
          name: "keine unbelegte Übernahme aus dem Verlauf",
          method: "ai-reviewer",
          pass: verdict.uebernommen === false,
          detail: verdict.begruendung ?? "",
        });
      }
      if (testCase.expect.judgeFaithfulness && message.citations.length > 0) {
        const verdict = await judgeFaithfulness(testCase.question, message);
        checks.push({
          name: "Aussagen durch Passagen belegt",
          method: "ai-reviewer",
          pass: verdict.belegt === true,
          detail: verdict.begruendung ?? "",
        });
        checks.push({
          name: "zitierte Passagen passen zur Aussage",
          method: "ai-reviewer",
          pass: verdict.zitate_passend === true,
          detail: verdict.begruendung ?? "",
        });
      }
      if (testCase.expect.judgeSummary) {
        const sourceText = (testCase.docs ?? [])
          .map((d) => DOCUMENTS[d].pages?.join("\n") ?? DOCUMENTS[d].content)
          .join("\n\n");
        const verdict = await judgeSummary(
          message,
          testCase.expect.judgeSummary.keyPoints,
          sourceText
        );
        checks.push({
          name: "Zusammenfassung inhaltlich korrekt",
          method: "ai-reviewer",
          pass: verdict.inhalt_korrekt === true,
          detail: verdict.begruendung ?? "",
        });
        checks.push({
          name: "erwartete Kernpunkte abgedeckt",
          method: "ai-reviewer",
          pass: verdict.kernpunkte_abgedeckt === true,
          detail: (verdict.fehlende_kernpunkte ?? []).join("; "),
        });
      }

      outcome = {
        id: testCase.id,
        kind: testCase.kind,
        durationMs,
        deltas,
        answerChars: message.content.length,
        estimatedAnswerTokens: Math.ceil(message.content.length / 4),
        citations: message.citations.map((c) => ({
          marker: c.marker,
          filename: c.filename,
          page_start: c.page_start,
          section_path: c.section_path,
        })),
        answer: message.content,
        checks,
        pass: checks.every((c) => c.pass),
      };
    } catch (err) {
      outcome = {
        id: testCase.id,
        kind: testCase.kind,
        error: String(err),
        checks: [],
        pass: false,
      };
    }
    results.push(outcome);
    process.stdout.write(`  -> ${outcome.pass ? "PASS" : "FAIL"}\n`);
  }

  // Cleanup: delete all eval notebooks.
  for (const { id } of notebooks.values()) {
    await api(`/api/notebooks/${id}`, { method: "DELETE" });
  }
} finally {
  server.kill();
}

// ---------------------------------------------------------------- report ----
mkdirSync(join(root, "docs", "eval"), { recursive: true });
writeFileSync(
  join(root, "docs", "eval", `results-${DATE}.json`),
  JSON.stringify({ results, judgeUsage }, null, 2)
);

const passed = results.filter((r) => r.pass).length;
const lines = [];
lines.push(`# Live-Evaluation ${DATE}`);
lines.push("");
lines.push(
  `Modell: \`${process.env.OPENAI_CHAT_MODEL}\` (reasoning_effort=${process.env.OPENAI_REASONING_EFFORT ?? "nicht gesetzt"}), ` +
    `Embeddings: \`${process.env.OPENAI_EMBEDDING_MODEL}\` (${process.env.OPENAI_EMBEDDING_DIMENSIONS}). ` +
    `Echte OpenAI-Aufrufe, kein Mock. Prüfmethoden: "auto" = deterministische Prüfung, ` +
    `"ai-reviewer" = Bewertung durch \`${JUDGE_MODEL}\`` +
    (JUDGE_MODEL === process.env.OPENAI_CHAT_MODEL
      ? " (identisch mit dem geprüften Modell, also Selbstbewertung; keine menschliche Prüfung)."
      : " (keine menschliche Prüfung).")
);
lines.push("");
lines.push(`**Ergebnis: ${passed}/${results.length} Fälle bestanden.**`);
lines.push("");
lines.push("| Fall | Art | Dauer | Antwort-Tokens (Schätzung) | Ergebnis |");
lines.push("|---|---|---|---|---|");
for (const r of results) {
  lines.push(
    `| ${r.id} | ${r.kind} | ${r.durationMs ? (r.durationMs / 1000).toFixed(1) + " s" : "-"} | ${r.estimatedAnswerTokens ?? "-"} | ${r.pass ? "PASS" : "FAIL"} |`
  );
}
lines.push("");
lines.push("## Einzelprüfungen");
lines.push("");
for (const r of results) {
  lines.push(`### ${r.id} (${r.pass ? "PASS" : "FAIL"})`);
  if (r.error) lines.push(`Fehler: ${r.error}`);
  for (const c of r.checks ?? []) {
    lines.push(`- [${c.pass ? "x" : " "}] (${c.method}) ${c.name}${c.detail ? ` — ${c.detail}` : ""}`);
  }
  if (!r.pass && r.answer) {
    lines.push("");
    lines.push("Antwort (Auszug):");
    lines.push("```");
    lines.push(r.answer.slice(0, 600));
    lines.push("```");
  }
  lines.push("");
}
lines.push("## Token-Nutzung");
lines.push("");
lines.push(
  `Die Anwendung erfasst die exakte Token-Nutzung ihrer OpenAI-Aufrufe nicht; ` +
    `angegeben sind Schätzungen (~4 Zeichen/Token) für die Antworten. ` +
    `Exakt gemessen wurden die Judge-Aufrufe des AI-Reviewers: ${judgeUsage.calls} Aufrufe, ` +
    `${judgeUsage.prompt} Prompt-Tokens, ${judgeUsage.completion} Completion-Tokens.`
);
lines.push("");
writeFileSync(join(root, "docs", "eval", `report-${DATE}.md`), lines.join("\n"));

console.log(`\n${passed}/${results.length} Fälle bestanden. Report: docs/eval/report-${DATE}.md`);
process.exit(passed === results.length ? 0 : 1);
