import "server-only";
import OpenAI from "openai";
import { getConfig } from "@/lib/config";
import { EMBEDDING_BATCH_SIZE } from "@/lib/limits";

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
    const response = await openai.embeddings.create({
      model: config.OPENAI_EMBEDDING_MODEL,
      input: batch,
      dimensions: config.OPENAI_EMBEDDING_DIMENSIONS,
    });
    for (const item of response.data) result.push(item.embedding);
  }
  return result;
}
