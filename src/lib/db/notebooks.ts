import "server-only";
import { getDb, STORAGE_BUCKET } from "./client";
import { NotFoundError } from "@/lib/errors";
import { isUuid } from "@/lib/uuid";
import type { NotebookRow } from "./types";

export async function listNotebooks(sessionId: string): Promise<NotebookRow[]> {
  const { data, error } = await getDb()
    .from("notebooks")
    .select("*")
    .eq("session_id", sessionId)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return data;
}

export async function createNotebook(
  sessionId: string,
  title: string
): Promise<NotebookRow> {
  const { data, error } = await getDb()
    .from("notebooks")
    .insert({ session_id: sessionId, title })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function getNotebook(
  sessionId: string,
  notebookId: string
): Promise<NotebookRow> {
  if (!isUuid(notebookId)) throw new NotFoundError("Notebook nicht gefunden.");
  const { data, error } = await getDb()
    .from("notebooks")
    .select("*")
    .eq("session_id", sessionId)
    .eq("id", notebookId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new NotFoundError("Notebook nicht gefunden.");
  return data;
}

/** Deletes the notebook, all dependent rows (FK cascade) and stored files. */
export async function deleteNotebook(
  sessionId: string,
  notebookId: string
): Promise<void> {
  const notebook = await getNotebook(sessionId, notebookId);
  const db = getDb();

  const prefix = `${sessionId}/${notebook.id}`;
  const { data: files, error: listError } = await db.storage
    .from(STORAGE_BUCKET)
    .list(prefix);
  if (listError) throw listError;
  if (files && files.length > 0) {
    const { error: removeError } = await db.storage
      .from(STORAGE_BUCKET)
      .remove(files.map((f) => `${prefix}/${f.name}`));
    if (removeError) throw removeError;
  }

  const { error } = await db
    .from("notebooks")
    .delete()
    .eq("session_id", sessionId)
    .eq("id", notebookId);
  if (error) throw error;
}
