// Verifies complete deletion of rows and stored files. Real Supabase, no OpenAI.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createNotebook, deleteNotebook } from "@/lib/db/notebooks";
import { deleteSource } from "@/lib/db/sources";
import {
  adminClient,
  createTestSession,
  deleteTestSession,
  fakeEmbedding,
} from "./helpers";

let db: SupabaseClient;
let sessionId: string;

beforeAll(async () => {
  db = adminClient();
  sessionId = await createTestSession(db);
});

afterAll(async () => {
  await deleteTestSession(db, sessionId);
});

async function createFullSource(notebookId: string, filename: string) {
  const storagePath = `${sessionId}/${notebookId}/${crypto.randomUUID()}`;
  const { error: uploadError } = await db.storage
    .from("sources")
    .upload(storagePath, Buffer.from("Testinhalt."), { contentType: "text/plain" });
  if (uploadError) throw uploadError;

  const { data: source, error } = await db
    .from("sources")
    .insert({
      notebook_id: notebookId,
      filename,
      mime_type: "text/plain",
      size_bytes: 11,
      storage_path: storagePath,
      status: "ready",
    })
    .select("id")
    .single();
  if (error) throw error;

  const { error: chunkError } = await db.from("chunks").insert({
    source_id: source.id,
    notebook_id: notebookId,
    chunk_index: 0,
    content: "Testinhalt.",
    token_count: 3,
    embedding: fakeEmbedding(1),
  });
  if (chunkError) throw chunkError;

  const { error: messageError } = await db.from("messages").insert({
    notebook_id: notebookId,
    role: "assistant",
    content: "Antwort.",
    citations: [],
  });
  if (messageError) throw messageError;

  return { sourceId: source.id, storagePath };
}

async function countRows(table: string, column: string, value: string): Promise<number> {
  const { count, error } = await db
    .from(table)
    .select("*", { count: "exact", head: true })
    .eq(column, value);
  if (error) throw error;
  return count ?? 0;
}

async function storageFileExists(path: string): Promise<boolean> {
  const prefix = path.slice(0, path.lastIndexOf("/"));
  const name = path.slice(path.lastIndexOf("/") + 1);
  const { data, error } = await db.storage.from("sources").list(prefix);
  if (error) throw error;
  return (data ?? []).some((f) => f.name === name);
}

describe("deletion", () => {
  it("deleting a source removes its chunks and the stored file", async () => {
    const notebook = await createNotebook(sessionId, "Löschtest Quelle");
    const { sourceId, storagePath } = await createFullSource(notebook.id, "quelle.txt");

    expect(await storageFileExists(storagePath)).toBe(true);
    await deleteSource(sessionId, sourceId);

    expect(await countRows("sources", "id", sourceId)).toBe(0);
    expect(await countRows("chunks", "source_id", sourceId)).toBe(0);
    expect(await storageFileExists(storagePath)).toBe(false);

    await deleteNotebook(sessionId, notebook.id);
  });

  it("deleting a notebook removes sources, chunks, messages and files", async () => {
    const notebook = await createNotebook(sessionId, "Löschtest Notebook");
    const first = await createFullSource(notebook.id, "eins.txt");
    const second = await createFullSource(notebook.id, "zwei.txt");

    await deleteNotebook(sessionId, notebook.id);

    expect(await countRows("notebooks", "id", notebook.id)).toBe(0);
    expect(await countRows("sources", "notebook_id", notebook.id)).toBe(0);
    expect(await countRows("chunks", "notebook_id", notebook.id)).toBe(0);
    expect(await countRows("messages", "notebook_id", notebook.id)).toBe(0);
    expect(await storageFileExists(first.storagePath)).toBe(false);
    expect(await storageFileExists(second.storagePath)).toBe(false);
  });

  it("deleting the session cascades to all remaining data", async () => {
    const tempSession = await createTestSession(db);
    const notebook = await createNotebook(tempSession, "Session-Kaskade");
    await createFullSource(notebook.id, "drei.txt");

    await deleteTestSession(db, tempSession);

    expect(await countRows("notebooks", "session_id", tempSession)).toBe(0);
    expect(await countRows("sources", "notebook_id", notebook.id)).toBe(0);
    expect(await countRows("chunks", "notebook_id", notebook.id)).toBe(0);
  });
});
