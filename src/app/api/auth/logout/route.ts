import { NextResponse } from "next/server";
import { handleRoute } from "@/lib/api";
import { getConfig } from "@/lib/config";
import { SESSION_COOKIE_NAME, verifySessionCookieValue } from "@/lib/auth/session";
import { cookieSecure } from "@/lib/auth/cookie";
import { deleteSession } from "@/lib/db/sessions";
import { cookies } from "next/headers";

export async function POST() {
  return handleRoute(async () => {
    // Invalidate server-side as well: a copied cookie must not stay valid
    // after logout. Deleting the session cascades to all its data.
    const cookieStore = await cookies();
    const payload = await verifySessionCookieValue(
      cookieStore.get(SESSION_COOKIE_NAME)?.value,
      getConfig().AUTH_SECRET
    );
    if (payload) {
      await deleteSession(payload.sid);
    }

    const response = NextResponse.json({ ok: true });
    response.cookies.set(SESSION_COOKIE_NAME, "", {
      httpOnly: true,
      secure: cookieSecure(),
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    });
    return response;
  });
}
