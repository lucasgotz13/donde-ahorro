import { existsSync } from "node:fs";
import { defineConfig } from "@playwright/test";
import { e2eDatabaseUrl } from "./e2e/database.ts";

// The repo root `.env` names the Postgres server; E2E uses its own database on it (S23).
if (existsSync("../../.env")) process.loadEnvFile("../../.env");
const adminUrl = process.env.DATABASE_URL;
const port = 3200;

export default defineConfig({
  testDir: "e2e",
  // Tests share one seeded database and server; each gets a fresh browser context (cookies).
  workers: 1,
  reporter: "list",
  use: {
    baseURL: `http://localhost:${port}`,
    locale: "es-AR",
    timezoneId: "America/Argentina/Buenos_Aires",
    // The system Chromium avoids a browser download; set CHROMIUM_PATH elsewhere, or unset it to use Playwright's.
    launchOptions: { executablePath: process.env.CHROMIUM_PATH ?? (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined) },
  },
  webServer: {
    command: `node e2e/seed.ts && pnpm exec next dev --port ${port}`,
    url: `http://localhost:${port}`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: { DATABASE_URL: e2eDatabaseUrl(adminUrl), E2E_ADMIN_DATABASE_URL: adminUrl!, NEXT_DIST_DIR: ".next-e2e" },
  },
});
