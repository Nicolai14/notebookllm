import "server-only";

/**
 * Trusted client IP resolution. Headers are only consulted when the
 * deployment explicitly names a trusted one via CLIENT_IP_HEADER (e.g.
 * "cf-connecting-ip" behind Cloudflare, "x-forwarded-for" when the own proxy
 * overwrites it). For x-forwarded-for the LAST entry is used: it is the one
 * appended by the trusted proxy; leading entries are client-controlled.
 * Without configuration all clients share one bucket ("unknown"), which is
 * not bypassable, merely coarse.
 */
export function getClientIp(request: Request): string {
  const headerName = process.env.CLIENT_IP_HEADER;
  if (!headerName) return "unknown";
  const value = request.headers.get(headerName);
  if (!value) return "unknown";
  const parts = value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  return parts[parts.length - 1] ?? "unknown";
}
