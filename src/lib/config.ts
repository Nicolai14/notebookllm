import { z } from "zod";

const envSchema = z.object({
  OPENAI_API_KEY: z.string().min(1),
  OPENAI_CHAT_MODEL: z.string().min(1),
  OPENAI_EMBEDDING_MODEL: z.string().min(1),
  OPENAI_EMBEDDING_DIMENSIONS: z.coerce.number().int().positive(),
  // Test-only override to point the OpenAI SDK at a local mock server.
  OPENAI_BASE_URL: z.url().optional(),
  // Optional: only sent to the API when set (reasoning-capable chat models).
  OPENAI_REASONING_EFFORT: z.enum(["minimal", "low", "medium", "high"]).optional(),
  DEMO_PASSWORD: z.string().min(8),
  AUTH_SECRET: z.string().min(32),
  SUPABASE_URL: z.url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  AI_FEATURES_ENABLED: z
    .enum(["true", "false"])
    .transform((v) => v === "true"),
  COOKIE_SECURE: z.enum(["true", "false"]).optional(),
});

export type AppConfig = z.infer<typeof envSchema>;

let cached: AppConfig | null = null;

export class ConfigError extends Error {}

export function getConfig(): AppConfig {
  if (cached) return cached;
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const details = result.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new ConfigError(`Ungültige Umgebungskonfiguration: ${details}`);
  }
  // A production start with disabled Secure cookies is refused. Local E2E
  // (next start also runs as NODE_ENV=production) must opt in with the
  // deliberately loud test-only variable.
  if (
    process.env.NODE_ENV === "production" &&
    result.data.COOKIE_SECURE === "false" &&
    process.env.ALLOW_INSECURE_TEST_COOKIES !== "true"
  ) {
    throw new ConfigError(
      "COOKIE_SECURE=false ist in Produktion nicht zulässig. Für lokale Tests zusätzlich ALLOW_INSECURE_TEST_COOKIES=true setzen."
    );
  }
  cached = result.data;
  return cached;
}

export function resetConfigCacheForTests(): void {
  cached = null;
}
