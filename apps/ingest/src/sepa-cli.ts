// Runs one SEPA ingest now, outside the daily schedule in main.ts.
import { tmpdir } from "node:os";
import { migrate } from "@donde-ahorro/db";
import postgres from "postgres";
import { runSepa } from "./sepa/run.ts";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");
await migrate(url);
const sql = postgres(url, { onnotice: () => {} });
try {
  await runSepa(sql, { workDir: process.env.SEPA_WORK_DIR ?? tmpdir() });
  console.log((await sql`select status, message, stats from ingest_runs order by id desc limit 1`)[0]);
} finally {
  await sql.end();
}
