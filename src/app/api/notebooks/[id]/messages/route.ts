import { NextResponse } from "next/server";
import { handleRoute } from "@/lib/api";
import { requireSession } from "@/lib/auth/current";
import { listMessages } from "@/lib/db/messages";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  return handleRoute(async () => {
    const sessionId = await requireSession();
    const { id } = await params;
    return NextResponse.json({ messages: await listMessages(sessionId, id) });
  });
}
