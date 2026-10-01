// Applies SQL migrations to the Supabase project via the Management API and
// ensures the private storage bucket and embedding_config row exist.
// Requires .env with SUPABASE_URL, SUPABASE_ACCESS_TOKEN, SUPABASE_SERVICE_ROLE_KEY,
// OPENAI_EMBEDDING_MODEL, OPENAI_EMBEDDING_DIMENSIONS.
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
try {
  process.loadEnvFile(join(root, ".env"));
} catch {
  // env may already be provided by the environment
}

const required = [
  "SUPABASE_URL",
  "SUPABASE_ACCESS_TOKEN",
  "SUPABASE_SERVICE_ROLE_KEY",
  "OPENAI_EMBEDDING_MODEL",
  "OPENAI_EMBEDDING_DIMENSIONS",
];
const missing = required.filter((k) => !process.env[k]);
if (missing.length > 0) {
  console.error(`Missing env vars: ${missing.join(", ")}`);
  process.exit(1);
}

const dimensions = Number(process.env.OPENAI_EMBEDDING_DIMENSIONS);
if (!Number.isInteger(dimensions) || dimensions <= 0) {
  console.error("OPENAI_EMBEDDING_DIMENSIONS must be a positive integer");
  process.exit(1);
}

const projectRef = new URL(process.env.SUPABASE_URL).hostname.split(".")[0];

async function runSql(query) {
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${projectRef}/database/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query }),
    }
  );
  if (!res.ok) {
    throw new Error(`SQL failed (${res.status}): ${await res.text()}`);
  }
  return res.json();
}

const migrationsDir = join(root, "supabase", "migrations");
const files = readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort();

for (const file of files) {
  const sql = readFileSync(join(migrationsDir, file), "utf8").replaceAll(
    "__EMBEDDING_DIMENSIONS__",
    String(dimensions)
  );
  console.log(`Applying ${file} ...`);
  await runSql(sql);
}

// Seed embedding_config exactly once; never overwrite silently.
const existing = await runSql("select model_name, dimensions from embedding_config");
if (existing.length === 0) {
  const model = process.env.OPENAI_EMBEDDING_MODEL.replaceAll("'", "''");
  await runSql(
    `insert into embedding_config (id, model_name, dimensions) values (1, '${model}', ${dimensions})`
  );
  console.log(`Seeded embedding_config: ${process.env.OPENAI_EMBEDDING_MODEL} (${dimensions})`);
} else {
  const row = existing[0];
  if (row.dimensions !== dimensions || row.model_name !== process.env.OPENAI_EMBEDDING_MODEL) {
    console.warn(
      `WARNING: embedding_config (${row.model_name}, ${row.dimensions}) differs from env ` +
        `(${process.env.OPENAI_EMBEDDING_MODEL}, ${dimensions}). AI endpoints will refuse to run. ` +
        `Re-index deliberately before changing the config.`
    );
  } else {
    console.log("embedding_config matches env.");
  }
}

// Private bucket for original files.
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);
const { data: buckets, error: listError } = await supabase.storage.listBuckets();
if (listError) throw listError;
if (!buckets.some((b) => b.name === "sources")) {
  const { error } = await supabase.storage.createBucket("sources", { public: false });
  if (error) throw error;
  console.log("Created private bucket 'sources'.");
} else {
  console.log("Bucket 'sources' exists.");
}

console.log("Done.");
