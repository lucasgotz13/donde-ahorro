import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  getBranches,
  getCartProducts,
  getChainNames,
  getSourceStatus,
  promotionCoverage,
  getPaymentCatalog,
  getPriceHistory,
  getProduct,
  getPromotions,
  lastSepaUpdate,
  nearestBranches,
  searchBranches,
  searchProducts,
  similarProducts,
} from "./queries.ts";
import { createTestDatabase } from "./test-database.ts";

const adminUrl = process.env.DATABASE_URL;

describe.skipIf(!adminUrl)("product queries", () => {
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  let sql: postgres.Sql;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    db = await createTestDatabase(adminUrl!);
    sql = db.sql;
    await sql`insert into chains (id, name, sepa_comercio_id, sepa_bandera_id) values
      ('coto', 'Coto', 12, 1), ('dia', 'Día', 15, 1), ('jumbo', 'Jumbo', 9, 3)`;
    await sql`insert into branches (id, chain_id, name, address, lat, lng) values
      ('12-1-1', 'coto', 'Coto Caballito', 'Av. Rivadavia 5000', -34.6183, -58.4365),
      ('12-1-2', 'coto', 'Coto Palermo', 'Av. Santa Fe 3000', -34.5880, -58.4110),
      ('15-1-1', 'dia', 'Día Almagro', 'Medrano 800', -34.6030, -58.4200),
      ('9-3-1', 'jumbo', 'Jumbo Palermo', 'Bullrich 345', -34.5750, -58.4270)`;
    const product = async (key: string, fields: Record<string, string | null>) => {
      const [row] = await sql`insert into products ${sql(fields)} returning id::text`;
      ids[key] = row!.id;
    };
    await product("dulce", { ean: "7790001", description: "DULCE DE LECHE CLASICO LA SERENISIMA POT 400 GRM", brand: "LA SERENISIMA", presentation: "400 grm" });
    await product("dulceRepostero", { ean: "7790002", description: "DULCE DE LECHE REPOSTERO LA SERENISIMA POT 400 GRM", brand: "LA SERENISIMA", presentation: "400 grm" });
    await product("crema", { ean: "7790003", description: "CREMA DE LECHE LA SERENISIMA POT 200 CC", brand: "LA SERENISIMA", presentation: "200 cmq" });
    await product("bano", { ean: "7790004", description: "BAÑO REPOSTERO LECHE AGUILA SCH 150 GRM", brand: "AGUILA", presentation: "150 grm" });
    await product("leche", { ean: "7790005", description: "LECHE ENTERA LA SERENISIMA SACHET 1 LT", brand: "LA SERENISIMA", presentation: "1 lt" });
    const period = (key: string, branch: string, price: number, from: string, to: string | null, lastSeen: string) =>
      sql`insert into price_periods (product_id, branch_id, price, valid_from, valid_to, last_seen) values (${ids[key]!}, ${branch}, ${price}, ${from}, ${to}, ${lastSeen})`;
    await period("dulce", "12-1-1", 250000, "2026-11-01", "2026-11-10", "2026-11-09");
    await period("dulce", "12-1-1", 270000, "2026-11-10", null, "2026-11-20");
    await period("dulce", "12-1-2", 260000, "2026-11-01", null, "2026-11-20");
    await period("dulce", "15-1-1", 240000, "2026-11-05", null, "2026-11-12");
    await period("dulce", "9-3-1", 300000, "2026-11-01", "2026-11-08", "2026-11-07");
    await period("dulceRepostero", "12-1-1", 280000, "2026-11-01", null, "2026-11-20");
    await period("leche", "15-1-1", 150000, "2026-11-01", null, "2026-11-20");
  });
  afterAll(() => db?.drop());

  describe("searchProducts", () => {
    it("matches every word in any order, without accents or case", async () => {
      const found = await searchProducts(sql, "serenisima  dulce");
      expect(found.map((p) => p.id)).toEqual([ids.dulce, ids.dulceRepostero]);
      expect((await searchProducts(sql, "baño")).map((p) => p.id)).toEqual([ids.bano]);
      expect((await searchProducts(sql, "BANO")).map((p) => p.id)).toEqual([ids.bano]);
    });

    it("lists descriptions that start with the first word first, then those sold by more chains, then shorter ones", async () => {
      // dulce: 2 chains; dulceRepostero: 1; crema and bano: 0, equal lengths, so insertion order.
      expect((await searchProducts(sql, "leche")).map((p) => p.id)).toEqual([ids.leche, ids.dulce, ids.dulceRepostero, ids.crema, ids.bano]);
    });

    it("finds a product by its EAN", async () => {
      expect((await searchProducts(sql, "7790003")).map((p) => p.id)).toEqual([ids.crema]);
    });

    it("returns the cheapest current price and how many chains sell it", async () => {
      const [dulce] = await searchProducts(sql, "dulce clasico");
      expect(dulce).toEqual({
        id: ids.dulce,
        description: "DULCE DE LECHE CLASICO LA SERENISIMA POT 400 GRM",
        brand: "LA SERENISIMA",
        presentation: "400 grm",
        minPrice: 240000,
        chains: 2,
      });
      const [bano] = await searchProducts(sql, "baño");
      expect(bano).toMatchObject({ minPrice: null, chains: 0 });
    });

    it("returns nothing for a blank query or one without a word of 3 letters", async () => {
      expect(await searchProducts(sql, "   ")).toEqual([]);
      expect(await searchProducts(sql, "de la")).toEqual([]);
      expect((await searchProducts(sql, "de la dulce")).map((p) => p.id)).toEqual([ids.dulce, ids.dulceRepostero]);
    });
  });

  describe("getProduct", () => {
    it("groups current prices by chain, cheapest chain first, with every branch", async () => {
      const product = await getProduct(sql, ids.dulce!);
      expect(product).toMatchObject({ id: ids.dulce, ean: "7790001", brand: "LA SERENISIMA" });
      expect(product!.chains).toEqual([
        {
          chainId: "dia",
          chainName: "Día",
          minPrice: 240000,
          maxPrice: 240000,
          lastSeen: "2026-11-12",
          branches: [{ branchId: "15-1-1", name: "Día Almagro", address: "Medrano 800", price: 240000, lastSeen: "2026-11-12" }],
        },
        {
          chainId: "coto",
          chainName: "Coto",
          minPrice: 260000,
          maxPrice: 270000,
          lastSeen: "2026-11-20",
          branches: [
            { branchId: "12-1-2", name: "Coto Palermo", address: "Av. Santa Fe 3000", price: 260000, lastSeen: "2026-11-20" },
            { branchId: "12-1-1", name: "Coto Caballito", address: "Av. Rivadavia 5000", price: 270000, lastSeen: "2026-11-20" },
          ],
        },
      ]);
    });

    // S3: only the user's branches, when they chose some.
    it("keeps only the given branches and drops chains without one", async () => {
      const product = await getProduct(sql, ids.dulce!, ["12-1-1", "9-3-1"]);
      expect(product!.chains.map((c) => [c.chainId, c.branches.map((b) => b.branchId), c.minPrice])).toEqual([["coto", ["12-1-1"], 270000]]);
    });

    it("is undefined for an unknown product", async () => {
      expect(await getProduct(sql, "999999")).toBeUndefined();
    });
  });

  it("getPriceHistory returns every period with its chain", async () => {
    const history = await getPriceHistory(sql, ids.dulce!);
    expect(history).toHaveLength(5);
    expect(history).toContainEqual({ chainId: "jumbo", chainName: "Jumbo", price: 300000, validFrom: "2026-11-01", validTo: "2026-11-08" });
    expect((await getPriceHistory(sql, ids.dulce!, ["12-1-2"])).map((h) => h.price)).toEqual([260000]);
  });

  // S10: description matches are shown as "productos similares", never merged.
  it("similarProducts shares brand, presentation and first word, excluding the product itself", async () => {
    const similar = await similarProducts(sql, ids.dulce!);
    expect(similar).toEqual([{ id: ids.dulceRepostero, description: "DULCE DE LECHE REPOSTERO LA SERENISIMA POT 400 GRM", presentation: "400 grm", minPrice: 280000 }]);
  });

  it("lastSepaUpdate is the publication of the latest succeeded SEPA run", async () => {
    expect(await lastSepaUpdate(sql)).toBeUndefined();
    await sql`insert into ingest_runs (source, status, source_last_modified, started_at) values
      ('sepa', 'succeeded', '2026-11-19T16:19:56Z', '2026-11-19T17:00:00Z'),
      ('sepa', 'skipped', '2026-11-13T16:19:56Z', '2026-11-20T17:00:00Z')`;
    expect((await lastSepaUpdate(sql))?.toISOString()).toBe("2026-11-19T16:19:56.000Z");
  });

  // S3: branch selection.
  describe("branches", () => {
    const names = (rows: { name: string }[]) => rows.map((r) => r.name);

    it("nearestBranches sorts by distance and says how far each one is", async () => {
      // Av. Rivadavia 5000, as Georef geocodes it.
      const near = await nearestBranches(sql, { lat: -34.6183, lng: -58.4365 }, 3);
      expect(names(near)).toEqual(["Coto Caballito", "Día Almagro", "Coto Palermo"]);
      expect(near[0]).toMatchObject({ id: "12-1-1", chainName: "Coto", address: "Av. Rivadavia 5000", meters: 0 });
      // About 1.70 km north and 1.51 km east: 2.27 km.
      expect(near[1]!.meters).toBeGreaterThan(2200);
      expect(near[1]!.meters).toBeLessThan(2350);
    });

    it("searchBranches matches every word of chain, name or address, without accents", async () => {
      expect(names(await searchBranches(sql, "palermo"))).toEqual(["Coto Palermo", "Jumbo Palermo"]);
      expect(names(await searchBranches(sql, "coto palermo"))).toEqual(["Coto Palermo"]);
      expect(names(await searchBranches(sql, "dia medrano"))).toEqual(["Día Almagro"]);
      expect(await searchBranches(sql, "  ")).toEqual([]);
    });

    it("getBranches returns the given ids, ignoring unknown ones", async () => {
      expect(names(await getBranches(sql, ["9-3-1", "nope", "12-1-1"]))).toEqual(["Coto Caballito", "Jumbo Palermo"]);
      expect(await getBranches(sql, [])).toEqual([]);
    });
  });

  // S12, S18: promotions as the core model, and the catalog the user picks from.
  describe("promotions", () => {
    beforeAll(async () => {
      await sql`insert into entities (id, name) values ('galicia', 'Banco Galicia'), ('modo', 'MODO'), ('nacion', 'Banco Nación')`;
      await sql`insert into payment_media (id, name) values ('credit', 'Tarjeta de crédito'), ('debit', 'Tarjeta de débito')`;
      await sql`insert into eligibility_conditions (id, name) values ('comunidad-coto', 'Comunidad Coto')`;
      await sql`insert into promotions (id, chain_id, kind, percent, entity_id, payment_medium_id, weekdays, cap_amount, cap_period, cap_unknown, channel, valid_from, valid_to, legal_text, stackable, conditions) values
        ('coto:1', 'coto', 'refund', 25, 'galicia', 'credit', '{3}', 1000000, 'month', false, 'in-store', '2026-11-01', '2026-11-30', 'Tope $10.000 por mes', null, '{}'),
        ('coto:2', 'coto', 'discount', 15, null, null, '{}', null, null, false, 'in-store', '2026-11-01', '2026-11-30', '', true, '{comunidad-coto}'),
        ('dia:1', 'dia', 'discount', 10, 'modo', null, '{}', null, null, true, 'both', '2026-11-01', '2026-11-30', '', null, '{}')`;
    });

    it("getPromotions maps rows of the given chains to the core model", async () => {
      const promos = await getPromotions(sql, ["coto"]);
      expect(promos).toEqual([
        {
          id: "coto:1", chainId: "coto", kind: "refund", percent: 25, entity: "galicia", paymentMedium: "credit",
          weekdays: [3], cap: { amount: 1000000, period: "month" }, channel: "in-store",
          validFrom: "2026-11-01", validTo: "2026-11-30", legalText: "Tope $10.000 por mes", conditions: [],
        },
        {
          id: "coto:2", chainId: "coto", kind: "discount", percent: 15, entity: null, paymentMedium: null,
          weekdays: [], cap: null, channel: "in-store",
          validFrom: "2026-11-01", validTo: "2026-11-30", legalText: "", stackable: true, conditions: ["comunidad-coto"],
        },
      ]);
      expect((await getPromotions(sql, ["dia"]))[0]).toMatchObject({ cap: "unknown", channel: "both" });
      expect(await getPromotions(sql, [])).toEqual([]);
    });

    it("getPaymentCatalog lists entities with promotions, every medium and every condition", async () => {
      expect(await getPaymentCatalog(sql)).toEqual({
        entities: [{ id: "galicia", name: "Banco Galicia" }, { id: "modo", name: "MODO" }],
        media: [{ id: "credit", name: "Tarjeta de crédito" }, { id: "debit", name: "Tarjeta de débito" }],
        conditions: [{ id: "comunidad-coto", name: "Comunidad Coto" }],
      });
    });
  });

  // S17: each cart product with its cheapest current price per chain.
  describe("getCartProducts", () => {
    it("returns the given products with their cheapest price per chain, in the given order", async () => {
      const cart = await getCartProducts(sql, [ids.leche!, ids.dulce!, "999999"]);
      expect(cart).toEqual([
        { id: ids.leche, description: "LECHE ENTERA LA SERENISIMA SACHET 1 LT", presentation: "1 lt", prices: { dia: 150000 } },
        { id: ids.dulce, description: "DULCE DE LECHE CLASICO LA SERENISIMA POT 400 GRM", presentation: "400 grm", prices: { coto: 260000, dia: 240000 } },
      ]);
    });

    it("getChainNames maps chain ids to names", async () => {
      expect(await getChainNames(sql)).toEqual({ coto: "Coto", dia: "Día", jumbo: "Jumbo" });
    });

    it("only looks at the given branches", async () => {
      const [dulce] = await getCartProducts(sql, [ids.dulce!], ["12-1-1"]);
      expect(dulce!.prices).toEqual({ coto: 270000 });
      expect(await getCartProducts(sql, [])).toEqual([]);
    });
  });

  // S23: the ingest-run log as the /estado page shows it; S11: whose promotions we have.
  describe("source status", () => {
    const now = new Date("2026-11-21T18:00:00Z");
    beforeAll(async () => {
      await sql`delete from ingest_runs`;
      await sql`insert into ingest_runs (source, status, started_at, finished_at, source_last_modified, message) values
        ('sepa', 'succeeded', '2026-11-20T17:00:00Z', '2026-11-20T17:05:00Z', '2026-11-20T16:19:00Z', null),
        ('sepa', 'skipped', '2026-11-21T17:00:00Z', '2026-11-21T17:00:01Z', '2026-11-20T16:19:00Z', 'SEPA ZIP for sabado not published yet'),
        ('coto', 'succeeded', '2026-11-21T17:01:00Z', '2026-11-21T17:01:05Z', null, null),
        ('carrefour', 'succeeded', '2026-11-18T17:01:00Z', '2026-11-18T17:01:05Z', null, null),
        ('carrefour', 'failed', '2026-11-21T17:01:00Z', '2026-11-21T17:01:02Z', null, 'Error: HTTP 503')`;
    });

    it("getSourceStatus gives each source's last run and last success", async () => {
      const status = await getSourceStatus(sql);
      expect(status.map((s) => [s.source, s.lastRun?.status, s.lastRun?.message, s.lastSuccess?.toISOString()])).toEqual([
        ["sepa", "skipped", "SEPA ZIP for sabado not published yet", "2026-11-20T17:05:00.000Z"],
        ["coto", "succeeded", null, "2026-11-21T17:01:05.000Z"],
        ["carrefour", "failed", "Error: HTTP 503", "2026-11-18T17:01:05.000Z"],
      ]);
      expect(status[0]!.publishedAt?.toISOString()).toBe("2026-11-20T16:19:00.000Z");
    });

    it("promotionCoverage marks chains whose promotions were scraped in the last 48 hours", async () => {
      expect(await promotionCoverage(sql, now)).toEqual({
        coto: true,
        "carrefour-hiper": false,
        "carrefour-market": false,
        "carrefour-express": false,
        "carrefour-maxi": false,
      });
    });
  });
});
