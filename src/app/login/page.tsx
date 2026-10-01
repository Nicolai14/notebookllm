"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ApiError, apiJson } from "@/lib/client/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function LoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      await apiJson("/api/auth/login", "POST", { password });
      router.replace("/");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Anmeldung fehlgeschlagen.");
      setPending(false);
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-semibold tracking-tight">Fundus</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Dokumente hochladen, Fragen stellen, Antworten mit Beleg.
        </p>
        <form onSubmit={handleSubmit} className="mt-8 space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="password" className="text-sm font-medium">
              Demo-Passwort
            </label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
              required
              aria-describedby={error ? "login-error" : undefined}
            />
          </div>
          {error && (
            <p id="login-error" className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
          <Button type="submit" disabled={pending} className="w-full">
            {pending ? "Wird geprüft ..." : "Demo öffnen"}
          </Button>
        </form>
        <p className="mt-6 text-xs text-muted-foreground">
          Jede Anmeldung startet eine eigene Arbeitsumgebung mit getrennten
          Notebooks und Dateien.
        </p>
      </div>
    </main>
  );
}
