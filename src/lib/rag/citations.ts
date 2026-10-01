import type { Citation, MatchedChunk } from "@/lib/db/types";

export interface RetrievedChunkWithMeta extends MatchedChunk {
  filename: string;
}

export interface ValidatedAnswer {
  content: string;
  citations: Citation[];
}

/**
 * Server-side citation validation: [n] markers that do not point to a chunk
 * that was actually handed to the model are stripped from the text. Citation
 * metadata (filename, page, section, passage) always comes from the database
 * rows, never from model output. Markers are 1-based positions in `retrieved`.
 */
export function validateCitations(
  modelText: string,
  retrieved: RetrievedChunkWithMeta[]
): ValidatedAnswer {
  const used = new Set<number>();

  const content = modelText
    .replace(/\[(\d{1,4})\]/g, (match, digits: string) => {
      const marker = Number(digits);
      if (marker >= 1 && marker <= retrieved.length) {
        used.add(marker);
        return match;
      }
      return "";
    })
    .replace(/[ \t]+([.,;:!?])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .trim();

  const citations: Citation[] = [...used]
    .sort((a, b) => a - b)
    .map((marker) => {
      const chunk = retrieved[marker - 1];
      return {
        marker,
        chunk_id: chunk.id,
        source_id: chunk.source_id,
        filename: chunk.filename,
        page_start: chunk.page_start,
        page_end: chunk.page_end,
        section_path: chunk.section_path,
        passage: chunk.content,
      };
    });

  return { content, citations };
}
