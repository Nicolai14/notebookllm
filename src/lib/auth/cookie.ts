import "server-only";

/**
 * Secure cookies in production, except when explicitly disabled
 * (COOKIE_SECURE=false) for E2E runs that talk plain HTTP to the server.
 */
export function cookieSecure(): boolean {
  if (process.env.COOKIE_SECURE === "false") return false;
  return process.env.NODE_ENV === "production";
}
