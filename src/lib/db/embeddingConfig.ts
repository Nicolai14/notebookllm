import "server-only";
import { getDb } from "./client";
import { getConfig } from "@/lib/config";
import { EmbeddingConfigMismatchError } from "@/lib/errors";

let verified = false;

/**
 * Guards against silently mixing incompatible vectors: the model and dimension
 * stored at migration time must match the current env before any embedding is
 * created or queried. Changing the embedding model requires a deliberate
 * re-index (see docs/architecture.md section 2).
 */
export async function ensureEmbeddingConfigMatches(): Promise<void> {
  if (verified) return;
  const config = getConfig();
  const { data, error } = await getDb()
    .from("embedding_config")
    .select("model_name, dimensions")
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    throw new EmbeddingConfigMismatchError(
      "Embedding-Konfiguration fehlt in der Datenbank. Bitte Migrationen ausführen (npm run db:apply)."
    );
  }
  if (
    data.model_name !== config.OPENAI_EMBEDDING_MODEL ||
    data.dimensions !== config.OPENAI_EMBEDDING_DIMENSIONS
  ) {
    throw new EmbeddingConfigMismatchError(
      `Embedding-Modell geändert (Datenbank: ${data.model_name}/${data.dimensions}, ` +
        `Konfiguration: ${config.OPENAI_EMBEDDING_MODEL}/${config.OPENAI_EMBEDDING_DIMENSIONS}). ` +
        "Vorhandene Vektoren sind inkompatibel; bewusste Re-Indexierung erforderlich."
    );
  }
  verified = true;
}

export function resetEmbeddingConfigCacheForTests(): void {
  verified = false;
}
