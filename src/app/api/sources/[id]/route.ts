import { NextResponse } from "next/server";
import { handleRoute } from "@/lib/api";
import { requireSession } from "@/lib/auth/current";
import { deleteSource } from "@/lib/db/sources";

type Params = { params: Promise<{ id: string }> };

export async function DELETE(_request: Request, { params }: Params) {
  return handleRoute(async () => {
    const sessionId = await requireSession();
    const { id } = await params;
    await deleteSource(sessionId, id);
    return NextResponse.json({ ok: true });
  });
}
