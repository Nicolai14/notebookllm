import "server-only";
import { getDb } from "./client";
import { AppError } from "@/lib/errors";

export class RateLimitError extends AppError {
  constructor(
    message: string,
    public readonly retryAfterSeconds: number
  ) {
    super(message, 429);
  }
}

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

/** Atomically counts one hit against a fixed window (Postgres row lock per key). */
export async function hitRateLimit(
  key: string,
  windowSeconds: number,
  maxCount: number
): Promise<RateLimitResult> {
  const { data, error } = await getDb().rpc("rate_limit_hit", {
    p_key: key,
    p_window_seconds: windowSeconds,
    p_max_count: maxCount,
  });
  if (error) throw error;
  const row = (data as { allowed: boolean; retry_after_seconds: number }[])[0];
  return { allowed: row.allowed, retryAfterSeconds: row.retry_after_seconds };
}

export async function resetRateLimit(key: string): Promise<void> {
  const { error } = await getDb().rpc("rate_limit_reset", { p_key: key });
  if (error) throw error;
}

/** Counts a hit and throws a 429 with Retry-After when the limit is exceeded. */
export async function enforceRateLimit(
  key: string,
  windowSeconds: number,
  maxCount: number,
  message: string
): Promise<void> {
  const result = await hitRateLimit(key, windowSeconds, maxCount);
  if (!result.allowed) {
    throw new RateLimitError(message, result.retryAfterSeconds);
  }
}
