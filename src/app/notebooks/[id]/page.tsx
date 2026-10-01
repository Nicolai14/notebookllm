import { notFound, redirect } from "next/navigation";
import { getSessionId } from "@/lib/auth/current";
import { getNotebook } from "@/lib/db/notebooks";
import { NotFoundError } from "@/lib/errors";
import { AppHeader } from "@/components/app-header";
import { Workspace } from "@/components/workspace";

export const dynamic = "force-dynamic";

export default async function NotebookPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const sessionId = await getSessionId();
  if (!sessionId) redirect("/login");

  const { id } = await params;
  let notebook;
  try {
    notebook = await getNotebook(sessionId, id);
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }

  return (
    <div className="flex h-dvh flex-col">
      <AppHeader subtitle={notebook.title} />
      <Workspace notebookId={notebook.id} />
    </div>
  );
}
