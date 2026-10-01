import "server-only";
import OpenAI from "openai";
import { getConfig } from "@/lib/config";
import { AppError } from "@/lib/errors";
import { EMBEDDING_BATCH_SIZE } from "@/lib/limits";

/**
 * Maps failures at OpenAI call sites to a clear German message instead of a
 * generic 500. Only use directly around SDK calls: any error there is an API,
 * quota or connection problem (instanceof checks on the SDK's error classes
 * are unreliable across bundler chunks).
 */
export function toAiServiceError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  const status = (err as { status?: unknown })?.status;
  console.error(
    `OpenAI call failed${typeof status === "number" ? ` (${status})` : ""}:`,
    err instanceof Error ? err.message : err
  );
  return new AppError(
    "Der KI-Dienst ist derzeit nicht verfügbar (Kontingent oder Verbindung). Bitte später erneut versuchen.",
    503
  );
}

let client: OpenAI | null = null;

export function getOpenAI(): OpenAI {
  if (client) return client;
  const config = getConfig();
  client = new OpenAI({
    apiKey: config.OPENAI_API_KEY,
    // Only set in tests to point at the local mock server.
    baseURL: config.OPENAI_BASE_URL,
  });
  return client;
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
  const config = getConfig();
  const openai = getOpenAI();
  const result: number[][] = [];
  for (let i = 0; i < texts.length; i += EMBEDDING_BATCH_SIZE) {
    const batch = texts.slice(i, i + EMBEDDING_BATCH_SIZE);
    try {
      const response = await openai.embeddings.create({
        model: config.OPENAI_EMBEDDING_MODEL,
        input: batch,
        dimensions: config.OPENAI_EMBEDDING_DIMENSIONS,
      });
      for (const item of response.data) result.push(item.embedding);
    } catch (err) {
      throw toAiServiceError(err);
    }
  }
  return result;
}
