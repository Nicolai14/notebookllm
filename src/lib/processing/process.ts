import "server-only";
import { AppError, ValidationError } from "@/lib/errors";
import { MAX_EXTRACTED_TOKENS, MAX_PROCESSING_MS, estimateTokens } from "@/lib/limits";
import { embedTexts } from "@/lib/openai";
import { insertChunks } from "@/lib/db/chunks";
import { updateSourceStatus } from "@/lib/db/sources";
import { ensureEmbeddingConfigMatches } from "@/lib/db/embeddingConfig";
import type { SourceRow } from "@/lib/db/types";
import { extractTxt, type ExtractedUnit } from "./extract";
import { buildChunks } from "./chunk";

/**
 * Runs the full pipeline (extract, chunk, embed, store) inside the upload
 * request. Always terminates in status 'ready' or 'error'; the overall timeout
 * aborts long runs deterministically. Status polling is display-only.
 */
export async function processSource(source: SourceRow, file: Buffer): Promise<SourceRow> {
  await updateSourceStatus(source.id, "processing");
  try {
    await withTimeout(runPipeline(source, file), MAX_PROCESSING_MS);
    await updateSourceStatus(source.id, "ready", { error_message: null });
    return { ...source, status: "ready", error_message: null };
  } catch (err) {
    const message =
      err instanceof AppError
        ? err.message
        : "Die Verarbeitung ist unerwartet fehlgeschlagen.";
    if (!(err instanceof AppError)) {
      console.error(`processing failed for source ${source.id}:`, err);
    }
    await updateSourceStatus(source.id, "error", { error_message: message });
    return { ...source, status: "error", error_message: message };
  }
}

async function runPipeline(source: SourceRow, file: Buffer): Promise<void> {
  await ensureEmbeddingConfigMatches();

  let units: ExtractedUnit[];
  switch (source.mime_type) {
    case "text/plain":
      units = extractTxt(file);
      break;
    default:
      // PDF and Markdown follow in M3.
      throw new ValidationError("Dieser Dateityp wird noch nicht unterstützt.");
  }

  const totalText = units.map((u) => u.text).join("\n\n");
  const totalTokens = estimateTokens(totalText);
  if (totalTokens > MAX_EXTRACTED_TOKENS) {
    throw new ValidationError(
      `Das Dokument überschreitet das Verarbeitungslimit von ${MAX_EXTRACTED_TOKENS.toLocaleString("de-DE")} Tokens.`
    );
  }

  const chunks = buildChunks(units);
  if (chunks.length === 0) {
    throw new ValidationError("Die Datei enthält keinen extrahierbaren Text.");
  }

  const embeddings = await embedTexts(chunks.map((c) => c.content));

  await insertChunks(
    chunks.map((chunk, i) => ({
      source_id: source.id,
      notebook_id: source.notebook_id,
      chunk_index: chunk.chunkIndex,
      content: chunk.content,
      token_count: chunk.tokenCount,
      page_start: chunk.pageStart,
      page_end: chunk.pageEnd,
      section_path: chunk.sectionPath,
      embedding: embeddings[i],
    }))
  );

  await updateSourceStatus(source.id, "processing", {
    extracted_chars: totalText.length,
  });
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new AppError(
            "Die Verarbeitung hat zu lange gedauert und wurde abgebrochen.",
            422
          )
        ),
      ms
    );
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
