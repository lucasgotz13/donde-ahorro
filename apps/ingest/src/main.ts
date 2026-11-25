// Ingest worker: S21 schedule (14:00 ART, hourly until 20:00) for SEPA prices, branch geocoding, promotions and product images.
import { tmpdir } from "node:os";
import { setTimeout as sleep } from "node:timers/promises";
import { migrate } from "@donde-ahorro/db";
import postgres from "postgres";
import { runCarrefour } from "./promotions/carrefour/run.ts";
import { geocodeBranches } from "./georef/geocode.ts";
import { loadProductImages } from "./images/open-food-facts.ts";
import { runCoto } from "./promotions/coto/run.ts";
import { nextTick, runDueJobs, type Job } from "./schedule.ts";
import { runSepa } from "./sepa/run.ts";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");
await migrate(url);
const sql = postgres(url, { onnotice: () => {} });

const jobs: Job[] = [
  // A skipped SEPA run means today's ZIP is not out yet: retry next hour.
  { source: "sepa", doneStatuses: ["succeeded"], run: () => runSepa(sql, { workDir: process.env.SEPA_WORK_DIR ?? tmpdir() }) },
  // S3: geocode new or changed branch addresses; usually none, so no request.
  // shortcut: a branch SEPA adds after today's geocoding run waits until tomorrow; chain it to the SEPA job if that matters.
  { source: "georef", doneStatuses: ["succeeded"], run: () => geocodeBranches(sql) },
  // S22: one promo run per day; a skipped run means the source is disabled.
  { source: "coto", doneStatuses: ["succeeded", "skipped"], run: () => runCoto(sql) },
  { source: "carrefour", doneStatuses: ["succeeded", "skipped"], run: () => runCarrefour(sql) },
  // Its ~1.5 GB download must not delay prices or promotions. A skipped run means this week's is done.
  { source: "images", lastTickOnly: true, doneStatuses: ["succeeded", "skipped"], run: () => loadProductImages(sql) },
];

console.log(`[ingest] started at ${new Date().toISOString()}`);
for (;;) {
  const next = nextTick(new Date());
  console.log(`[ingest] next run at ${next.toISOString()}`);
  await sleep(next.getTime() - Date.now());
  await runDueJobs(sql, jobs);
}
