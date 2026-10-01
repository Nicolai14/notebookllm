import "server-only";
import { getDb, STORAGE_BUCKET } from "./client";
import { getNotebook } from "./notebooks";
import { NotFoundError } from "@/lib/errors";
import { isUuid } from "@/lib/uuid";
import { MAX_PROCESSING_MS } from "@/lib/limits";
import type { SourceRow, SourceStatus } from "./types";

export async function listSources(
  sessionId: string,
  notebookId: string
): Promise<SourceRow[]> {
  await getNotebook(sessionId, notebookId);
  await failStaleProcessing(notebookId);
  const { data, error } = await getDb()
    .from("sources")
    .select("*")
    .eq("notebook_id", notebookId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data;
}

/**
 * Safety net: processing happens inside the upload request, so a source should
 * never stay in pending/processing longer than the processing timeout. If the
 * process crashed mid-request, mark the source as failed instead of leaving it
 * stuck forever.
 */
async function failStaleProcessing(notebookId: string): Promise<void> {
  const cutoff = new Date(Date.now() - MAX_PROCESSING_MS * 2).toISOString();
  const { error } = await getDb()
    .from("sources")
    .update({
      status: "error",
      error_message: "Die Verarbeitung wurde unerwartet unterbrochen.",
      updated_at: new Date().toISOString(),
    })
    .eq("notebook_id", notebookId)
    .in("status", ["pending", "processing"])
    .lt("updated_at", cutoff);
  if (error) throw error;
}

export async function countSources(notebookId: string): Promise<number> {
  const { count, error } = await getDb()
    .from("sources")
    .select("id", { count: "exact", head: true })
    .eq("notebook_id", notebookId);
  if (error) throw error;
  return count ?? 0;
}

export async function createSource(source: {
  notebook_id: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  storage_path: string;
}): Promise<SourceRow> {
  const { data, error } = await getDb()
    .from("sources")
    .insert(source)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function updateSourceStatus(
  sourceId: string,
  status: SourceStatus,
  fields: {
    error_message?: string | null;
    page_count?: number | null;
    extracted_chars?: number | null;
  } = {}
): Promise<void> {
  const { error } = await getDb()
    .from("sources")
    .update({ status, updated_at: new Date().toISOString(), ...fields })
    .eq("id", sourceId);
  if (error) throw error;
}

/** Fetches a source only if it belongs to a notebook of this session. */
export async function getSource(
  sessionId: string,
  sourceId: string
): Promise<SourceRow> {
  if (!isUuid(sourceId)) throw new NotFoundError("Quelle nicht gefunden.");
  const { data, error } = await getDb()
    .from("sources")
    .select("*, notebooks!inner(session_id)")
    .eq("id", sourceId)
    .eq("notebooks.session_id", sessionId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new NotFoundError("Quelle nicht gefunden.");
  const { notebooks: _ignored, ...source } = data;
  return source as SourceRow;
}

export async function deleteSource(
  sessionId: string,
  sourceId: string
): Promise<void> {
  const source = await getSource(sessionId, sourceId);
  const db = getDb();
  const { error: removeError } = await db.storage
    .from(STORAGE_BUCKET)
    .remove([source.storage_path]);
  if (removeError) throw removeError;
  const { error } = await db.from("sources").delete().eq("id", source.id);
  if (error) throw error;
}
