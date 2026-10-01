"use client";

import { CitationChip } from "@/components/citation-chip";
import type { Citation } from "@/lib/db/types";

/**
 * Renders validated answer text; [n] markers become clickable citation chips.
 * Text is rendered as plain text (React escaping), never as HTML.
 */
export function AnswerText({
  content,
  citations,
  existingSourceIds,
}: {
  content: string;
  citations: Citation[];
  existingSourceIds: Set<string>;
}) {
  const byMarker = new Map(citations.map((c) => [c.marker, c]));
  const parts = content.split(/\[(\d{1,4})\]/g);

  return (
    <span className="whitespace-pre-wrap">
      {parts.map((part, index) => {
        if (index % 2 === 1) {
          const citation = byMarker.get(Number(part));
          if (citation) {
            return (
              <CitationChip
                key={index}
                citation={citation}
                sourceDeleted={!existingSourceIds.has(citation.source_id)}
              />
            );
          }
          return <span key={index}>[{part}]</span>;
        }
        return <span key={index}>{part}</span>;
      })}
    </span>
  );
}
