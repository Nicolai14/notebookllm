import "server-only";
import { cookies } from "next/headers";
import { getConfig } from "@/lib/config";
import { AppError } from "@/lib/errors";
import { touchSession } from "@/lib/db/sessions";
import { SESSION_COOKIE_NAME, verifySessionCookieValue } from "./session";

/**
 * Resolves the session id from the signed cookie and verifies the session row
 * still exists. Route handlers never read session ids from request parameters.
 */
export async function getSessionId(): Promise<string | null> {
  const cookieStore = await cookies();
  const payload = await verifySessionCookieValue(
    cookieStore.get(SESSION_COOKIE_NAME)?.value,
    getConfig().AUTH_SECRET
  );
  if (!payload) return null;
  const exists = await touchSession(payload.sid);
  return exists ? payload.sid : null;
}

export async function requireSession(): Promise<string> {
  const sessionId = await getSessionId();
  if (!sessionId) throw new AppError("Nicht angemeldet.", 401);
  return sessionId;
}
