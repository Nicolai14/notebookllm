import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { handleRoute } from "@/lib/api";
import { getConfig } from "@/lib/config";
import { ValidationError } from "@/lib/errors";
import { createSession } from "@/lib/db/sessions";
import { createSessionCookieValue, SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { cookieSecure } from "@/lib/auth/cookie";
import {
  RATE_LIMIT_LOGIN,
  RATE_LIMIT_LOGIN_GLOBAL,
  SESSION_TTL_MS,
} from "@/lib/limits";
import { enforceRateLimit, resetRateLimit } from "@/lib/db/rateLimits";
import { getClientIp } from "@/lib/auth/clientIp";

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

    // Every attempt counts atomically against the per-IP window; a successful
    // login resets the per-IP counter. During a block even the correct
    // password is rejected, which is the point of a brute-force lockout.
    // The global backstop (never reset) caps total attempts even when the IP
    // signal is diluted (see getClientIp).
    const rateLimitKey = `login:${getClientIp(request)}`;
    const limitMessage = "Zu viele Anmeldeversuche. Bitte später erneut versuchen.";
    await enforceRateLimit(
      "login-global",
      RATE_LIMIT_LOGIN_GLOBAL.windowSeconds,
      RATE_LIMIT_LOGIN_GLOBAL.max,
      limitMessage
    );
    await enforceRateLimit(
      rateLimitKey,
      RATE_LIMIT_LOGIN.windowSeconds,
      RATE_LIMIT_LOGIN.max,
      limitMessage
    );

    if (!passwordMatches(password, config.DEMO_PASSWORD)) {
      return NextResponse.json({ error: "Falsches Passwort." }, { status: 401 });
    }
    await resetRateLimit(rateLimitKey);

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
