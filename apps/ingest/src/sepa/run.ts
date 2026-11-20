import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import type postgres from "postgres";
import { extractEntry, listInnerArchives } from "./archive.ts";
import { sepaComercios } from "./chains.ts";
import { dateInArgentina, download, fetchLastModified, resolveSepaUrl, SEPA_CKAN_URL, weekdayInArgentina } from "./download.ts";
import { loadInnerArchive, upsertChains } from "./load.ts";

/** One SEPA ingest attempt, logged in `ingest_runs` (S21, S23). Throws after logging a failure. */
export async function runSepa(
  sql: postgres.Sql,
  { workDir, ckanUrl = SEPA_CKAN_URL, now = new Date() }: { workDir: string; ckanUrl?: string; now?: Date },
) {
  const [run] = await sql`insert into ingest_runs (source) values ('sepa') returning id`;
  const finish = (fields: Record<string, unknown>) =>
    sql`update ingest_runs set ${sql({ ...fields, finished_at: new Date() })} where id = ${run!.id}`;
  const dir = await mkdtemp(join(workDir, "sepa-"));
  try {
    const [previous] = await sql`select source_last_modified from ingest_runs
      where source = 'sepa' and status = 'succeeded' order by started_at desc limit 1`;
    const url = await resolveSepaUrl(now, ckanUrl);
    const lastModified = await fetchLastModified(url);
    // Each weekday's ZIP is overwritten weekly: until today's is out, it holds last week's prices.
    if (dateInArgentina(lastModified) !== dateInArgentina(now)) {
      return await finish({
        status: "skipped",
        message: `SEPA ZIP for ${weekdayInArgentina(now)} not published yet`,
        source_last_modified: lastModified,
      });
    }
    if (previous?.source_last_modified?.getTime() === lastModified.getTime()) {
      return await finish({ status: "skipped", message: "SEPA ZIP unchanged", source_last_modified: lastModified });
    }
    const zip = join(dir, "sepa.zip");
    await download(url, zip);

    await upsertChains(sql);
    const inner = await listInnerArchives(zip);
    const stats: Record<number, unknown> = {};
    const missing = [];
    for (const comercio of sepaComercios) {
      const entry = inner.get(comercio);
      if (!entry) {
        missing.push(comercio);
        continue;
      }
      const innerZip = await extractEntry(zip, entry, dir);
      stats[comercio] = await loadInnerArchive(sql, innerZip);
      await rm(innerZip);
    }
    if (missing.length > 0) throw new Error(`SEPA ZIP has no archive for comercio ${missing.join(", ")}`);
    await finish({ status: "succeeded", source_last_modified: lastModified, stats: sql.json(stats as postgres.JSONValue) });
  } catch (error) {
    await finish({ status: "failed", message: String(error) });
    throw error;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
