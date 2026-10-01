import { join } from "node:path";

try {
  process.loadEnvFile(join(__dirname, "..", ".env"));
} catch {
  // Integration tests fail with a clear message if required vars are missing.
}
