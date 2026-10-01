import { handleRoute } from "@/lib/api";
import { requireSession } from "@/lib/auth/current";
import { getConfig } from "@/lib/config";
import { getNotebook } from "@/lib/db/notebooks";
import { listSources } from "@/lib/db/sources";
import { insertMessage, listMessages } from "@/lib/db/messages";
import { AiDisabledError, AppError, ValidationError } from "@/lib/errors";
import {
  CHAT_HISTORY_MAX_TURNS,
  CHAT_HISTORY_TOKEN_BUDGET,
  MAX_OUTPUT_TOKENS,
  MAX_QUESTION_CHARS,
  RATE_LIMIT_AI,
  RATE_LIMIT_AI_GLOBAL,
} from "@/lib/limits";
import { enforceRateLimit } from "@/lib/db/rateLimits";
import { getOpenAI, toAiServiceError } from "@/lib/openai";
import { validateCitations } from "@/lib/rag/citations";
import { buildChatSystemPrompt, NO_ANSWER_TEXT } from "@/lib/rag/prompt";
import { retrieveChunks } from "@/lib/rag/retrieve";
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
    const question = typeof body?.question === "string" ? body.question.trim() : "";
    if (question.length === 0) {
      throw new ValidationError("Bitte eine Frage eingeben.");
    }
    if (question.length > MAX_QUESTION_CHARS) {
      throw new ValidationError(
        `Die Frage darf höchstens ${MAX_QUESTION_CHARS} Zeichen lang sein.`
      );
    }

    // Source selection is mandatory: an empty selection never falls back to
    // "all sources". Only ids of ready sources of this notebook (and therefore
    // this session) survive the filter.
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

    // Counted before any OpenAI call (the question embedding is the first);
    // rejected requests must not reach the API. The global backstop caps
    // total cost even across freshly created sessions.
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

    // History is context only, never evidence: citation markers from earlier
    // assistant turns point at excerpts that are no longer part of the prompt,
    // so they are stripped (user messages stay untouched). The window is
    // bounded by turn count AND an estimated token budget, filled from the
    // most recent message backwards; overlong messages are truncated.
    const history: { role: "user" | "assistant"; content: string }[] = [];
    let historyBudget = CHAT_HISTORY_TOKEN_BUDGET;
    const recent = (await listMessages(sessionId, notebook.id)).slice(
      -CHAT_HISTORY_MAX_TURNS * 2
    );
    for (const m of recent.reverse()) {
      const content =
        m.role === "assistant"
          ? m.content.replace(/\[\d+\]/g, "").replace(/[ \t]{2,}/g, " ")
          : m.content;
      const tokens = Math.ceil(content.length / 4);
      if (tokens > historyBudget) {
        const allowedChars = historyBudget * 4;
        if (allowedChars > 200) {
          history.unshift({ role: m.role, content: content.slice(0, allowedChars) });
        }
        break;
      }
      historyBudget -= tokens;
      history.unshift({ role: m.role, content });
    }
    await insertMessage({ notebook_id: notebook.id, role: "user", content: question });

    const retrieved = await retrieveChunks(question, notebook.id, selectedSources);

    const encoder = new TextEncoder();
    // Client disconnects must neither crash the stream nor burn further
    // tokens: send() becomes a no-op and the delta loop stops.
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
          if (retrieved.length === 0) {
            // No grounding in the selected sources: answer with the fixed
            // refusal text instead of letting the model use general knowledge.
            const saved = await insertMessage({
              notebook_id: notebook.id,
              role: "assistant",
              content: NO_ANSWER_TEXT,
            });
            send({ type: "done", message: saved });
            controller.close();
            return;
          }

          let fullText = "";
          try {
            const completion = await getOpenAI().chat.completions.create({
              model: config.OPENAI_CHAT_MODEL,
              stream: true,
              max_completion_tokens: MAX_OUTPUT_TOKENS,
              // Omitted entirely when unset; models without reasoning support
              // must not receive the parameter.
              ...(config.OPENAI_REASONING_EFFORT
                ? { reasoning_effort: config.OPENAI_REASONING_EFFORT }
                : {}),
              messages: [
                { role: "system", content: buildChatSystemPrompt(retrieved) },
                ...history.map((m) => ({
                  role: m.role,
                  content: m.content,
                })),
                { role: "user", content: question },
              ],
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

          // A disconnected client gets no persisted half answer.
          if (clientGone) return;

          // Validate citations server-side; the client replaces the streamed
          // preview with this final, validated message.
          const { content, citations } = validateCitations(fullText, retrieved);
          const saved = await insertMessage({
            notebook_id: notebook.id,
            role: "assistant",
            content,
            citations,
          });
          send({ type: "done", message: saved });
        } catch (err) {
          if (!(err instanceof AppError)) {
            console.error("chat stream error:", err);
          }
          send({
            type: "error",
            error:
              err instanceof AppError
                ? err.message
                : "Die Antwort konnte nicht erzeugt werden. Bitte erneut versuchen.",
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
