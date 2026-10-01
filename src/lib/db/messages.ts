import "server-only";
import { getDb } from "./client";
import { getNotebook } from "./notebooks";
import type { Citation, MessageRow } from "./types";

export async function listMessages(
  sessionId: string,
  notebookId: string
): Promise<MessageRow[]> {
  await getNotebook(sessionId, notebookId);
  const { data, error } = await getDb()
    .from("messages")
    .select("*")
    .eq("notebook_id", notebookId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data;
}

export async function insertMessage(message: {
  notebook_id: string;
  role: "user" | "assistant";
  content: string;
  citations?: Citation[];
}): Promise<MessageRow> {
  const { data, error } = await getDb()
    .from("messages")
    .insert({ citations: [], ...message })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}
