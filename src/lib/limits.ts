// All operational limits in one place. Values are deliberately conservative
// demo limits; token counts are estimates (~4 chars per token).

export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_SOURCES_PER_NOTEBOOK = 10;
export const MAX_PDF_PAGES = 100;
export const MAX_EXTRACTED_TOKENS = 120_000;
export const MAX_PROCESSING_MS = 60_000;

export const CHUNK_TARGET_TOKENS = 500;
export const CHUNK_OVERLAP_TOKENS = 75;

export const RETRIEVAL_TOP_K = 12;
export const RETRIEVAL_MIN_SIMILARITY = 0.2;
export const CONTEXT_TOKEN_BUDGET = 8_000;
export const MAX_OUTPUT_TOKENS = 1_500;
export const CHAT_HISTORY_MAX_TURNS = 6;

export const MAX_QUESTION_CHARS = 2_000;
export const MAX_NOTEBOOK_TITLE_CHARS = 120;
export const EMBEDDING_BATCH_SIZE = 64;

export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
