// Ingest worker entry point. The schedule and adapters arrive in T4–T7.
import { migrate } from "@donde-ahorro/db";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");
await migrate(url);
console.log(`[ingest] started at ${new Date().toISOString()}`);
