import { NextResponse } from "next/server";
import { handleRoute } from "@/lib/api";
import { requireSession } from "@/lib/auth/current";
import { createNotebook, listNotebooks } from "@/lib/db/notebooks";
import { ValidationError } from "@/lib/errors";
import { MAX_NOTEBOOK_TITLE_CHARS } from "@/lib/limits";

export async function GET() {
  return handleRoute(async () => {
    const sessionId = await requireSession();
    return NextResponse.json({ notebooks: await listNotebooks(sessionId) });
  });
}

export async function POST(request: Request) {
  return handleRoute(async () => {
    const sessionId = await requireSession();
    const body = await request.json().catch(() => null);
    const title = typeof body?.title === "string" ? body.title.trim() : "";
    if (title.length === 0) {
      throw new ValidationError("Bitte einen Titel angeben.");
    }
    if (title.length > MAX_NOTEBOOK_TITLE_CHARS) {
      throw new ValidationError(
        `Der Titel darf höchstens ${MAX_NOTEBOOK_TITLE_CHARS} Zeichen lang sein.`
      );
    }
    const notebook = await createNotebook(sessionId, title);
    return NextResponse.json({ notebook }, { status: 201 });
  });
}
