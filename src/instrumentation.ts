// Runs once at server start: fail fast on invalid configuration instead of
// serving 500s per request (e.g. COOKIE_SECURE=false in production).
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { getConfig } = await import("@/lib/config");
    getConfig();
  }
}
