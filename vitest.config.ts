import { existsSync } from "node:fs";
import { defineConfig } from "vitest/config";

// `.env` provides DATABASE_URL for the db integration tests; they are skipped without it.
if (existsSync(".env")) process.loadEnvFile(".env");

export default defineConfig({
  test: {
    passWithNoTests: true,
    include: ["packages/*/src/**/*.test.ts", "apps/*/src/**/*.test.ts"],
  },
});
