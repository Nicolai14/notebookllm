"use client";

import { useRef, useState } from "react";
import { ApiError, apiJson } from "@/lib/client/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { SourceRow } from "@/lib/db/types";

const statusLabels: Record<SourceRow["status"], { label: string; tone: "neutral" | "success" | "error" | "progress" }> = {
  pending: { label: "Wartet", tone: "neutral" },
  processing: { label: "Wird verarbeitet", tone: "progress" },
  ready: { label: "Bereit", tone: "success" },
  error: { label: "Fehler", tone: "error" },
};

interface SourcesPanelProps {
  notebookId: string;
  sources: SourceRow[] | null;
  error: string | null;
  selectedIds: Set<string>;
  onToggleSelected: (sourceId: string) => void;
  onChanged: () => Promise<void>;
}

export function SourcesPanel({
  notebookId,
  sources,
  error,
  selectedIds,
  onToggleSelected,
  onChanged,
}: SourcesPanelProps) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  async function handleUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setActionError(null);
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch(`/api/notebooks/${notebookId}/sources`, {
        method: "POST",
        body: formData,
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new ApiError(data?.error ?? "Upload fehlgeschlagen.", response.status);
      }
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Upload fehlgeschlagen.");
    } finally {
      setUploading(false);
      await onChanged();
    }
  }

  async function handleDelete(source: SourceRow) {
    if (!window.confirm(`Quelle "${source.filename}" endgültig löschen?`)) return;
    setActionError(null);
    try {
      await apiJson(`/api/sources/${source.id}`, "DELETE");
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Löschen fehlgeschlagen.");
    } finally {
      await onChanged();
    }
  }

  return (
    <aside className="flex min-h-0 flex-col border-r border-border bg-surface">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold">Quellen</h2>
        <Button
          size="sm"
          variant="outline"
          onClick={() => fileInput.current?.click()}
          disabled={uploading}
        >
          {uploading ? "Wird verarbeitet ..." : "Datei hochladen"}
        </Button>
        <input
          ref={fileInput}
          type="file"
          accept=".txt,.pdf,.md,.markdown"
          className="hidden"
          onChange={handleUpload}
          aria-label="Quelle hochladen (PDF, TXT, Markdown)"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {(error || actionError) && (
          <p className="mb-3 text-sm text-destructive" role="alert">
            {error ?? actionError}
          </p>
        )}

        {sources === null ? (
          <p className="text-sm text-muted-foreground">Wird geladen ...</p>
        ) : sources.length === 0 ? (
          <div className="text-sm text-muted-foreground">
            <p>Noch keine Quellen.</p>
            <p className="mt-2">Lade PDF, TXT oder Markdown hoch (max. 5 MB).</p>
          </div>
        ) : (
          <ul className="space-y-3">
            {sources.map((source) => {
              const status = statusLabels[source.status];
              return (
                <li key={source.id} className="rounded-md border border-border p-3">
                  <div className="flex items-start gap-2.5">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(source.id)}
                      disabled={source.status !== "ready"}
                      onChange={() => onToggleSelected(source.id)}
                      aria-label={`${source.filename} für den Chat verwenden`}
                      className="mt-0.5 size-4 shrink-0 accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-40"
                    />
                    <a
                      href={`/api/sources/${source.id}/file`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="min-w-0 flex-1 break-words text-sm font-medium hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                      title="Originaldatei in neuem Tab öffnen"
                    >
                      {source.filename}
                    </a>
                    <Badge tone={status.tone}>{status.label}</Badge>
                  </div>
                  {source.status === "error" && source.error_message && (
                    <p className="mt-2 text-xs text-destructive">{source.error_message}</p>
                  )}
                  <div className="mt-2 flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">
                      {(source.size_bytes / 1024).toFixed(0)} kB
                      {source.page_count ? ` · ${source.page_count} Seiten` : ""}
                    </span>
                    <Button variant="destructive" size="sm" onClick={() => handleDelete(source)}>
                      Löschen
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}
