"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, apiFetch } from "@/lib/client/api";
import { SourcesPanel } from "@/components/sources-panel";
import { ChatPanel } from "@/components/chat-panel";
import type { SourceRow } from "@/lib/db/types";

export function Workspace({ notebookId }: { notebookId: string }) {
  const [sources, setSources] = useState<SourceRow[] | null>(null);
  const [sourcesError, setSourcesError] = useState<string | null>(null);
  // Newly processed sources are selected by default; deselection is sticky.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const knownIds = useRef<Set<string>>(new Set());
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadSources = useCallback(async () => {
    try {
      const data = await apiFetch<{ sources: SourceRow[] }>(
        `/api/notebooks/${notebookId}/sources`
      );
      setSources(data.sources);
      setSourcesError(null);
      setSelectedIds((previous) => {
        const next = new Set(previous);
        const existing = new Set(data.sources.map((s) => s.id));
        for (const source of data.sources) {
          if (source.status === "ready" && !knownIds.current.has(source.id)) {
            next.add(source.id);
          }
        }
        for (const id of next) {
          if (!existing.has(id)) next.delete(id);
        }
        knownIds.current = existing;
        return next;
      });
    } catch (err) {
      setSourcesError(
        err instanceof ApiError ? err.message : "Quellen konnten nicht geladen werden."
      );
    }
  }, [notebookId]);

  useEffect(() => {
    void loadSources();
  }, [loadSources]);

  // Processing finishes inside the upload request; this poll is display-only
  // and covers the rare case of an interrupted upload request.
  useEffect(() => {
    const hasUnfinished = sources?.some(
      (s) => s.status === "pending" || s.status === "processing"
    );
    if (hasUnfinished && !pollTimer.current) {
      pollTimer.current = setInterval(() => void loadSources(), 5000);
    }
    if (!hasUnfinished && pollTimer.current) {
      clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
    return () => {
      if (pollTimer.current) {
        clearInterval(pollTimer.current);
        pollTimer.current = null;
      }
    };
  }, [sources, loadSources]);

  const toggleSelected = useCallback((sourceId: string) => {
    setSelectedIds((previous) => {
      const next = new Set(previous);
      if (next.has(sourceId)) next.delete(sourceId);
      else next.add(sourceId);
      return next;
    });
  }, []);

  const readyCount = (sources ?? []).filter((s) => s.status === "ready").length;
  const existingSourceIds = new Set((sources ?? []).map((s) => s.id));

  return (
    <div className="grid min-h-0 flex-1 grid-cols-[320px_1fr_260px]">
      <SourcesPanel
        notebookId={notebookId}
        sources={sources}
        error={sourcesError}
        selectedIds={selectedIds}
        onToggleSelected={toggleSelected}
        onChanged={loadSources}
      />
      <ChatPanel
        notebookId={notebookId}
        readySourceCount={readyCount}
        selectedSourceIds={[...selectedIds]}
        existingSourceIds={existingSourceIds}
      />
      <aside className="flex min-h-0 flex-col border-l border-border bg-surface">
        <div className="border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold">Studio</h2>
        </div>
        <div className="px-4 py-3 text-sm text-muted-foreground">
          <p>
            Die strukturierte Zusammenfassung der ausgewählten Quellen folgt im
            nächsten Meilenstein.
          </p>
        </div>
      </aside>
    </div>
  );
}
