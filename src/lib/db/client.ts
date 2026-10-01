import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getConfig } from "@/lib/config";

// Uses the service role key, which bypasses RLS entirely. Authorization is
// therefore enforced in the data access layer: every query is scoped by the
// caller's session id. Never import this module from client components.

let client: SupabaseClient | null = null;

export function getDb(): SupabaseClient {
  if (client) return client;
  const config = getConfig();
  client = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}

export const STORAGE_BUCKET = "sources";
