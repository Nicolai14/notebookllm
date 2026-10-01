"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiJson } from "@/lib/client/api";
import { Button } from "@/components/ui/button";

export function AppHeader({ subtitle }: { subtitle?: string }) {
  const router = useRouter();

  async function handleLogout() {
    await apiJson("/api/auth/logout", "POST");
    router.replace("/login");
  }

  return (
    <header className="flex h-14 items-center justify-between border-b border-border bg-surface px-6">
      <div className="flex min-w-0 items-baseline gap-3">
        <Link href="/" className="text-base font-semibold tracking-tight">
          Fundus
        </Link>
        {subtitle && (
          <span className="truncate text-sm text-muted-foreground">{subtitle}</span>
        )}
      </div>
      <Button variant="ghost" size="sm" onClick={handleLogout}>
        Abmelden
      </Button>
    </header>
  );
}
