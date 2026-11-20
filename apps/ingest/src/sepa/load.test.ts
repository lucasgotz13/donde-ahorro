import { createReadStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createTestDatabase } from "@donde-ahorro/db";
import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { extractEntry, listInnerArchives } from "./archive.ts";
import { loadChain, loadInnerArchive, upsertChains, type LoadBranch } from "./load.ts";
import { parseBranch, parsePriceRow, readRecords, type PriceRow } from "./parse.ts";

const adminUrl = process.env.DATABASE_URL;

// Integration test: needs Postgres (`docker compose up -d db`).
describe.skipIf(!adminUrl)("SEPA load", () => {
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  let sql: postgres.Sql;
  let dir: string;
  const branch: LoadBranch = { id: "12-1-44", chainId: "coto", name: "MONROE", address: "Av. Monroe 3284", lat: -34.56, lng: -58.46 };

  beforeAll(async () => {
    db = await createTestDatabase(adminUrl!);
    sql = db.sql;
    dir = await mkdtemp(join(tmpdir(), "sepa-load-"));
    await upsertChains(sql);
  });
  afterAll(async () => {
    await db.drop();
    await rm(dir, { recursive: true, force: true });
  });

  const row = (code: string, price: number, extra: Partial<PriceRow> = {}): PriceRow => ({
    branchId: branch.id,
    code,
    isEan: true,
    description: `Producto ${code}`,
    brand: null,
    presentation: null,
    price,
    ...extra,
  });
  async function* stream(rows: PriceRow[]) {
    yield* rows;
  }
  const load = (day: string, ...rows: PriceRow[]) => loadChain(sql, { day, branches: [branch], rows: stream(rows) });
  const periods = (code: string) => sql`
    select pp.price, pp.valid_from::text as "from", pp.valid_to::text as "to", pp.last_seen::text as "seen"
    from price_periods pp join products p on p.id = pp.product_id
    where p.ean = ${code} or p.chain_product_code = ${code}
    order by pp.valid_from`;

  // S8: only price changes are stored.
  it("opens a period for a price seen for the first time", async () => {
    await load("2026-11-01", row("A", 100));
    expect(await periods("A")).toEqual([{ price: 100, from: "2026-11-01", to: null, seen: "2026-11-01" }]);
  });

  it("only moves last_seen forward while the price holds", async () => {
    await load("2026-11-01", row("B", 100));
    await load("2026-11-02", row("B", 100));
    expect(await periods("B")).toEqual([{ price: 100, from: "2026-11-01", to: null, seen: "2026-11-02" }]);
  });

  it("closes the period and opens a new one when the price changes", async () => {
    await load("2026-11-01", row("C", 100));
    const stats = await load("2026-11-03", row("C", 120));
    expect(await periods("C")).toEqual([
      { price: 100, from: "2026-11-01", to: "2026-11-03", seen: "2026-11-01" },
      { price: 120, from: "2026-11-03", to: null, seen: "2026-11-03" },
    ]);
    expect(stats).toMatchObject({ changed: 1 });
  });

  it("corrects the price in place when the same day is loaded again", async () => {
    await load("2026-11-01", row("D", 100));
    await load("2026-11-01", row("D", 110));
    expect(await periods("D")).toEqual([{ price: 110, from: "2026-11-01", to: null, seen: "2026-11-01" }]);
  });

  it("ignores an older publication, so periods never overlap", async () => {
    await load("2026-11-03", row("E", 100));
    await load("2026-11-02", row("E", 90));
    expect(await periods("E")).toEqual([{ price: 100, from: "2026-11-03", to: null, seen: "2026-11-03" }]);
  });

  // S9: the last known price stays open when the product disappears from SEPA.
  it("keeps the last known price when a product is missing", async () => {
    await load("2026-11-01", row("F", 100));
    await load("2026-11-02", row("other", 5));
    expect(await periods("F")).toEqual([{ price: 100, from: "2026-11-01", to: null, seen: "2026-11-01" }]);
  });

  // S10: codes that are not EANs belong to the chain.
  it("stores a non-EAN code under its chain", async () => {
    await load("2026-11-01", row("G", 100, { isEan: false }));
    expect(await sql`select ean, chain_id, chain_product_code from products where chain_product_code = 'G'`).toEqual([
      { ean: null, chain_id: "coto", chain_product_code: "G" },
    ]);
  });

  it("ignores rows of branches outside CABA and rows without a code", async () => {
    const stats = await load("2026-11-01", row("H", 100, { branchId: "12-1-13" }), row("", 100));
    expect(stats).toMatchObject({ rows: 0, skipped: 2 });
    expect(await periods("H")).toEqual([]);
  });

  // S7: a real inner archive, filtered to CABA.
  it("loads a real Coto archive into CABA branches", async () => {
    const outer = fileURLToPath(new URL("./fixtures/sepa_jueves.zip", import.meta.url));
    const inner = await extractEntry(outer, (await listInnerArchives(outer)).get(12)!, dir);
    const stats = await loadInnerArchive(sql, inner);

    const fixture = (file: string) => createReadStream(new URL(`./fixtures/coto_sepa-12/${file}`, import.meta.url));
    const caba = new Set<string>();
    for await (const r of readRecords(fixture("sucursales.csv"))) if (parseBranch(r).caba) caba.add(parseBranch(r).id);
    let expected = 0;
    for await (const r of readRecords(fixture("productos.csv"))) if (caba.has(parsePriceRow(r)?.branchId ?? "")) expected++;

    expect(stats).toMatchObject({ day: "2026-11-19", branches: 2, rows: expected });
    expect((await sql`select id from branches where chain_id = 'coto' order by id`).map((b) => b.id)).toEqual(
      expect.arrayContaining(["12-1-44", "12-1-56"]),
    );
    const opened = await sql`select count(*)::int as count from price_periods where branch_id = any(${[...caba]}) and valid_from = '2026-11-19'`;
    expect(opened[0]!.count).toBe(expected);
  });
});
