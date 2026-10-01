import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ConfigError, getConfig, resetConfigCacheForTests } from "@/lib/config";

const VALID_ENV = {
  OPENAI_API_KEY: "sk-test",
  OPENAI_CHAT_MODEL: "test-chat-model",
  OPENAI_EMBEDDING_MODEL: "test-embedding-model",
  OPENAI_EMBEDDING_DIMENSIONS: "1536",
  DEMO_PASSWORD: "test-password",
  AUTH_SECRET: "x".repeat(32),
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
  AI_FEATURES_ENABLED: "true",
};

let savedEnv: NodeJS.ProcessEnv;

beforeEach(() => {
  savedEnv = { ...process.env };
  resetConfigCacheForTests();
});

afterEach(() => {
  process.env = savedEnv;
  resetConfigCacheForTests();
});

function setEnv(overrides: Record<string, string | undefined>) {
  for (const key of Object.keys(VALID_ENV)) delete process.env[key];
  delete process.env.OPENAI_BASE_URL;
  Object.assign(process.env, VALID_ENV, overrides);
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete process.env[key];
  }
}

describe("getConfig", () => {
  it("parses a valid environment", () => {
    setEnv({});
    const config = getConfig();
    expect(config.OPENAI_CHAT_MODEL).toBe("test-chat-model");
    expect(config.OPENAI_EMBEDDING_DIMENSIONS).toBe(1536);
    expect(config.AI_FEATURES_ENABLED).toBe(true);
  });

  it("names the missing variable in the error", () => {
    setEnv({ OPENAI_CHAT_MODEL: undefined });
    expect(() => getConfig()).toThrow(ConfigError);
    resetConfigCacheForTests();
    expect(() => getConfig()).toThrow(/OPENAI_CHAT_MODEL/);
  });

  it("rejects a non-numeric embedding dimension", () => {
    setEnv({ OPENAI_EMBEDDING_DIMENSIONS: "viele" });
    expect(() => getConfig()).toThrow(ConfigError);
  });

  it("rejects a too-short AUTH_SECRET", () => {
    setEnv({ AUTH_SECRET: "kurz" });
    expect(() => getConfig()).toThrow(/AUTH_SECRET/);
  });

  it("parses the kill switch off state", () => {
    setEnv({ AI_FEATURES_ENABLED: "false" });
    expect(getConfig().AI_FEATURES_ENABLED).toBe(false);
  });
});
