import { CHUNK_OVERLAP_TOKENS, CHUNK_TARGET_TOKENS, estimateTokens } from "@/lib/limits";
import type { ExtractedUnit } from "./extract";

export interface DocumentChunk {
  chunkIndex: number;
  content: string;
  tokenCount: number;
  pageStart: number | null;
  pageEnd: number | null;
  sectionPath: string | null;
}

interface ChunkOptions {
  targetTokens?: number;
  overlapTokens?: number;
}

/**
 * Structure-aware chunking (see docs/architecture.md 5.2):
 * - consecutive small units are merged up to the target size,
 * - an oversized unit is split at sentence boundaries with ~15% overlap,
 * - chunks never span a page boundary (PDF) and keep their section labels.
 */
export function buildChunks(
  units: ExtractedUnit[],
  options: ChunkOptions = {}
): DocumentChunk[] {
  const targetTokens = options.targetTokens ?? CHUNK_TARGET_TOKENS;
  const overlapTokens = options.overlapTokens ?? CHUNK_OVERLAP_TOKENS;

  const chunks: DocumentChunk[] = [];
  let group: ExtractedUnit[] = [];
  let groupTokens = 0;

  const flushGroup = () => {
    if (group.length === 0) return;
    const content = group.map((u) => u.text).join("\n\n");
    chunks.push({
      chunkIndex: chunks.length,
      content,
      tokenCount: estimateTokens(content),
      pageStart: group[0].page,
      pageEnd: group[group.length - 1].page,
      sectionPath: sectionLabel(group[0], group[group.length - 1]),
    });
    group = [];
    groupTokens = 0;
  };

  for (const unit of units) {
    const unitTokens = estimateTokens(unit.text);

    if (unitTokens > targetTokens) {
      flushGroup();
      for (const part of splitOversizedUnit(unit.text, targetTokens, overlapTokens)) {
        chunks.push({
          chunkIndex: chunks.length,
          content: part,
          tokenCount: estimateTokens(part),
          pageStart: unit.page,
          pageEnd: unit.page,
          sectionPath: unit.sectionPath,
        });
      }
      continue;
    }

    const samePage = group.length === 0 || group[group.length - 1].page === unit.page;
    if (!samePage || groupTokens + unitTokens > targetTokens) {
      flushGroup();
    }
    group.push(unit);
    groupTokens += unitTokens;
  }
  flushGroup();

  return chunks;
}

function sectionLabel(first: ExtractedUnit, last: ExtractedUnit): string | null {
  if (!first.sectionPath) return null;
  if (first.sectionPath === last.sectionPath) return first.sectionPath;
  return `${first.sectionPath} bis ${last.sectionPath}`;
}

function splitOversizedUnit(
  text: string,
  targetTokens: number,
  overlapTokens: number
): string[] {
  const sentences = splitSentences(text);
  const parts: string[] = [];
  let current: string[] = [];
  let currentTokens = 0;

  for (const sentence of sentences) {
    const sentenceTokens = estimateTokens(sentence);
    if (currentTokens + sentenceTokens > targetTokens && current.length > 0) {
      parts.push(current.join(" "));
      const overlap = takeTrailingTokens(current, overlapTokens);
      current = [...overlap];
      currentTokens = estimateTokens(current.join(" "));
    }
    current.push(sentence);
    currentTokens += sentenceTokens;
  }
  if (current.length > 0) parts.push(current.join(" "));
  return parts;
}

function splitSentences(text: string): string[] {
  const matches = text.match(/[^.!?\n]+[.!?]*\s*/g);
  if (!matches) return [text];
  return matches.map((s) => s.trim()).filter((s) => s.length > 0);
}

function takeTrailingTokens(sentences: string[], maxTokens: number): string[] {
  const result: string[] = [];
  let tokens = 0;
  for (let i = sentences.length - 1; i >= 0; i--) {
    const t = estimateTokens(sentences[i]);
    if (tokens + t > maxTokens) break;
    result.unshift(sentences[i]);
    tokens += t;
  }
  return result;
}
