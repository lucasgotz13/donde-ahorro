import type postgres from "postgres";
import { dateInArgentina } from "./sepa/download.ts";

// shortcut: Argentina has kept UTC-3 without DST since 2009; switch to Intl offsets if DST returns.
const OFFSET_MS = -3 * 3600_000;
const FIRST_HOUR = 14;
const LAST_HOUR = 20;

/** S21: the next top of the hour in 14:00–20:00 Buenos Aires time, strictly after `now`. */
export function nextTick(now: Date): Date {
  const local = new Date(now.getTime() + OFFSET_MS); // UTC fields read as Buenos Aires wall clock
  let hour = local.getUTCHours() + 1;
  let day = local.getUTCDate();
  if (hour < FIRST_HOUR) hour = FIRST_HOUR;
  if (hour > LAST_HOUR) [hour, day] = [FIRST_HOUR, day + 1];
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), day, hour) - OFFSET_MS);
}

export interface Job {
  /** The `ingest_runs.source` the job logs under. */
  source: string;
  /** Run statuses that mean the job is done for the day; anything else is retried at the next tick. */
  doneStatuses: ("succeeded" | "skipped")[];
  run: () => Promise<unknown>;
}

/** Runs, in order, every job without a done run today (Buenos Aires); one failing job never stops the rest. */
export async function runDueJobs(sql: postgres.Sql, jobs: Job[], now = new Date()) {
  const today = dateInArgentina(now);
  for (const job of jobs) {
    const [done] = await sql`select 1 from ingest_runs where source = ${job.source}
      and status = any(${job.doneStatuses}::ingest_status[])
      and (started_at at time zone 'America/Argentina/Buenos_Aires')::date = ${today}::date limit 1`;
    if (done) continue;
    try {
      await job.run();
    } catch (error) {
      // The job already logged its failure in ingest_runs; the next tick retries it.
      console.error(`[ingest] ${job.source} failed:`, error);
    }
  }
}
