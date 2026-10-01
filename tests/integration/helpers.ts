import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Integration tests need ${name} in .env`);
  return value;
}

export function adminClient(): SupabaseClient {
  return createClient(
    requireEnv("SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false } }
  );
}

export function embeddingDimensions(): number {
  return Number(requireEnv("OPENAI_EMBEDDING_DIMENSIONS"));
}

/** Deterministic unit vector; same seed = identical vector (similarity 1). */
export function fakeEmbedding(seed: number): number[] {
  const dims = embeddingDimensions();
  const vector = new Array(dims).fill(0);
  vector[seed % dims] = 1;
  return vector;
}

export async function createTestSession(db: SupabaseClient): Promise<string> {
  const { data, error } = await db.from("sessions").insert({}).select("id").single();
  if (error) throw error;
  return data.id;
}

export async function deleteTestSession(db: SupabaseClient, sessionId: string) {
  await db.from("sessions").delete().eq("id", sessionId);
}
