import { NextResponse } from "next/server";
import { handleRoute } from "@/lib/api";
import { requireSession } from "@/lib/auth/current";
import { getNotebook } from "@/lib/db/notebooks";
import { countSources, createSource, listSources } from "@/lib/db/sources";
import { getDb, STORAGE_BUCKET } from "@/lib/db/client";
import { ValidationError } from "@/lib/errors";
import { MAX_FILE_BYTES, MAX_SOURCES_PER_NOTEBOOK, RATE_LIMIT_UPLOAD } from "@/lib/limits";
import { enforceRateLimit } from "@/lib/db/rateLimits";
import { processSource } from "@/lib/processing/process";

export const maxDuration = 120;

type Params = { params: Promise<{ id: string }> };

const ALLOWED_EXTENSIONS: Record<string, string> = {
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".markdown": "text/markdown",
  ".pdf": "application/pdf",
};

/** Content check beyond the extension: PDF magic bytes, no binary "text" files. */
function validateFileContent(buffer: Buffer, mimeType: string): void {
  if (mimeType === "application/pdf") {
    if (!buffer.subarray(0, 5).equals(Buffer.from("%PDF-"))) {
      throw new ValidationError("Die Datei ist kein gültiges PDF.");
    }
    return;
  }
  if (buffer.subarray(0, 8192).includes(0)) {
    throw new ValidationError("Die Datei ist keine Textdatei.");
  }
}

export async function GET(_request: Request, { params }: Params) {
  return handleRoute(async () => {
    const sessionId = await requireSession();
    const { id } = await params;
    return NextResponse.json({ sources: await listSources(sessionId, id) });
  });
}

export async function POST(request: Request, { params }: Params) {
  return handleRoute(async () => {
    const sessionId = await requireSession();
    const { id } = await params;
    const notebook = await getNotebook(sessionId, id);

    const formData = await request.formData().catch(() => null);
    const file = formData?.get("file");
    if (!(file instanceof File)) {
      throw new ValidationError("Keine Datei übermittelt.");
    }

    const filename = sanitizeFilename(file.name);
    const extension = filename.slice(filename.lastIndexOf(".")).toLowerCase();
    const mimeType = ALLOWED_EXTENSIONS[extension];
    if (!mimeType) {
      throw new ValidationError(
        "Dieser Dateityp wird nicht unterstützt. Erlaubt sind: PDF, TXT, Markdown."
      );
    }
    if (file.size > MAX_FILE_BYTES) {
      throw new ValidationError("Die Datei ist größer als 5 MB.");
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    if (buffer.byteLength > MAX_FILE_BYTES) {
      throw new ValidationError("Die Datei ist größer als 5 MB.");
    }
    if (buffer.byteLength === 0) {
      throw new ValidationError("Die Datei ist leer.");
    }
    validateFileContent(buffer, mimeType);

    if ((await countSources(notebook.id)) >= MAX_SOURCES_PER_NOTEBOOK) {
      throw new ValidationError(
        `Pro Notebook sind höchstens ${MAX_SOURCES_PER_NOTEBOOK} Quellen erlaubt.`
      );
    }

    // Counted before storage and embedding calls; rejected uploads must not
    // reach OpenAI.
    await enforceRateLimit(
      `upload:${sessionId}`,
      RATE_LIMIT_UPLOAD.windowSeconds,
      RATE_LIMIT_UPLOAD.max,
      "Das Upload-Limit ist erreicht. Bitte später erneut versuchen."
    );

    // Storage path is built from generated ids only, never from the filename.
    const storagePath = `${sessionId}/${notebook.id}/${crypto.randomUUID()}`;
    const { error: uploadError } = await getDb()
      .storage.from(STORAGE_BUCKET)
      .upload(storagePath, buffer, { contentType: mimeType });
    if (uploadError) throw uploadError;

    const source = await createSource({
      notebook_id: notebook.id,
      filename,
      mime_type: mimeType,
      size_bytes: buffer.byteLength,
      storage_path: storagePath,
    });

    // Processing runs to completion inside this request (ready or error);
    // the sources list polling is display-only.
    const processed = await processSource(source, buffer);
    return NextResponse.json({ source: processed }, { status: 201 });
  });
}

function sanitizeFilename(name: string): string {
  const cleaned = name
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[\\/]/g, "_")
    .trim();
  const limited = cleaned.length > 150 ? cleaned.slice(-150) : cleaned;
  if (!limited || !limited.includes(".")) {
    throw new ValidationError("Ungültiger Dateiname.");
  }
  return limited;
}
