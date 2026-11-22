import { createTestDatabase } from "@donde-ahorro/db/test-database";
import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { upsertChains } from "../sepa/load.ts";
import { runPromotionSource, type ScrapedPromotion } from "./store.ts";

const adminUrl = process.env.DATABASE_URL;

const promo = (fields: Partial<ScrapedPromotion> = {}): ScrapedPromotion => ({
  id: "test:1",
  chainId: "coto",
  kind: "refund",
  percent: 25,
  rawEntity: "BANCO GALICIA",
  rawMedium: "Crédito",
  weekdays: [3],
  cap: { amount: 1_000_000, period: "month" },
  channel: "in-store",
  validFrom: "2026-11-01",
  validTo: "2026-11-30",
  legalText: "Tope de reintegro $10.000 por mes.",
  ...fields,
});

const aliases = {
  entities: { "BANCO GALICIA": "galicia" },
  media: { "Crédito": "credit" },
  conditions: { "logo_comunidad.png": "comunidad-coto" },
};

// S11, S12, S18, S22, S23.
describe.skipIf(!adminUrl)("runPromotionSource", () => {
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  let sql: postgres.Sql;
  const run = (scrape: () => Promise<ScrapedPromotion[]>, env: Record<string, string | undefined> = {}) =>
    runPromotionSource(sql, { source: "test", aliases, scrape, env });
  const rows = () => sql`select id, entity_id, payment_medium_id, weekdays, percent, cap_amount, cap_period, cap_unknown from promotions order by id`;
  const lastRun = async () => (await sql`select source, status, message, stats from ingest_runs order by id desc limit 1`)[0];

  beforeAll(async () => {
    db = await createTestDatabase(adminUrl!);
    sql = db.sql;
    await upsertChains(sql);
  });
  afterAll(() => db?.drop());
  beforeEach(() => sql`delete from promotions`);

  it("stores mapped promotions and logs a succeeded run", async () => {
    await run(async () => [promo()]);
    expect(await rows()).toEqual([
      { id: "test:1", entity_id: "galicia", payment_medium_id: "credit", weekdays: [3], percent: "25.00", cap_amount: 1_000_000, cap_period: "month", cap_unknown: false },
    ]);
    expect(await lastRun()).toMatchObject({ source: "test", status: "succeeded", stats: { saved: 1, skipped: [] } });
  });

  it("keeps a null raw entity as `any entity` and an unknown cap as cap_unknown", async () => {
    await run(async () => [promo({ rawEntity: null, rawMedium: null, cap: "unknown" })]);
    expect(await rows()).toMatchObject([{ entity_id: null, payment_medium_id: null, cap_amount: null, cap_unknown: true }]);
  });

  it("skips an unmapped entity or medium and logs `entidad desconocida`, never storing it as null", async () => {
    await run(async () => [promo({ id: "test:1", rawEntity: "Banco Marciano" }), promo({ id: "test:2", rawMedium: "Trueque" }), promo({ id: "test:3" })]);
    expect((await rows()).map((r) => r.id)).toEqual(["test:3"]);
    expect((await lastRun())!.stats).toEqual({
      saved: 1,
      skipped: [
        { id: "test:1", reason: "entidad desconocida: Banco Marciano" },
        { id: "test:2", reason: "medio de pago desconocido: Trueque" },
      ],
    });
  });

  it("maps eligibility conditions and skips an unknown one instead of dropping it", async () => {
    await run(async () => [
      promo({ id: "test:1", rawEntity: null, rawConditions: ["logo_comunidad.png"] }),
      promo({ id: "test:2", rawConditions: ["logo_comunidad.png", "Socio Marciano"] }),
    ]);
    expect(await sql`select id, conditions from promotions order by id`).toEqual([{ id: "test:1", conditions: ["comunidad-coto"] }]);
    expect((await lastRun())!.stats.skipped).toEqual([{ id: "test:2", reason: "condición desconocida: Socio Marciano" }]);
    expect(await sql`select name from eligibility_conditions where id = 'comunidad-coto'`).toEqual([{ name: "Comunidad Coto" }]);
  });

  it("skips invalid weekdays and percents", async () => {
    await run(async () => [promo({ id: "test:1", weekdays: [7] }), promo({ id: "test:2", percent: 0 }), promo({ id: "test:3", percent: 120 }), promo({ id: "test:4", weekdays: [1.5] }), promo({ id: "test:5" })]);
    expect((await rows()).map((r) => r.id)).toEqual(["test:5"]);
    expect((await lastRun())!.stats.skipped.map((s: { reason: string }) => s.reason)).toEqual([
      "día inválido: 7",
      "porcentaje inválido: 0",
      "porcentaje inválido: 120",
      "día inválido: 1.5",
    ]);
  });

  it("replaces only this source's promotions on each run", async () => {
    await sql`insert into promotions (id, chain_id, kind, percent, channel, valid_from, valid_to) values ('other:1', 'coto', 'discount', 10, 'both', '2026-11-01', '2026-11-30')`;
    await run(async () => [promo({ id: "test:1" }), promo({ id: "test:2" })]);
    await run(async () => [promo({ id: "test:2" })]);
    expect((await rows()).map((r) => r.id)).toEqual(["other:1", "test:2"]);
  });

  it("keeps the previous promotions and logs a failed run when the scrape fails", async () => {
    await run(async () => [promo()]);
    await expect(run(async () => { throw new Error("HTTP 503"); })).rejects.toThrow("HTTP 503");
    expect((await rows()).map((r) => r.id)).toEqual(["test:1"]);
    expect(await lastRun()).toMatchObject({ status: "failed", message: "Error: HTTP 503" });
  });

  it("keeps the previous promotions and logs a failed run when every scraped promotion is rejected", async () => {
    await run(async () => [promo()]);
    await expect(run(async () => [promo({ id: "test:2", rawEntity: "Banco Marciano" })])).rejects.toThrow("every scraped promotion was rejected");
    expect((await rows()).map((r) => r.id)).toEqual(["test:1"]);
    expect(await lastRun()).toMatchObject({
      status: "failed",
      message: "Error: every scraped promotion was rejected (1), first: entidad desconocida: Banco Marciano",
    });
  });

  it("does not scrape when the source is disabled by configuration", async () => {
    let called = false;
    await run(async () => { called = true; return []; }, { PROMOS_DISABLED: "coto, test" });
    expect(called).toBe(false);
    expect(await lastRun()).toMatchObject({ status: "skipped", message: "test disabled by PROMOS_DISABLED" });
  });
});
