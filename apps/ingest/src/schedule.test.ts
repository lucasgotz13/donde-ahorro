import { createTestDatabase } from "@donde-ahorro/db/test-database";
import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { nextTick, runDueJobs, type Job } from "./schedule.ts";

// S21: 14:00 ART, then hourly until 20:00. ART is UTC-3.
describe("nextTick", () => {
  it.each([
    ["2026-11-21T13:00:00Z", "2026-11-21T17:00:00Z"], // 10:00 ART → 14:00
    ["2026-11-21T16:59:59Z", "2026-11-21T17:00:00Z"], // 13:59:59 → 14:00
    ["2026-11-21T17:00:00Z", "2026-11-21T18:00:00Z"], // 14:00 → 15:00
    ["2026-11-21T19:30:00Z", "2026-11-21T20:00:00Z"], // 16:30 → 17:00
    ["2026-11-21T22:00:00Z", "2026-11-21T23:00:00Z"], // 19:00 → 20:00
    ["2026-11-21T23:00:00Z", "2026-11-22T17:00:00Z"], // 20:00 → tomorrow 14:00
    ["2026-11-22T02:30:00Z", "2026-11-22T17:00:00Z"], // 23:30 ART (already the 22nd in UTC) → 14:00 on the 22nd
  ])("after %s is %s", (now, next) => expect(nextTick(new Date(now)).toISOString()).toBe(new Date(next).toISOString()));
});

const adminUrl = process.env.DATABASE_URL;

describe.skipIf(!adminUrl)("runDueJobs", () => {
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  let sql: postgres.Sql;
  const now = new Date("2026-11-21T18:00:00Z"); // 15:00 ART
  const log = (source: string, status: string, startedAt: string) =>
    sql`insert into ingest_runs (source, status, started_at) values (${source}, ${status}, ${startedAt})`;
  const calls: string[] = [];
  const job = (source: string, doneStatuses: Job["doneStatuses"] = ["succeeded"], fail = false): Job => ({
    source,
    doneStatuses,
    run: async () => {
      calls.push(source);
      if (fail) throw new Error(`${source} down`);
    },
  });

  beforeAll(async () => {
    db = await createTestDatabase(adminUrl!);
    sql = db.sql;
  });
  afterAll(() => db?.drop());
  beforeEach(async () => {
    calls.length = 0;
    await sql`delete from ingest_runs`;
  });

  it("runs a job until it has a done run today in Buenos Aires", async () => {
    await log("sepa", "succeeded", "2026-11-21T02:00:00Z"); // 23:00 ART on the 20th: yesterday
    await log("coto", "succeeded", "2026-11-21T17:05:00Z");
    await log("carrefour", "failed", "2026-11-21T17:05:00Z");
    await runDueJobs(sql, [job("sepa"), job("coto"), job("carrefour")], now);
    expect(calls).toEqual(["sepa", "carrefour"]);
  });

  it("retries a job whose run today was only skipped, unless skipped counts as done", async () => {
    await log("sepa", "skipped", "2026-11-21T17:00:00Z"); // SEPA ZIP not published yet
    await log("coto", "skipped", "2026-11-21T17:00:00Z"); // disabled by PROMOS_DISABLED
    await runDueJobs(sql, [job("sepa"), job("coto", ["succeeded", "skipped"])], now);
    expect(calls).toEqual(["sepa"]);
  });

  it("keeps running the other jobs when one fails", async () => {
    await runDueJobs(sql, [job("sepa", ["succeeded"], true), job("coto")], now);
    expect(calls).toEqual(["sepa", "coto"]);
  });
});
