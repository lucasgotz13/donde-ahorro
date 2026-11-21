import { readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createTestDatabase } from "@donde-ahorro/db/test-database";
import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { upsertChains } from "../../sepa/load.ts";
import { runCarrefour } from "./run.ts";
import { parseCarrefourPromotions, scrapeCarrefour } from "./scrape.ts";

// Real MasterData responses behind www.carrefour.com.ar/descuentos-bancarios, saved on 2026-11-21.
const fixture = async (name: string) => JSON.parse(await readFile(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8"));
const source = { promotions: await fixture("promotions"), banks: await fixture("banks"), cards: await fixture("cards") };
const parsed = parseCarrefourPromotions(source);
const byId = (id: string) => parsed.filter((p) => p.id.startsWith(`carrefour:${id}:`));

// S11, S12, S18, S23.
describe("parseCarrefourPromotions", () => {
  it("emits one promotion per chain for the 27 percentage promotions, skipping the 4 installment-only ones", () => {
    expect(parsed).toHaveLength(92);
    expect(new Set(parsed.map((p) => p.id.split(":")[1])).size).toBe(27);
    expect(byId("7e387f4d-6b23-4b35-b4dd-67b53f131fec")).toEqual([]);
  });

  it("maps an in-store and online Carrefour credit card discount", () => {
    const promos = byId("fde9dbc1-5134-4b4f-9279-14440543c66d");
    expect(promos.map((p) => p.chainId)).toEqual(["carrefour-hiper", "carrefour-market", "carrefour-express"]);
    expect(promos[0]).toEqual({
      id: "carrefour:fde9dbc1-5134-4b4f-9279-14440543c66d:carrefour-hiper",
      chainId: "carrefour-hiper",
      kind: "discount",
      percent: 20,
      rawEntity: "Tarjeta_Standard_Master_Carrefour",
      rawMedium: "crédito",
      weekdays: [2],
      cap: null,
      channel: "both",
      validFrom: "2026-09-01",
      validTo: "2026-11-30",
      legalText: expect.stringMatching(/^SUJETO A CONDICIONES/),
      stackable: false,
    });
  });

  it("applies an online-only promotion to every Carrefour chain and takes its cap from the legal text", () => {
    const promos = byId("2cee4dd0-913d-4f55-ba73-c220bde89c61");
    expect(promos.map((p) => p.chainId)).toEqual(["carrefour-hiper", "carrefour-market", "carrefour-express", "carrefour-maxi"]);
    expect(promos[3]).toMatchObject({
      percent: 20,
      rawEntity: "Patagonia",
      rawMedium: null,
      channel: "online",
      weekdays: [3],
      cap: { amount: 1_500_000, period: "month" },
      validFrom: "2026-11-01",
      validTo: "2026-11-30",
    });
  });

  it("keeps rawEntity null only for an any-payment-method promotion", () => {
    expect(byId("41bd454d-0113-44ca-8848-c6950450ba95")[0]).toMatchObject({
      rawEntity: null,
      rawMedium: null,
      percent: 10,
      weekdays: [4],
      cap: { amount: 800_000, period: "week" },
    });
  });

  it("maps a wallet discount on account money at Maxi only", () => {
    expect(byId("23af46b4-aad8-4ab6-9716-29bda4307a1b")).toEqual([
      expect.objectContaining({ chainId: "carrefour-maxi", channel: "in-store", kind: "discount", rawEntity: "Mercado Pago", rawMedium: "dinero en cuenta", cap: null, stackable: true }),
    ]);
  });

  it("never turns a promotion without an entity into an any-entity one", () => {
    const [promo] = byId("4f9ac242-778f-11f0-b37f-f9b6f2b5c87b");
    expect(promo!.rawEntity).toBe("Si sos empleado/a público todos los jueves");
    expect(new Set(parsed.filter((p) => p.rawEntity === null).map((p) => p.id.split(":")[1]))).toEqual(new Set(["41bd454d-0113-44ca-8848-c6950450ba95"]));
  });

  it("names the entity from the card when the bank is missing", () => {
    expect(byId("84a8157a-2bbd-4053-98a7-2cb48f4a860e")[0]).toMatchObject({ rawEntity: "Cuenta Digital", cap: { amount: 1_000_000, period: "week" }, stackable: true });
  });
});

// A local stand-in for www.carrefour.com.ar: never the live site.
let server: Server;
let base: string;
const requests: string[] = [];
let fail = false;

beforeAll(async () => {
  server = createServer((req, res) => {
    requests.push(`${req.url} ${req.headers["user-agent"]}`);
    if (req.url === "/robots.txt") return res.end("User-agent: *\nDisallow: /checkout/*\n");
    const entity = /^\/api\/dataentities\/(BP|FB|FC)\/search/.exec(req.url ?? "")?.[1];
    if (fail || !entity) return res.writeHead(fail ? 500 : 404).end();
    const body = { BP: source.promotions, FB: source.banks, FC: source.cards }[entity];
    res.writeHead(200, { "content-type": "application/json", "rest-content-range": `resources 0-${body.length}/${body.length}` });
    res.end(JSON.stringify(body));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise((resolve) => server.close(resolve)));

describe("scrapeCarrefour", () => {
  it("checks robots.txt, identifies itself and asks only for promotions active now", async () => {
    requests.length = 0;
    expect(await scrapeCarrefour(base, new Date("2026-11-21T15:00:00Z"))).toEqual(parsed);
    expect(requests[0]).toMatch(/^\/robots\.txt /);
    const bp = new URL(requests.find((r) => r.startsWith("/api/dataentities/BP"))!.split(" ")[0]!, base).searchParams;
    expect(bp.get("_where")).toBe("active=true AND ((active_from < 2026-11-21T15:00:00) AND (active_to > 2026-11-21T15:00:00))");
    expect(requests.every((r) => r.endsWith("donde-ahorro (self-hosted price comparison)"))).toBe(true);
  });

  it("throws on a non-OK response", async () => {
    fail = true;
    await expect(scrapeCarrefour(base)).rejects.toThrow(/HTTP 500/);
    fail = false;
  });
});

const adminUrl = process.env.DATABASE_URL;

// S18, S22, S23: stored rows and the run log.
describe.skipIf(!adminUrl)("runCarrefour", () => {
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  let sql: postgres.Sql;

  beforeAll(async () => {
    db = await createTestDatabase(adminUrl!);
    sql = db.sql;
    await upsertChains(sql);
  });
  afterAll(() => db?.drop());

  it("stores mapped promotions, skips unknown entities and logs the run", async () => {
    await runCarrefour(sql, { baseUrl: base, env: {} });
    const [run] = await sql`select source, status, stats from ingest_runs order by id desc limit 1`;
    expect(run).toMatchObject({ source: "carrefour", status: "succeeded" });
    const reasons = new Set(run!.stats.skipped.map((s: { reason: string }) => s.reason));
    expect(reasons).toEqual(
      new Set([
        "entidad desconocida: Cuenta Digital",
        "entidad desconocida: Mi Carrefour",
        "entidad desconocida: Ahorra con MODO. 10% Acumulable. Pagando desde tu App.",
        "entidad desconocida: Si sos empleado/a público todos los jueves",
        "entidad desconocida: Si sos empleada/o público todos los miércoles",
      ]),
    );
    expect(run!.stats.saved + run!.stats.skipped.length).toBe(92);
    const rows = await sql`select id, chain_id, kind, percent, entity_id, payment_medium_id, weekdays, cap_amount, cap_period, cap_unknown, channel, valid_from, valid_to, stackable from promotions order by id`;
    expect(rows).toHaveLength(run!.stats.saved);
    expect(rows.some((r) => r.entity_id === null && !r.id.startsWith("carrefour:41bd454d"))).toBe(false);
    expect(rows.find((r) => r.id === "carrefour:fde9dbc1-5134-4b4f-9279-14440543c66d:carrefour-hiper")).toMatchObject({
      chain_id: "carrefour-hiper",
      kind: "discount",
      percent: "20.00",
      entity_id: "tarjeta-carrefour",
      payment_medium_id: "credit",
      weekdays: [2],
      cap_amount: null,
      cap_unknown: false,
      channel: "both",
      stackable: false,
    });
    expect(rows.find((r) => r.id === "carrefour:2cee4dd0-913d-4f55-ba73-c220bde89c61:carrefour-maxi")).toMatchObject({
      entity_id: "patagonia",
      payment_medium_id: null,
      cap_amount: 1_500_000,
      cap_period: "month",
      channel: "online",
    });
  });
});
