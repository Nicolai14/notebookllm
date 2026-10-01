import { defineConfig } from "@playwright/test";
import { join } from "node:path";

// E2E runs against the production build with the OpenAI mock
// (tests/mocks/openai-mock.mjs) wired in via OPENAI_BASE_URL.
// Run `npm run build` first; `npm run test:e2e` does both.
try {
  process.loadEnvFile(join(__dirname, ".env"));
} catch {
  // env may be provided externally
}

const APP_PORT = 3105;
const MOCK_PORT = 4105;
// Second app instance with AI_FEATURES_ENABLED=false for kill-switch tests.
export const KILL_SWITCH_PORT = 3107;

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${APP_PORT}`,
  },
  webServer: [
    {
      command: "node tests/mocks/openai-mock.mjs",
      port: MOCK_PORT,
      env: { MOCK_PORT: String(MOCK_PORT) },
      reuseExistingServer: false,
    },
    {
      command: `npx next start -p ${APP_PORT}`,
      port: APP_PORT,
      env: {
        OPENAI_BASE_URL: `http://127.0.0.1:${MOCK_PORT}/v1`,
        COOKIE_SECURE: "false",
        ALLOW_INSECURE_TEST_COOKIES: "true",
        CLIENT_IP_HEADER: "x-forwarded-for",
      },
      reuseExistingServer: false,
    },
    {
      command: `npx next start -p ${KILL_SWITCH_PORT}`,
      port: KILL_SWITCH_PORT,
      env: {
        OPENAI_BASE_URL: `http://127.0.0.1:${MOCK_PORT}/v1`,
        COOKIE_SECURE: "false",
        ALLOW_INSECURE_TEST_COOKIES: "true",
        AI_FEATURES_ENABLED: "false",
        CLIENT_IP_HEADER: "x-forwarded-for",
      },
      reuseExistingServer: false,
    },
  ],
});
