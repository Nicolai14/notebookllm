import { redirect } from "next/navigation";
import { getSessionId } from "@/lib/auth/current";
import { AppHeader } from "@/components/app-header";
import { NotebookList } from "@/components/notebook-list";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const sessionId = await getSessionId();
  if (!sessionId) redirect("/login");

  return (
    <div className="min-h-dvh">
      <AppHeader />
      <main className="mx-auto w-full max-w-3xl px-6 py-10">
        <h1 className="text-xl font-semibold tracking-tight">Notebooks</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Ein Notebook bündelt Quellen und den zugehörigen Chat.
        </p>
        <NotebookList />
      </main>
    </div>
  );
}
