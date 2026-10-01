import "server-only";

/**
 * Secure cookies in production, except when explicitly disabled
 * (COOKIE_SECURE=false) for E2E runs that talk plain HTTP to the server.
 */
let warned = false;

/**
 * Secure by default in production. Disabling requires BOTH COOKIE_SECURE=false
 * and the test-only ALLOW_INSECURE_TEST_COOKIES=true; without the latter the
 * config layer refuses to start in production (src/lib/config.ts).
 */
export function cookieSecure(): boolean {
  if (
    process.env.COOKIE_SECURE === "false" &&
    process.env.ALLOW_INSECURE_TEST_COOKIES === "true"
  ) {
    if (!warned) {
      warned = true;
      console.warn(
        "WARNUNG: Session-Cookie wird OHNE Secure-Attribut ausgeliefert " +
          "(ALLOW_INSECURE_TEST_COOKIES). Nur für lokale Tests zulässig."
      );
    }
    return false;
  }
  return process.env.NODE_ENV === "production";
}
