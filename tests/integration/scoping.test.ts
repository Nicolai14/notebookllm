// Runs against the real Supabase database with fake embeddings; no OpenAI calls.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { NotFoundError } from "@/lib/errors";
import { getNotebook, createNotebook, deleteNotebook } from "@/lib/db/notebooks";
import { getSource, listSources } from "@/lib/db/sources";
import { listMessages } from "@/lib/db/messages";
import { matchChunks } from "@/lib/db/chunks";
import {
  adminClient,
  createTestSession,
  deleteTestSession,
  fakeEmbedding,
} from "./helpers";

let db: SupabaseClient;
let sessionA: string;
let sessionB: string;
let notebookA: string;
let notebookB: string;
let sourceA: string;
let sourceB: string;

async function insertSourceWithChunk(
  notebookId: string,
  filename: string,
  seed: number
): Promise<string> {
  const { data: source, error } = await db
    .from("sources")
    .insert({
      notebook_id: notebookId,
      filename,
      mime_type: "text/plain",
      size_bytes: 10,
      storage_path: `test/${crypto.randomUUID()}`,
      status: "ready",
    })
    .select("id")
    .single();
  if (error) throw error;
  const { error: chunkError } = await db.from("chunks").insert({
    source_id: source.id,
    notebook_id: notebookId,
    chunk_index: 0,
    content: `Inhalt aus ${filename}`,
    token_count: 4,
    embedding: fakeEmbedding(seed),
  });
  if (chunkError) throw chunkError;
  return source.id;
}

beforeAll(async () => {
  db = adminClient();
  sessionA = await createTestSession(db);
  sessionB = await createTestSession(db);
  notebookA = (await createNotebook(sessionA, "Scoping A")).id;
  notebookB = (await createNotebook(sessionB, "Scoping B")).id;
  // Identical embedding seed in both notebooks: only scoping can keep them apart.
  sourceA = await insertSourceWithChunk(notebookA, "a.txt", 7);
  sourceB = await insertSourceWithChunk(notebookB, "b.txt", 7);
});

afterAll(async () => {
  await deleteTestSession(db, sessionA);
  await deleteTestSession(db, sessionB);
});

describe("session scoping in the data access layer", () => {
  it("hides notebooks of other sessions", async () => {
    await expect(getNotebook(sessionB, notebookA)).rejects.toThrow(NotFoundError);
    await expect(getNotebook(sessionA, notebookA)).resolves.toMatchObject({
      id: notebookA,
    });
  });

  it("hides sources of other sessions", async () => {
    await expect(getSource(sessionB, sourceA)).rejects.toThrow(NotFoundError);
    await expect(listSources(sessionB, notebookA)).rejects.toThrow(NotFoundError);
    await expect(getSource(sessionA, sourceA)).resolves.toMatchObject({ id: sourceA });
  });

  it("hides messages of other sessions", async () => {
    await expect(listMessages(sessionB, notebookA)).rejects.toThrow(NotFoundError);
    await expect(listMessages(sessionA, notebookA)).resolves.toEqual([]);
  });

  it("rejects deleting a foreign notebook and keeps its data", async () => {
    await expect(deleteNotebook(sessionB, notebookA)).rejects.toThrow(NotFoundError);
    await expect(getNotebook(sessionA, notebookA)).resolves.toMatchObject({
      id: notebookA,
    });
  });
});

describe("vector search scoping", () => {
  it("returns only chunks of the requested notebook despite identical vectors", async () => {
    const matches = await matchChunks({
      notebookId: notebookA,
      sourceIds: [sourceA],
      queryEmbedding: fakeEmbedding(7),
      matchCount: 10,
      minSimilarity: 0.0,
    });
    expect(matches.length).toBe(1);
    expect(matches[0].source_id).toBe(sourceA);
    expect(matches[0].similarity).toBeCloseTo(1, 5);
  });

  it("returns nothing when the source list excludes the matching source", async () => {
    const matches = await matchChunks({
      notebookId: notebookA,
      sourceIds: [sourceB], // belongs to notebook B: cross filter yields nothing
      queryEmbedding: fakeEmbedding(7),
      matchCount: 10,
      minSimilarity: 0.0,
    });
    expect(matches).toEqual([]);
  });

  it("returns nothing for an empty source selection", async () => {
    const matches = await matchChunks({
      notebookId: notebookA,
      sourceIds: [],
      queryEmbedding: fakeEmbedding(7),
      matchCount: 10,
      minSimilarity: 0.0,
    });
    expect(matches).toEqual([]);
  });

  it("applies the similarity threshold", async () => {
    const matches = await matchChunks({
      notebookId: notebookA,
      sourceIds: [sourceA],
      queryEmbedding: fakeEmbedding(8), // orthogonal vector, similarity 0
      matchCount: 10,
      minSimilarity: 0.2,
    });
    expect(matches).toEqual([]);
  });
});
