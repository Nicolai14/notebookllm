import { handleRoute } from "@/lib/api";
import { requireSession } from "@/lib/auth/current";
import { getConfig } from "@/lib/config";
import { getNotebook } from "@/lib/db/notebooks";
import { listSources } from "@/lib/db/sources";
import { listChunksBySources } from "@/lib/db/chunks";
import { insertMessage } from "@/lib/db/messages";
import { ensureEmbeddingConfigMatches } from "@/lib/db/embeddingConfig";
import { AiDisabledError, AppError, ValidationError } from "@/lib/errors";
import { MAX_OUTPUT_TOKENS, SUMMARY_MAP_OUTPUT_TOKENS } from "@/lib/limits";
import { getOpenAI, toAiServiceError } from "@/lib/openai";
import { validateCitations } from "@/lib/rag/citations";
import {
  buildOmissionNote,
  buildSummaryDirectPrompt,
  buildSummaryMapPrompt,
  buildSummaryReducePrompt,
  planSummary,
} from "@/lib/rag/summary";
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

    await ensureEmbeddingConfigMatches();

    const filenameBySource = new Map(selectedSources.map((s) => [s.id, s.filename]));
    const rows = await listChunksBySources(
      notebook.id,
      selectedSources.map((s) => s.id)
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
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (event: SseEvent) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        };
        try {
          let finalPrompt: string;
          if (plan.mode === "direct") {
            finalPrompt = buildSummaryDirectPrompt(plan.included);
          } else {
            // Bounded map phase (no streaming), then a streamed reduce call.
            const partials = await Promise.all(
              plan.batches.map(async (batch) => {
                try {
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
                  return completion.choices[0]?.message?.content ?? "";
                } catch (err) {
                  throw toAiServiceError(err);
                }
              })
            );
            finalPrompt = buildSummaryReducePrompt(partials.filter((p) => p.length > 0));
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
              const delta = part.choices[0]?.delta?.content ?? "";
              if (delta) {
                fullText += delta;
                send({ type: "delta", text: delta });
              }
            }
          } catch (err) {
            throw toAiServiceError(err);
          }

          const { content, citations } = validateCitations(fullText, plan.included);
          const finalContent = content + buildOmissionNote(plan.omissions);
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
          controller.close();
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
