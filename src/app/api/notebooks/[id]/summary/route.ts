import { handleRoute } from "@/lib/api";
import { requireSession } from "@/lib/auth/current";
import { getConfig } from "@/lib/config";
import { getNotebook } from "@/lib/db/notebooks";
import { listSources } from "@/lib/db/sources";
import { listChunksBySources } from "@/lib/db/chunks";
import { insertMessage } from "@/lib/db/messages";
import { ensureEmbeddingConfigMatches } from "@/lib/db/embeddingConfig";
import { AiDisabledError, AppError, ValidationError } from "@/lib/errors";
import {
  MAX_OUTPUT_TOKENS,
  RATE_LIMIT_AI,
  RATE_LIMIT_AI_GLOBAL,
  SUMMARY_MAP_OUTPUT_TOKENS,
} from "@/lib/limits";
import { enforceRateLimit } from "@/lib/db/rateLimits";
import { getOpenAI, toAiServiceError } from "@/lib/openai";
import { validateCitations } from "@/lib/rag/citations";
import {
  buildOmissionNote,
  buildSummaryDirectPrompt,
  buildSummaryMapPrompt,
  buildSummaryReducePrompt,
  planSummary,
} from "@/lib/rag/summary";
import { chunkLocationLabel } from "@/lib/rag/prompt";
import type { MessageRow } from "@/lib/db/types";

export const maxDuration = 120;

type Params = { params: Promise<{ id: string }> };

interface SseEvent {
  type: "delta" | "done" | "error";
  text?: string;
  message?: MessageRow;
  error?: string;
}

