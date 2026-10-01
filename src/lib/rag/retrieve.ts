import "server-only";
import { matchChunks } from "@/lib/db/chunks";
import { embedTexts } from "@/lib/openai";
import { ensureEmbeddingConfigMatches } from "@/lib/db/embeddingConfig";
import {
  CONTEXT_TOKEN_BUDGET,
  RETRIEVAL_MIN_SIMILARITY,
  RETRIEVAL_TOP_K,
} from "@/lib/limits";
import type { SourceRow } from "@/lib/db/types";
import type { RetrievedChunkWithMeta } from "./citations";

/**
 * Retrieval is always scoped to one notebook and a list of sources that the
 * caller has already validated against the session (see chat route).
 */
export async function retrieveChunks(
  question: string,
  notebookId: string,
  sources: SourceRow[]
): Promise<RetrievedChunkWithMeta[]> {
  await ensureEmbeddingConfigMatches();
  const [queryEmbedding] = await embedTexts([question]);
  const matches = await matchChunks({
    notebookId,
    sourceIds: sources.map((s) => s.id),
    queryEmbedding,
    matchCount: RETRIEVAL_TOP_K,
    minSimilarity: RETRIEVAL_MIN_SIMILARITY,
  });

  const filenameBySource = new Map(sources.map((s) => [s.id, s.filename]));
  const result: RetrievedChunkWithMeta[] = [];
  let budget = CONTEXT_TOKEN_BUDGET;
  for (const match of matches) {
    const tokens = Math.ceil(match.content.length / 4);
    // Skip (not break): an oversized chunk must not discard smaller,
    // lower-ranked hits that still fit the budget.
    if (tokens > budget) continue;
    budget -= tokens;
    result.push({
      ...match,
      filename: filenameBySource.get(match.source_id) ?? "Unbekannte Datei",
    });
  }
  return result;
}
