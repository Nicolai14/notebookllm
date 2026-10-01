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
