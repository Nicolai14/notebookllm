"use client";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { Citation } from "@/lib/db/types";

function locationLabel(citation: Citation): string {
  if (citation.page_start !== null) {
    return citation.page_start === citation.page_end || citation.page_end === null
      ? `Seite ${citation.page_start}`
      : `Seiten ${citation.page_start}-${citation.page_end}`;
  }
  return citation.section_path ?? "Abschnitt unbekannt";
}

export function CitationChip({
  citation,
  sourceDeleted = false,
}: {
  citation: Citation;
  sourceDeleted?: boolean;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="mx-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-accent-soft px-1.5 align-text-top text-xs font-semibold text-primary transition-colors duration-150 hover:bg-primary hover:text-primary-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          aria-label={`Quelle ${citation.marker}: ${citation.filename}, ${locationLabel(citation)}`}
        >
          {citation.marker}
        </button>
      </PopoverTrigger>
      <PopoverContent>
        <p className="break-words text-sm font-semibold">{citation.filename}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{locationLabel(citation)}</p>
        {sourceDeleted && (
          <p className="mt-1 text-xs text-destructive">
            Diese Quelle wurde inzwischen gelöscht; die Passage stammt aus dem
            gespeicherten Zitat.
          </p>
        )}
        <blockquote className="mt-3 max-h-56 overflow-y-auto whitespace-pre-wrap border-l border-border pl-3 text-sm text-foreground">
          {citation.passage}
        </blockquote>
      </PopoverContent>
    </Popover>
  );
}
