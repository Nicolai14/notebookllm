"use client";

import { useState } from "react";
import { ApiError } from "@/lib/client/api";
import { Button } from "@/components/ui/button";
import { AnswerText } from "@/components/answer-text";
import type { MessageRow } from "@/lib/db/types";

interface StreamEvent {
  type: "delta" | "done" | "error";
  text?: string;
  message?: MessageRow;
  error?: string;
}

export function StudioPanel({
  notebookId,
  selectedSourceIds,
  existingSourceIds,
  onCompleted,
}: {
  notebookId: string;
  selectedSourceIds: string[];
  existingSourceIds: Set<string>;
  onCompleted: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [streamingText, setStreamingText] = useState<string | null>(null);
  const [result, setResult] = useState<MessageRow | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSummarize() {
    if (busy || selectedSourceIds.length === 0) return;
    setBusy(true);
    setError(null);
    setResult(null);
    setStreamingText("");

    try {
      const response = await fetch(`/api/notebooks/${notebookId}/summary`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceIds: selectedSourceIds }),
      });
      if (!response.ok || !response.body) {
        const data = await response.json().catch(() => null);
        throw new ApiError(
          data?.error ?? "Die Zusammenfassung konnte nicht erstellt werden.",
          response.status
        );
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finalMessage: MessageRow | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const blocks = buffer.split("\n\n");
        buffer = blocks.pop() ?? "";
        for (const block of blocks) {
          const line = block.trim();
          if (!line.startsWith("data: ")) continue;
          const parsed = JSON.parse(line.slice(6)) as StreamEvent;
          if (parsed.type === "delta" && parsed.text) {
            setStreamingText((prev) => (prev ?? "") + parsed.text);
          } else if (parsed.type === "done" && parsed.message) {
            finalMessage = parsed.message;
          } else if (parsed.type === "error") {
            throw new ApiError(parsed.error ?? "Unbekannter Fehler.", 500);
          }
        }
      }

      if (!finalMessage) {
        throw new ApiError("Die Zusammenfassung wurde unterbrochen.", 500);
      }
      setResult(finalMessage);
      onCompleted();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Die Zusammenfassung konnte nicht erstellt werden."
      );
    } finally {
      setStreamingText(null);
      setBusy(false);
    }
  }

  return (
    <aside className="flex min-h-0 flex-col border-l border-border bg-surface">
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold">Studio</h2>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        <Button
          size="sm"
          className="w-full"
          onClick={handleSummarize}
          disabled={busy || selectedSourceIds.length === 0}
        >
          {busy
            ? "Zusammenfassung wird erstellt ..."
            : `Zusammenfassung erstellen (${selectedSourceIds.length} Quellen)`}
        </Button>
        <p className="mt-2 text-xs text-muted-foreground">
          Automatisch erstellt und möglicherweise unvollständig. Prüfe Aussagen
          über die Zitate an der Originalpassage.
        </p>

        {selectedSourceIds.length === 0 && !busy && (
          <p className="mt-4 text-sm text-muted-foreground">
            Wähle links mindestens eine verarbeitete Quelle aus.
          </p>
        )}

        {error && (
          <p className="mt-4 text-sm text-destructive" role="alert">
            {error}
          </p>
        )}

        {streamingText !== null && (
          <div className="mt-4 rounded-md bg-muted px-3 py-2.5 text-sm">
            {streamingText === "" ? (
              <span className="text-muted-foreground">Liest die Quellen ...</span>
            ) : (
              <span className="whitespace-pre-wrap">{streamingText}</span>
            )}
          </div>
        )}

        {result && (
          <div className="mt-4 rounded-md bg-muted px-3 py-2.5 text-sm leading-relaxed">
            <AnswerText
              content={result.content}
              citations={result.citations}
              existingSourceIds={existingSourceIds}
            />
          </div>
        )}
      </div>
    </aside>
  );
}
