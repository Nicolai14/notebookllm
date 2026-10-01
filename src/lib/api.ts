import "server-only";
import { NextResponse } from "next/server";
import { AppError } from "@/lib/errors";

/** Maps thrown errors to JSON responses; unexpected errors become generic 500s. */
export async function handleRoute(
  fn: () => Promise<NextResponse | Response>
): Promise<NextResponse | Response> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof AppError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("unhandled route error:", err);
    return NextResponse.json(
      { error: "Interner Fehler. Bitte später erneut versuchen." },
      { status: 500 }
    );
  }
}
