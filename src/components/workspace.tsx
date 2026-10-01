"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, apiFetch } from "@/lib/client/api";
import { SourcesPanel } from "@/components/sources-panel";
import { ChatPanel } from "@/components/chat-panel";
import type { SourceRow } from "@/lib/db/types";

export function Workspace({ notebookId }: { notebookId: string }) {
  const [sources, setSources] = useState<SourceRow[] | null>(null);
  const [sourcesError, setSourcesError] = useState<string | null>(null);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadSources = useCallback(async () => {
    try {
      const data = await apiFetch<{ sources: SourceRow[] }>(
        `/api/notebooks/${notebookId}/sources`
      );
      setSources(data.sources);
      setSourcesError(null);
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

  const readySources = (sources ?? []).filter((s) => s.status === "ready");

  return (
    <div className="grid min-h-0 flex-1 grid-cols-[320px_1fr]">
      <SourcesPanel
        notebookId={notebookId}
        sources={sources}
        error={sourcesError}
        onChanged={loadSources}
      />
      <ChatPanel notebookId={notebookId} hasReadySources={readySources.length > 0} />
    </div>
  );
}
