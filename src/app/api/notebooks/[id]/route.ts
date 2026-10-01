import { NextResponse } from "next/server";
import { handleRoute } from "@/lib/api";
import { requireSession } from "@/lib/auth/current";
import { deleteNotebook, getNotebook } from "@/lib/db/notebooks";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  return handleRoute(async () => {
    const sessionId = await requireSession();
    const { id } = await params;
    return NextResponse.json({ notebook: await getNotebook(sessionId, id) });
  });
}

export async function DELETE(_request: Request, { params }: Params) {
  return handleRoute(async () => {
    const sessionId = await requireSession();
    const { id } = await params;
    await deleteNotebook(sessionId, id);
    return NextResponse.json({ ok: true });
  });
}
