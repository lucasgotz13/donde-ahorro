import { readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { createTestDatabase } from "@donde-ahorro/db";
import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveSepaUrl, weekdayInArgentina } from "./download.ts";
import { runSepa } from "./run.ts";

describe("weekdayInArgentina", () => {
  it.each([
    ["2026-11-19T15:00:00Z", "jueves"],
    ["2026-11-18T15:00:00Z", "miercoles"],
    ["2026-11-21T15:00:00Z", "sabado"],
    // 01:00 UTC on Friday is still Thursday in Buenos Aires.
    ["2026-11-20T01:00:00Z", "jueves"],
  ])("%s is %s", (iso, weekday) => expect(weekdayInArgentina(new Date(iso))).toBe(weekday));
});

// A local stand-in for datos.produccion.gob.ar: never the live site.
let server: Server;
let base: string;
const requests: string[] = [];
let fail = false;
const lastModified = "Thu, 19 Nov 2026 16:19:56 GMT";

beforeAll(async () => {
  const zip = await readFile(new URL("./fixtures/sepa_jueves.zip", import.meta.url));
  server = createServer((req, res) => {
    requests.push(`${req.method} ${req.url} ${req.headers["user-agent"]}`);
    if (req.url?.startsWith("/api/3/action/package_show")) {
      res.setHeader("content-type", "application/json");
      const resources = ["miercoles", "jueves", "viernes"].map((d) => ({ url: `${base}/download/sepa_${d}.zip` }));
      return res.end(JSON.stringify({ success: true, result: { resources } }));
    }
    if (fail) return res.writeHead(500).end();
    res.writeHead(200, { "content-type": "application/zip", "last-modified": lastModified });
    res.end(req.method === "HEAD" ? undefined : zip);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise((resolve) => server.close(resolve)));

describe("resolveSepaUrl", () => {
  it("picks the ZIP of the weekday in Buenos Aires from the CKAN package", async () => {
    expect(await resolveSepaUrl(new Date("2026-11-19T15:00:00Z"), base)).toBe(`${base}/download/sepa_jueves.zip`);
  });

  it("fails when the weekday has no resource", async () => {
    await expect(resolveSepaUrl(new Date("2026-11-16T15:00:00Z"), base)).rejects.toThrow(/sepa_lunes.zip/);
  });
});

const adminUrl = process.env.DATABASE_URL;

// S21, S23: every run is logged; an unchanged ZIP is not downloaded again.
describe.skipIf(!adminUrl)("runSepa", () => {
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  let sql: postgres.Sql;
  const options = () => ({ workDir: tmpdir(), ckanUrl: base, now: new Date("2026-11-19T17:00:00Z") });
  const runs = () => sql`select status, message, source_last_modified, stats from ingest_runs order by id`;

  beforeAll(async () => {
    db = await createTestDatabase(adminUrl!);
    sql = db.sql;
  });
  afterAll(() => db.drop());

  it("downloads, loads every MVP chain and logs the run", async () => {
    await runSepa(sql, options());
    const [run] = await runs();
    expect(run).toMatchObject({ status: "succeeded", source_last_modified: new Date(lastModified) });
    expect(Object.keys(run!.stats).sort()).toEqual(["10", "12", "15", "9"]);
    expect(run!.stats["12"]).toMatchObject({ day: "2026-11-19", branches: 2 });
    expect(requests.filter((r) => r.startsWith("GET /download"))).toHaveLength(1);
    expect(requests.every((r) => r.endsWith("donde-ahorro (self-hosted price comparison)"))).toBe(true);
  });

  it("skips the download when last-modified did not change", async () => {
    await runSepa(sql, options());
    expect((await runs())[1]).toMatchObject({
      status: "skipped",
      message: "SEPA ZIP unchanged",
      source_last_modified: new Date(lastModified),
    });
    expect(requests.filter((r) => r.startsWith("GET /download"))).toHaveLength(1);
  });

  // S21: before ~13:20 ART the weekday's ZIP is still last week's; wait for today's.
  it("skips a ZIP that was not published today", async () => {
    await runSepa(sql, { ...options(), now: new Date("2026-11-20T13:00:00Z") });
    expect((await runs()).at(-1)).toMatchObject({ status: "skipped", message: "SEPA ZIP for viernes not published yet" });
    expect(requests.filter((r) => r.startsWith("GET /download"))).toHaveLength(1);
  });

  it("logs a failed run with its error", async () => {
    fail = true;
    await expect(runSepa(sql, options())).rejects.toThrow(/HTTP 500/);
    fail = false;
    expect((await runs()).at(-1)).toMatchObject({ status: "failed", message: expect.stringMatching(/HTTP 500/) });
  });
});
