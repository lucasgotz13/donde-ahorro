import { readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createTestDatabase } from "@donde-ahorro/db/test-database";
import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { upsertChains } from "../../sepa/load.ts";
import { USER_AGENT } from "../../sepa/download.ts";
import { runCoto } from "./run.ts";
import { parseCotoPromotions, scrapeCoto } from "./scrape.ts";

// Real response of getPromocionesMulticanal, saved on 2026-11-21: 37 online and 49 in-store records.
const raw = await readFile(new URL("./fixtures/promociones-2026-11-21.json", import.meta.url), "utf8");
const fixture = JSON.parse(raw);
const today = "2026-11-21";
const byId = (id: string) => parseCotoPromotions(fixture, today).find((p) => p.id === id);

// S11, S12, S18.
describe("parseCotoPromotions", () => {
  it("keeps the percent promotions with days and skips installment plans", () => {
    const all = parseCotoPromotions(fixture, today);
    // 14 online + 24 in-store percent promotions; 4 in-store ones list no days.
    expect(all.filter((p) => p.channel === "online")).toHaveLength(14);
    expect(all.filter((p) => p.channel === "in-store")).toHaveLength(20);
    expect(all.some((p) => /CUOTAS/.test(p.legalText) && p.id === "coto:496")).toBe(false);
    expect(new Set(all.map((p) => p.id)).size).toBe(34);
    // Coto always names the entity, except where an eligibility condition (Visa NFC, Comunidad Coto) replaces it.
    expect(all.filter((p) => p.rawEntity === null).map((p) => [p.id, p.rawConditions]).sort()).toEqual([
      ["coto:467", ["logo_comunidad.png"]],
      ["coto:527", ["logo_visa1.png"]],
    ]);
  });

  it("maps an online bank refund with a per-transaction cap", () => {
    expect(byId("coto:457")).toEqual({
      id: "coto:457",
      chainId: "coto",
      kind: "refund",
      percent: 30,
      rawEntity: "logo_icbc_1.png",
      // credit and debit cards both qualify
      rawMedium: null,
      weekdays: [1],
      cap: { amount: 2_000_000, period: "transaction" },
      channel: "online",
      validFrom: "2026-11-21",
      validTo: "2026-11-27",
      legalText:
        "PLAN SUELDO En un pago con tarjetas de crédito Visa, Mastercard y Visa débito. Tope de Reintegro de $20.000 por transacción. Aplican exclusiones. Ver legales.",
    });
  });

  it("maps an in-store MODO promotion with dated validity and weekend days", () => {
    expect(byId("coto:450")).toMatchObject({
      kind: "refund",
      percent: 30,
      rawEntity: "logo_credicoop.png",
      rawMedium: "QR",
      weekdays: [0, 6],
      cap: null,
      channel: "in-store",
      validFrom: "2026-11-21",
      validTo: "2026-11-22",
    });
  });

  it("reads validity from the first two dates, across the new year and ignoring later dates", () => {
    const valid = (descripcion: string) => {
      const promo = { id: "1", icono: "logo_credicoop.png", textoDescuento: "20% DE DESCUENTO", descripcion, observacion: null, dias: [{ id: 2 }] };
      const [p] = parseCotoPromotions({ result: { promocionesDigitales: [promo], promocionesSucursalesFisicas: [] } }, "2026-12-29");
      return [p!.validFrom, p!.validTo];
    };
    expect(valid("Vigencia del 28/12 al 03/01/2027.")).toEqual(["2026-12-28", "2027-01-03"]);
    expect(valid("Vigencia del 28/12 al 03/01.")).toEqual(["2026-12-28", "2027-01-03"]);
    expect(valid("Del 01/11 al 30/11/2026. El reintegro se acredita el 15/12/2026.")).toEqual(["2026-11-01", "2026-11-30"]);
  });

  it("reads an additional percent, explicit stacking and an unparsed cap", () => {
    expect(byId("coto:451")).toMatchObject({ percent: 10, stackable: true, cap: "unknown", weekdays: [0, 6] });
    expect(byId("coto:450")!.stackable).toBeUndefined();
  });

  it("maps the medium from the description and a discount without refund wording", () => {
    expect(byId("coto:482")).toMatchObject({ rawEntity: "logo_tci.png", rawMedium: "crédito", kind: "refund", weekdays: [2] });
    expect(byId("coto:539")).toMatchObject({ rawEntity: "Personal_pay.png", rawMedium: "prepaga" });
    expect(byId("coto:458")).toMatchObject({ kind: "discount", percent: 15, rawMedium: null, weekdays: [4] });
  });

  it("skips a percent promotion without days instead of treating it as every day", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(byId("coto:435")).toBeUndefined();
    expect(warn).toHaveBeenCalledWith("[coto] coto:435 skipped: sin días");
    warn.mockRestore();
  });

  it("rejects a response without the promotion lists", () => {
    expect(() => parseCotoPromotions({ codigoError: "x" }, today)).toThrow(/Coto/);
  });
});

