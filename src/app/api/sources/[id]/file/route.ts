import { handleRoute } from "@/lib/api";
import { requireSession } from "@/lib/auth/current";
import { getDb, STORAGE_BUCKET } from "@/lib/db/client";
import { getSource } from "@/lib/db/sources";

type Params = { params: Promise<{ id: string }> };

/**
 * Authorized file proxy for the private bucket. PDFs render in the browser
 * viewer; TXT and Markdown are served as plain text so document content is
 * never interpreted as HTML.
 */
export async function GET(_request: Request, { params }: Params) {
  return handleRoute(async () => {
    const sessionId = await requireSession();
    const { id } = await params;
    const source = await getSource(sessionId, id);

    const { data, error } = await getDb()
      .storage.from(STORAGE_BUCKET)
      .download(source.storage_path);
    if (error) throw error;

    const contentType =
      source.mime_type === "application/pdf"
        ? "application/pdf"
        : "text/plain; charset=utf-8";
    const asciiName = source.filename.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "'");

    return new Response(data.stream(), {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `inline; filename="${asciiName}"`,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
        // Untrusted document content rendered same-origin: the sandbox CSP
        // denies any script/DOM access (PDF viewers still render).
        "Content-Security-Policy": "sandbox",
      },
    });
  });
}
