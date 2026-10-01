import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { handleRoute } from "@/lib/api";
import { getConfig } from "@/lib/config";
import { ValidationError } from "@/lib/errors";
import { createSession } from "@/lib/db/sessions";
import { createSessionCookieValue, SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { cookieSecure } from "@/lib/auth/cookie";
import { SESSION_TTL_MS } from "@/lib/limits";

function passwordMatches(candidate: string, expected: string): boolean {
  // Hashing both sides yields equal-length buffers for timingSafeEqual.
  const a = createHash("sha256").update(candidate, "utf8").digest();
  const b = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  return handleRoute(async () => {
    const config = getConfig();
    const body = await request.json().catch(() => null);
    const password = body?.password;
    if (typeof password !== "string" || password.length === 0) {
      throw new ValidationError("Bitte Passwort eingeben.");
    }
    if (!passwordMatches(password, config.DEMO_PASSWORD)) {
      return NextResponse.json({ error: "Falsches Passwort." }, { status: 401 });
    }

    const sessionId = await createSession();
    const cookieValue = await createSessionCookieValue(
      sessionId,
      config.AUTH_SECRET,
      SESSION_TTL_MS
    );
    const response = NextResponse.json({ ok: true });
    response.cookies.set(SESSION_COOKIE_NAME, cookieValue, {
      httpOnly: true,
      secure: cookieSecure(),
      sameSite: "lax",
      path: "/",
      maxAge: Math.floor(SESSION_TTL_MS / 1000),
    });
    return response;
  });
}