export async function POST(request: Request, { params }: Params) {
  return handleRoute(async () => {
    const sessionId = await requireSession();
    const config = getConfig();
    if (!config.AI_FEATURES_ENABLED) throw new AiDisabledError();

    const { id } = await params;
    const notebook = await getNotebook(sessionId, id);

    const body = await request.json().catch(() => null);
    const requestedIds: unknown = body?.sourceIds;
    if (!Array.isArray(requestedIds) || requestedIds.length === 0) {
      throw new ValidationError(
        "Keine Quelle ausgewählt. Bitte mindestens eine verarbeitete Quelle auswählen."
      );
    }
    const allSources = await listSources(sessionId, notebook.id);
    const readySources = allSources.filter((s) => s.status === "ready");
    const selectedSources = readySources.filter((s) => requestedIds.includes(s.id));
    if (selectedSources.length === 0) {
      throw new ValidationError(
        "Keine der ausgewählten Quellen ist verarbeitet und verfügbar."
      );
    }

    // Counted before any OpenAI call; rejected requests must not reach the API.
    const aiLimitMessage =
      "Das Limit für KI-Anfragen ist erreicht. Bitte später erneut versuchen.";
    await enforceRateLimit(
      "ai-global",
      RATE_LIMIT_AI_GLOBAL.windowSeconds,
      RATE_LIMIT_AI_GLOBAL.max,
      aiLimitMessage
    );
    await enforceRateLimit(
      `ai:${sessionId}`,
      RATE_LIMIT_AI.windowSeconds,
      RATE_LIMIT_AI.max,
      aiLimitMessage
    );

    await ensureEmbeddingConfigMatches();

    const filenameBySource = new Map(selectedSources.map((s) => [s.id, s.filename]));
    const rows = await listChunksBySources(
      notebook.id,
      selectedSources.map((s) => s.id)
    );
    // Deterministic order: sources in upload order (selectedSources is sorted
    // by created_at), chunks in document order. Without this, batching caps
    // would hit a random source (UUID ordering).
    const sourceRank = new Map(selectedSources.map((s, i) => [s.id, i]));
    rows.sort(
      (a, b) =>
        (sourceRank.get(a.source_id) ?? 0) - (sourceRank.get(b.source_id) ?? 0) ||
        a.chunk_index - b.chunk_index
    );
    const plan = planSummary(
      rows.map((row) => ({
        ...row,
        filename: filenameBySource.get(row.source_id) ?? "Unbekannte Datei",
      }))
    );
    if (plan.included.length === 0) {
      throw new ValidationError("Die ausgewählten Quellen enthalten keine Inhalte.");
    }

    await insertMessage({
      notebook_id: notebook.id,
      role: "user",
      content: `Zusammenfassung der ausgewählten Quellen: ${selectedSources
        .map((s) => s.filename)
        .join(", ")}`,
    });

    const openai = getOpenAI();
    const encoder = new TextEncoder();
    // Client disconnects must neither crash the stream nor burn further tokens.
    let clientGone = false;
    const stream = new ReadableStream<Uint8Array>({
      cancel() {
        clientGone = true;
      },
      async start(controller) {
        const send = (event: SseEvent) => {
          if (clientGone) return;
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
          } catch {
            clientGone = true;
          }
        };
        try {
          let finalPrompt: string;
          const omissions = [...plan.omissions];
          let allowedMarkers: Set<number> | null = null;

          if (plan.mode === "direct") {
            finalPrompt = buildSummaryDirectPrompt(plan.included);
          } else {
            // Bounded map phase (no streaming), then a streamed reduce call.
            const runMapCall = async (batch: (typeof plan.batches)[number]) => {
              const completion = await openai.chat.completions.create({
                model: config.OPENAI_CHAT_MODEL,
                max_completion_tokens: SUMMARY_MAP_OUTPUT_TOKENS,
                ...(config.OPENAI_REASONING_EFFORT
                  ? { reasoning_effort: config.OPENAI_REASONING_EFFORT }
                  : {}),
                messages: [
                  {
                    role: "user",
                    content: buildSummaryMapPrompt(batch.filename, batch.chunks),
                  },
                ],
              });
              const choice = completion.choices[0];
              if (choice?.finish_reason === "length") {
                console.warn(`summary map call truncated (batch ${batch.filename})`);
              }
              return choice?.message?.content ?? "";
            };
            const partials = await Promise.all(
              plan.batches.map(async (batch) => {
                try {
                  let text = await runMapCall(batch);
                  // Reasoning models occasionally burn the whole completion
                  // budget on reasoning and return no content: retry once.
                  if (text.trim().length === 0) {
                    console.warn(`summary map call empty, retrying (${batch.filename})`);
                    text = await runMapCall(batch);
                  }
                  return { batch, text };
                } catch (err) {
                  throw toAiServiceError(err);
                }
              })
            );

            // An empty map result silently drops a whole batch: surface it as
            // an explicit omission instead.
            const usable = partials.filter((p) => p.text.trim().length > 0);
            for (const { batch } of partials.filter((p) => p.text.trim().length === 0)) {
              omissions.push({
                filename: batch.filename,
                fromLabel: chunkLocationLabel(batch.chunks[0]),
                entireSource: false,
              });
            }
            if (usable.length === 0) {
              throw new AppError(
                "Die Zusammenfassung konnte nicht erstellt werden (keine verwertbaren Zwischenergebnisse). Bitte erneut versuchen.",
                502
              );
            }

            // The reduce step may only reuse markers that actually appear in
            // the map results; everything else is stripped before validation.
            allowedMarkers = new Set();
            for (const { text } of usable) {
              for (const match of text.matchAll(/\[(\d+)\]/g)) {
                allowedMarkers.add(Number(match[1]));
              }
            }
            finalPrompt = buildSummaryReducePrompt(usable.map((p) => p.text));
          }

          let fullText = "";
          try {
            const completion = await openai.chat.completions.create({
              model: config.OPENAI_CHAT_MODEL,
              stream: true,
              max_completion_tokens: MAX_OUTPUT_TOKENS,
              ...(config.OPENAI_REASONING_EFFORT
                ? { reasoning_effort: config.OPENAI_REASONING_EFFORT }
                : {}),
              messages: [{ role: "user", content: finalPrompt }],
            });
            for await (const part of completion) {
              if (clientGone) {
                completion.controller.abort();
                break;
              }
              const delta = part.choices[0]?.delta?.content ?? "";
              if (delta) {
                fullText += delta;
                send({ type: "delta", text: delta });
              }
            }
          } catch (err) {
            throw toAiServiceError(err);
          }

          // A disconnected client gets no persisted half summary.
          if (clientGone) return;

          if (allowedMarkers) {
            const allowed = allowedMarkers;
            fullText = fullText.replace(/\[(\d+)\]/g, (match, digits: string) =>
              allowed.has(Number(digits)) ? match : ""
            );
          }
          const { content, citations } = validateCitations(fullText, plan.included);
          const finalContent = content + buildOmissionNote(omissions);
          const saved = await insertMessage({
            notebook_id: notebook.id,
            role: "assistant",
            content: finalContent,
            citations,
          });
          send({ type: "done", message: saved });
        } catch (err) {
          if (!(err instanceof AppError)) {
            console.error("summary stream error:", err);
          }
          send({
            type: "error",
            error:
              err instanceof AppError
                ? err.message
                : "Die Zusammenfassung konnte nicht erstellt werden. Bitte erneut versuchen.",
          });
        } finally {
          if (!clientGone) {
            try {
              controller.close();
            } catch {
              // already closed by the runtime after a client disconnect
            }
          }
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  });
}
