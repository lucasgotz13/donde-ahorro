import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "./migrate.ts";

const adminUrl = process.env.DATABASE_URL;

// Integration test: needs Postgres (`docker compose up -d db`). Each run migrates a throwaway database.
describe.skipIf(!adminUrl)("database schema", () => {
  const name = `test_${randomUUID().replaceAll("-", "")}`;
  const admin = postgres(adminUrl ?? "", { max: 1 });
  const url = new URL(adminUrl ?? "postgres://localhost");
  url.pathname = `/${name}`;
  const sql = postgres(url.toString(), { max: 1, onnotice: () => {} });

  beforeAll(async () => {
    await admin.unsafe(`create database ${name}`);
    await migrate(url.toString());
    await sql`insert into chains (id, name, sepa_comercio_id, sepa_bandera_id) values ('coto', 'Coto', 10, 1)`;
    await sql`insert into branches (id, chain_id, name, address, lat, lng) values ('10-1-200', 'coto', 'Coto 200', 'Av. Siempre Viva 742', -34.6, -58.4)`;
    await sql`insert into products (ean, description) values ('7790000000001', 'Yerba 1 kg')`;
  });

  afterAll(async () => {
    await sql.end();
    await admin.unsafe(`drop database if exists ${name} with (force)`);
    await admin.end();
  });

  const productId = async () => (await sql`select id from products where ean = '7790000000001'`)[0]!.id;

  it("creates every table", async () => {
    const tables = await sql`select table_name from information_schema.tables where table_schema = 'public'`;
    expect(tables.map((t) => t.table_name).sort()).toEqual([
      "branches",
      "chains",
      "entities",
      "entity_aliases",
      "ingest_runs",
      "payment_media",
      "payment_medium_aliases",
      "price_periods",
      "products",
      "promotions",
    ]);
  });

  // S8: only price changes are stored, so a product has at most one open period per branch.
  it("allows one open price period per product and branch", async () => {
    const id = await productId();
    await sql`insert into price_periods (product_id, branch_id, price, valid_from, last_seen) values (${id}, '10-1-200', 150000, '2026-11-01', '2026-11-18')`;
    await expect(
      sql`insert into price_periods (product_id, branch_id, price, valid_from, last_seen) values (${id}, '10-1-200', 160000, '2026-11-19', '2026-11-19')`,
    ).rejects.toThrow(/price_periods_one_open/);
  });

  it("keeps closed periods as history", async () => {
    const id = (await sql`insert into products (ean, description) values ('7790000000002', 'Arroz 1 kg') returning id`)[0]!.id;
    await sql`insert into price_periods (product_id, branch_id, price, valid_from, valid_to, last_seen) values (${id}, '10-1-200', 150000, '2026-11-01', '2026-11-19', '2026-11-18')`;
    await sql`insert into price_periods (product_id, branch_id, price, valid_from, last_seen) values (${id}, '10-1-200', 160000, '2026-11-19', '2026-11-19')`;
    const history = await sql`select price from price_periods where product_id = ${id} order by valid_from`;
    expect(history.map((p) => p.price)).toEqual([150000, 160000]);
  });

  it("rejects a period that ends before it starts", async () => {
    const id = await productId();
    await expect(
      sql`insert into price_periods (product_id, branch_id, price, valid_from, valid_to, last_seen) values (${id}, '10-1-200', 1, '2026-10-10', '2026-10-01', '2026-10-10')`,
    ).rejects.toThrow(/price_periods_valid_range/);
  });

  // S10: products are identified by EAN, or by the chain's own code when there is none.
  it("requires an EAN or a chain product code", async () => {
    await expect(sql`insert into products (description) values ('Sin código')`).rejects.toThrow(/products_identity/);
    await sql`insert into products (chain_id, chain_product_code, description) values ('coto', 'C-1', 'Pan del día')`;
    await expect(
      sql`insert into products (chain_id, chain_product_code, description) values ('coto', 'C-1', 'Otro pan')`,
    ).rejects.toThrow(/products_chain_code/);
  });

  it("rejects a duplicate EAN", async () => {
    await expect(sql`insert into products (ean, description) values ('7790000000001', 'Otra yerba')`).rejects.toThrow(
      /products_ean/,
    );
  });

  // S12: a cap is an amount with its period, or unknown, or absent.
  it("rejects an inconsistent cap", async () => {
    const insert = (cap: { amount: number | null; period: string | null; unknown: boolean }) =>
      sql`insert into promotions (id, chain_id, kind, percent, channel, valid_from, valid_to, cap_amount, cap_period, cap_unknown)
          values (${randomUUID()}, 'coto', 'refund', 20, 'both', '2026-11-01', '2026-11-30', ${cap.amount}, ${cap.period}, ${cap.unknown})`;
    await insert({ amount: 1500000, period: "month", unknown: false });
    await insert({ amount: null, period: null, unknown: true });
    await expect(insert({ amount: 1500000, period: null, unknown: false })).rejects.toThrow(/promotions_cap/);
    await expect(insert({ amount: 1500000, period: "month", unknown: true })).rejects.toThrow(/promotions_cap/);
  });

  it("rejects a percent outside (0, 100]", async () => {
    await expect(
      sql`insert into promotions (id, chain_id, kind, percent, channel, valid_from, valid_to) values ('p-0', 'coto', 'discount', 0, 'both', '2026-11-01', '2026-11-30')`,
    ).rejects.toThrow(/promotions_percent/);
  });

  // The ingest worker migrates on every start.
  it("migrates again without changes", async () => {
    await migrate(url.toString());
    const rows = await sql`select count(*)::int as count from drizzle.__drizzle_migrations`;
    expect(rows[0]!.count).toBe(1);
  });

  // S18: each adapter maps its raw entity names to the canonical catalog.
  it("maps raw entity names per source to the canonical catalog", async () => {
    await sql`insert into entities (id, name) values ('galicia', 'Banco Galicia')`;
    await sql`insert into entity_aliases (source, raw, entity_id) values ('coto', 'BANCO GALICIA', 'galicia')`;
    await expect(
      sql`insert into entity_aliases (source, raw, entity_id) values ('coto', 'BANCO X', 'unknown-bank')`,
    ).rejects.toThrow(/foreign key/);
  });
});
