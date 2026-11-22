import { existsSync } from "node:fs";
import type { NextConfig } from "next";

// Local runs read DATABASE_URL from the repo root `.env`; docker compose sets it directly.
if (existsSync("../../.env")) process.loadEnvFile("../../.env");

const config: NextConfig = {
  output: "standalone",
  // E2E runs its own `next dev` (another app dir lock) next to a developer's.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Next 16 writes an AGENTS.md on `next dev`; the repo keeps its own agent docs.
  agentRules: false,
  transpilePackages: ["@donde-ahorro/core", "@donde-ahorro/db"],
};

export default config;
