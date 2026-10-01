import "server-only";
import { getDb } from "./client";

export async function createSession(): Promise<string> {
  const { data, error } = await getDb()
    .from("sessions")
    .insert({})
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

/** Server-side logout: deleting the row invalidates every copy of the cookie. */
export async function deleteSession(sessionId: string): Promise<void> {
  const { error } = await getDb().from("sessions").delete().eq("id", sessionId);
  if (error) throw error;
}

/** Returns true if the session row exists (and updates last_seen_at). */
export async function touchSession(sessionId: string): Promise<boolean> {
  const { data, error } = await getDb()
    .from("sessions")
    .update({ last_seen_at: new Date().toISOString() })
    .eq("id", sessionId)
    .select("id");
  if (error) throw error;
  return (data?.length ?? 0) > 0;
}
