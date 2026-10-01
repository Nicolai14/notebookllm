import "server-only";
import { getConfig } from "@/lib/config";
import { AiDisabledError, AppError, ValidationError } from "@/lib/errors";
import { MAX_EXTRACTED_TOKENS, MAX_PROCESSING_MS, estimateTokens } from "@/lib/limits";
import { embedTexts } from "@/lib/openai";
import { insertChunks } from "@/lib/db/chunks";
import { updateSourceStatus } from "@/lib/db/sources";
import { ensureEmbeddingConfigMatches } from "@/lib/db/embeddingConfig";
import type { SourceRow } from "@/lib/db/types";
import { extractMarkdown, extractTxt, type ExtractedUnit } from "./extract";
import { extractPdf } from "./extract-pdf";
import { buildChunks } from "./chunk";

/**
 * Runs the full pipeline (extract, chunk, embed, store) inside the upload
 * request. Always terminates in status 'ready' or 'error'; the overall timeout
 * aborts long runs deterministically. Status polling is display-only.
 */
export async function processSource(
  source: SourceRow,
  file: Buffer,
  timeoutMs: number = MAX_PROCESSING_MS
): Promise<SourceRow> {
  await updateSourceStatus(source.id, "processing");
  // The losing promise of Promise.race keeps running; the guard stops it from
  // writing chunks for a source that was already marked as failed.
  const guard = { expired: false };
  try {
    const result = await withTimeout(runPipeline(source, file, guard), timeoutMs, guard);
    const fields = {
      error_message: null,
      page_count: result.pageCount,
      extracted_chars: result.extractedChars,
    };
    await updateSourceStatus(source.id, "ready", fields);
    return { ...source, status: "ready", ...fields };
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

interface PipelineResult {
  pageCount: number | null;
  extractedChars: number;
}

async function runPipeline(
  source: SourceRow,
  file: Buffer,
  guard: { expired: boolean }
): Promise<PipelineResult> {
  if (!getConfig().AI_FEATURES_ENABLED) throw new AiDisabledError();
  await ensureEmbeddingConfigMatches();

  let units: ExtractedUnit[];
  let pageCount: number | null = null;
  switch (source.mime_type) {
    case "text/plain":
      units = extractTxt(file);
      break;
    case "text/markdown":
      units = extractMarkdown(file);
      break;
    case "application/pdf": {
      const extraction = await extractPdf(file);
      units = extraction.units;
      pageCount = extraction.pageCount;
      break;
    }
    default:
      throw new ValidationError("Dieser Dateityp wird nicht unterstützt.");
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

  if (guard.expired) {
    throw new AppError("Die Verarbeitung hat zu lange gedauert und wurde abgebrochen.", 422);
  }
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

  return { pageCount, extractedChars: totalText.length };
}

async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  guard: { expired: boolean }
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      guard.expired = true;
      reject(
        new AppError("Die Verarbeitung hat zu lange gedauert und wurde abgebrochen.", 422)
      );
    }, ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
