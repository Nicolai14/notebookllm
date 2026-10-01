import "server-only";

/**
 * Secure cookies in production, except when explicitly disabled
 * (COOKIE_SECURE=false) for E2E runs that talk plain HTTP to the server.
 */
let warned = false;

export function cookieSecure(): boolean {
  if (process.env.COOKIE_SECURE === "false") {
    // `next start` always runs with NODE_ENV=production, so E2E needs this
    // override; a real deployment must never set it. Warn loudly.
    if (!warned) {
      warned = true;
      console.warn(
        "WARNUNG: COOKIE_SECURE=false ist gesetzt; das Session-Cookie wird OHNE " +
          "Secure-Attribut ausgeliefert. Nur für lokale Tests zulässig."
      );
    }
    return false;
  }
  return process.env.NODE_ENV === "production";
}
