import "server-only";
import { getDb } from "./client";
import type { ChunkInsert, MatchedChunk } from "./types";

/**
 * All chunks of the given sources in document order (for summaries, not
 * similarity search). Callers must only pass session-validated source ids.
 */
export async function listChunksBySources(
  notebookId: string,
  sourceIds: string[]
): Promise<Omit<MatchedChunk, "similarity">[]> {
  if (sourceIds.length === 0) return [];
  const { data, error } = await getDb()
    .from("chunks")
    .select("id, source_id, chunk_index, content, page_start, page_end, section_path")
    .eq("notebook_id", notebookId)
    .in("source_id", sourceIds)
    .order("source_id", { ascending: true })
    .order("chunk_index", { ascending: true });
  if (error) throw error;
  return data;
}

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
