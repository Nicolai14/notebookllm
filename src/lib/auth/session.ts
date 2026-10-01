// Signed session cookie: base64url(JSON payload) + "." + base64url(HMAC-SHA256).
// Uses Web Crypto so it works in both the Node.js and Edge runtimes.

export const SESSION_COOKIE_NAME = "nb_session";

export interface SessionPayload {
  sid: string;
  exp: number;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array | null {
  try {
    const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

async function hmacSign(data: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(data)
  );
  return toBase64Url(new Uint8Array(signature));
}

export async function createSessionCookieValue(
  sid: string,
  secret: string,
  ttlMs: number
): Promise<string> {
  const payload: SessionPayload = { sid, exp: Date.now() + ttlMs };
  const encoded = toBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = await hmacSign(encoded, secret);
  return `${encoded}.${signature}`;
}

export async function verifySessionCookieValue(
  value: string | undefined,
  secret: string
): Promise<SessionPayload | null> {
  if (!value) return null;
  const parts = value.split(".");
  if (parts.length !== 2) return null;
  const [encoded, signature] = parts;
  const expected = await hmacSign(encoded, secret);
  // Constant-time comparison via double HMAC: hashing both sides removes any
  // timing signal from the string comparison (the attacker-controlled value
  // is never compared directly).
  const expectedMac = await hmacSign(expected, secret);
  const signatureMac = await hmacSign(signature, secret);
  if (signatureMac !== expectedMac) return null;
  const bytes = fromBase64Url(encoded);
  if (!bytes) return null;
  let payload: SessionPayload;
  try {
    payload = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
  if (typeof payload.sid !== "string" || typeof payload.exp !== "number") {
    return null;
  }
  if (payload.exp <= Date.now()) return null;
  return payload;
}
