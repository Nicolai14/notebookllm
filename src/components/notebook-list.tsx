"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ApiError, apiFetch, apiJson } from "@/lib/client/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { NotebookRow } from "@/lib/db/types";

export function NotebookList() {
  const [notebooks, setNotebooks] = useState<NotebookRow[] | null>(null);
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await apiFetch<{ notebooks: NotebookRow[] }>("/api/notebooks");
      setNotebooks(data.notebooks);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Laden fehlgeschlagen.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      await apiJson("/api/notebooks", "POST", { title });
      setTitle("");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Anlegen fehlgeschlagen.");
    } finally {
      setPending(false);
    }
  }

  async function handleDelete(notebook: NotebookRow) {
    if (
      !window.confirm(
        `Notebook "${notebook.title}" mit allen Quellen und dem Chatverlauf löschen?`
      )
    ) {
      return;
    }
    setError(null);
    try {
      await apiJson(`/api/notebooks/${notebook.id}`, "DELETE");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Löschen fehlgeschlagen.");
    }
  }

  return (
    <div className="mt-8">
      <form onSubmit={handleCreate} className="flex gap-2">
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Titel des neuen Notebooks"
          aria-label="Titel des neuen Notebooks"
          required
          maxLength={120}
        />
        <Button type="submit" disabled={pending}>
          Notebook anlegen
        </Button>
      </form>

      {error && (
        <p className="mt-4 text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      {notebooks === null ? (
        <p className="mt-8 text-sm text-muted-foreground">Wird geladen ...</p>
      ) : notebooks.length === 0 ? (
        <p className="mt-8 text-sm text-muted-foreground">
          Noch keine Notebooks. Lege oben das erste an.
        </p>
      ) : (
        <ul className="mt-6 divide-y divide-border rounded-lg border border-border bg-surface">
          {notebooks.map((notebook) => (
            <li
              key={notebook.id}
              className="flex items-center justify-between gap-4 px-4 py-3"
            >
              <Link
                href={`/notebooks/${notebook.id}`}
                className="min-w-0 flex-1 truncate font-medium hover:text-primary"
              >
                {notebook.title}
              </Link>
              <span className="shrink-0 text-xs text-muted-foreground">
                {new Date(notebook.created_at).toLocaleDateString("de-DE")}
              </span>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => handleDelete(notebook)}
              >
                Löschen
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
