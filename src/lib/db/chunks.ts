import "server-only";
import { getDb } from "./client";
import type { ChunkInsert, MatchedChunk } from "./types";

export async function insertChunks(chunks: ChunkInsert[]): Promise<void> {
  if (chunks.length === 0) return;
  const { error } = await getDb().from("chunks").insert(chunks);
  if (error) throw error;
}

/**
 * Vector search, always scoped to one notebook and an explicit source list.
 * Callers must only pass source ids that were validated against the session.
 */
export async function matchChunks(params: {
  notebookId: string;
  sourceIds: string[];
  queryEmbedding: number[];
  matchCount: number;
  minSimilarity: number;
}): Promise<MatchedChunk[]> {
  if (params.sourceIds.length === 0) return [];
  const { data, error } = await getDb().rpc("match_chunks", {
    p_notebook_id: params.notebookId,
    p_source_ids: params.sourceIds,
    p_query_embedding: params.queryEmbedding,
    p_match_count: params.matchCount,
    p_min_similarity: params.minSimilarity,
  });
  if (error) throw error;
  return data as MatchedChunk[];
}