// A local stand-in for coto.com.ar: never the live site.
let server: Server;
let base: string;
const requests: string[] = [];
let status = 200;

beforeAll(async () => {
  server = createServer((req, res) => {
    requests.push(`${req.url} ${req.headers["user-agent"]}`);
    if (req.url === "/robots.txt") return res.end("User-agent: *\nDisallow: /myaccount/\n");
    res.writeHead(status, { "content-type": "application/json" }).end(raw);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise((resolve) => server.close(resolve)));

const promosPath = "/rest/model/atg/actors/cProfileActor/getPromocionesMulticanal?enviroment=ag";

// S22.
describe("scrapeCoto", () => {
  it("checks robots.txt and fetches with the identifiable user agent", async () => {
    requests.length = 0;
    status = 200;
    const promos = await scrapeCoto(base + promosPath, new Date("2026-11-21T15:00:00Z"));
    expect(promos).toHaveLength(34);
    expect(requests).toEqual([`/robots.txt ${USER_AGENT}`, `${promosPath} ${USER_AGENT}`]);
  });

  it("refuses a path robots.txt disallows and fails on HTTP errors", async () => {
    await expect(scrapeCoto(`${base}/myaccount/promos`)).rejects.toThrow(/robots.txt disallows/);
    status = 503;
    await expect(scrapeCoto(base + promosPath)).rejects.toThrow(/HTTP 503/);
    status = 200;
  });
});

const adminUrl = process.env.DATABASE_URL;

// S11, S18, S23.
describe.skipIf(!adminUrl)("runCoto", () => {
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  let sql: postgres.Sql;

  beforeAll(async () => {
    db = await createTestDatabase(adminUrl!);
    sql = db.sql;
    await upsertChains(sql);
  });
  afterAll(() => db?.drop());

  it("stores mapped promotions, skips unknown entities and logs the run", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await runCoto(sql, { url: base + promosPath, env: {} });
    warn.mockRestore();

    const rows = await sql`select id, chain_id, kind, percent, entity_id, payment_medium_id, weekdays, cap_amount, cap_period, cap_unknown, channel, valid_from::text, valid_to::text, stackable from promotions order by id`;
    expect(rows).toHaveLength(31);
    expect(rows.find((r) => r.id === "coto:450")).toEqual({
      id: "coto:450",
      chain_id: "coto",
      kind: "refund",
      percent: "30.00",
      entity_id: "credicoop",
      payment_medium_id: "qr",
      weekdays: [0, 6],
      cap_amount: null,
      cap_period: null,
      cap_unknown: false,
      channel: "in-store",
      valid_from: "2026-11-21",
      valid_to: "2026-11-22",
      stackable: null,
    });
    expect(rows.find((r) => r.id === "coto:457")).toMatchObject({ entity_id: "icbc", payment_medium_id: null, cap_amount: 2_000_000, cap_period: "transaction" });
    // Eligibility conditions (Visa NFC, Comunidad Coto) stand in for the entity.
    const conditioned = await sql`select id, entity_id, payment_medium_id, conditions from promotions where cardinality(conditions) > 0 order by id`;
    expect(conditioned).toEqual([
      { id: "coto:467", entity_id: null, payment_medium_id: null, conditions: ["comunidad-coto"] },
      { id: "coto:527", entity_id: null, payment_medium_id: "debit", conditions: ["visa-nfc"] },
    ]);
    // An unmapped entity is skipped, never stored as "any entity".
    expect(rows.some((r) => r.entity_id === null && !["coto:467", "coto:527"].includes(r.id))).toBe(false);

    const [run] = await sql`select source, status, stats from ingest_runs order by id desc limit 1`;
    expect(run).toMatchObject({ source: "coto", status: "succeeded", stats: { saved: 31 } });
    expect(run!.stats.skipped).toEqual(
      expect.arrayContaining([
        { id: "coto:458", reason: "entidad desconocida: logo_jubiladosypensionados.png" },
      ]),
    );
    expect(run!.stats.skipped).toHaveLength(3);
  });
});
