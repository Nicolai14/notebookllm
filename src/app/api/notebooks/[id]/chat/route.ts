import { handleRoute } from "@/lib/api";
import { requireSession } from "@/lib/auth/current";
import { getConfig } from "@/lib/config";
import { getNotebook } from "@/lib/db/notebooks";
import { listSources } from "@/lib/db/sources";
import { insertMessage, listMessages } from "@/lib/db/messages";
import { AiDisabledError, AppError, ValidationError } from "@/lib/errors";
import {
  CHAT_HISTORY_MAX_TURNS,
  MAX_OUTPUT_TOKENS,
  MAX_QUESTION_CHARS,
} from "@/lib/limits";
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

    // Source selection: the client may pass source ids, but only ids that
    // belong to this notebook (and therefore this session) are used.
    const allSources = await listSources(sessionId, notebook.id);
    const readySources = allSources.filter((s) => s.status === "ready");
    const requestedIds: unknown = body?.sourceIds;
    const selectedSources = Array.isArray(requestedIds)
      ? readySources.filter((s) => requestedIds.includes(s.id))
      : readySources;
    if (selectedSources.length === 0) {
      throw new ValidationError(
        "Keine verarbeitete Quelle ausgewählt. Bitte zuerst eine Quelle hochladen bzw. auswählen."
      );
    }

    const history = (await listMessages(sessionId, notebook.id)).slice(
      -CHAT_HISTORY_MAX_TURNS * 2
    );
    await insertMessage({ notebook_id: notebook.id, role: "user", content: question });

    const retrieved = await retrieveChunks(question, notebook.id, selectedSources);

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (event: SseEvent) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
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
              const delta = part.choices[0]?.delta?.content ?? "";
              if (delta) {
                fullText += delta;
                send({ type: "delta", text: delta });
              }
            }
          } catch (err) {
            throw toAiServiceError(err);
          }

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
