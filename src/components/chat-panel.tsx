"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, apiFetch } from "@/lib/client/api";
import { Button } from "@/components/ui/button";
import { CitationChip } from "@/components/citation-chip";
import type { Citation, MessageRow } from "@/lib/db/types";

interface StreamEvent {
  type: "delta" | "done" | "error";
  text?: string;
  message?: MessageRow;
  error?: string;
}

export function ChatPanel({
  notebookId,
  readySourceCount,
  selectedSourceIds,
  existingSourceIds,
}: {
  notebookId: string;
  readySourceCount: number;
  selectedSourceIds: string[];
  existingSourceIds: Set<string>;
}) {
  const [messages, setMessages] = useState<MessageRow[] | null>(null);
  const [question, setQuestion] = useState("");
  const [streamingText, setStreamingText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const data = await apiFetch<{ messages: MessageRow[] }>(
        `/api/notebooks/${notebookId}/messages`
      );
      setMessages(data.messages);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Verlauf konnte nicht geladen werden."
      );
    }
  }, [notebookId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, streamingText]);

  async function handleSend(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = question.trim();
    if (!trimmed || busy) return;

    setError(null);
    setBusy(true);
    setQuestion("");
    const optimistic: MessageRow = {
      id: `local-${Date.now()}`,
      notebook_id: notebookId,
      role: "user",
      content: trimmed,
      citations: [],
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...(prev ?? []), optimistic]);
    setStreamingText("");

    try {
      const response = await fetch(`/api/notebooks/${notebookId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: trimmed, sourceIds: selectedSourceIds }),
      });
      if (!response.ok || !response.body) {
        const data = await response.json().catch(() => null);
        throw new ApiError(
          data?.error ?? "Die Antwort konnte nicht erzeugt werden.",
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

      if (finalMessage) {
        const message = finalMessage;
        setMessages((prev) => [...(prev ?? []), message]);
      } else {
        throw new ApiError("Die Antwort wurde unterbrochen.", 500);
      }
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Die Antwort konnte nicht erzeugt werden."
      );
    } finally {
      setStreamingText(null);
      setBusy(false);
      void load();
    }
  }

  return (
    <section className="flex min-h-0 flex-col">
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-8 py-6">
        <div className="mx-auto max-w-2xl space-y-5">
          {messages === null ? (
            <p className="text-sm text-muted-foreground">Verlauf wird geladen ...</p>
          ) : messages.length === 0 && streamingText === null ? (
            <div className="pt-12 text-center text-sm text-muted-foreground">
              <p className="text-base font-medium text-foreground">
                Stelle eine Frage zu deinen Quellen.
              </p>
              <p className="mt-2">
                Antworten stützen sich ausschließlich auf die hochgeladenen Dokumente
                und nennen die Fundstelle.
              </p>
            </div>
          ) : (
            messages.map((message) => (
              <MessageBubble
                key={message.id}
                message={message}
                existingSourceIds={existingSourceIds}
              />
            ))
          )}
          {streamingText !== null && (
            <div className="rounded-lg bg-muted px-4 py-3 text-sm">
              {streamingText === "" ? (
                <span className="text-muted-foreground">Sucht in den Quellen ...</span>
              ) : (
                <span className="whitespace-pre-wrap">{streamingText}</span>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="border-t border-border bg-surface px-8 py-4">
        <form onSubmit={handleSend} className="mx-auto flex max-w-2xl gap-2">
          <textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                e.currentTarget.form?.requestSubmit();
              }
            }}
            rows={2}
            maxLength={2000}
            placeholder={
              readySourceCount === 0
                ? "Lade zuerst eine Quelle hoch."
                : selectedSourceIds.length === 0
                  ? "Wähle links mindestens eine Quelle aus."
                  : `Frage zu ${selectedSourceIds.length} ausgewählten Quellen stellen ...`
            }
            disabled={selectedSourceIds.length === 0 || busy}
            aria-label="Frage an die Quellen"
            className="min-h-10 w-full resize-none rounded-md border border-border bg-surface px-3 py-2 text-sm placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25 disabled:opacity-50"
          />
          <Button
            type="submit"
            disabled={selectedSourceIds.length === 0 || busy || !question.trim()}
          >
            Senden
          </Button>
        </form>
        {error && (
          <p className="mx-auto mt-2 max-w-2xl text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}

function MessageBubble({
  message,
  existingSourceIds,
}: {
  message: MessageRow;
  existingSourceIds: Set<string>;
}) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-lg bg-primary px-4 py-2.5 text-sm text-primary-foreground">
          <span className="whitespace-pre-wrap">{message.content}</span>
        </div>
      </div>
    );
  }
  return (
    <div className="rounded-lg bg-muted px-4 py-3 text-sm leading-relaxed">
      <AnswerText
        content={message.content}
        citations={message.citations}
        existingSourceIds={existingSourceIds}
      />
    </div>
  );
}

/**
 * Renders validated answer text; [n] markers become clickable citation chips.
 * Text is rendered as plain text (React escaping), never as HTML.
 */
function AnswerText({
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
