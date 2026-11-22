import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { parseBranch, parsePriceRow, readRecords, toCents } from "./parse.ts";

const fixture = (path: string) => createReadStream(new URL(`./fixtures/${path}`, import.meta.url));
const collect = async (input: Readable) => {
  const records = [];
  for await (const record of readRecords(input)) records.push(record);
  return records;
};
const header =
  "id_comercio|id_bandera|id_sucursal|id_producto|productos_ean|productos_descripcion|productos_cantidad_presentacion|productos_unidad_medida_presentacion|productos_marca|productos_precio_lista|productos_precio_referencia|productos_cantidad_referencia|productos_unidad_medida_referencia|productos_precio_unitario_promo1|productos_leyenda_promo1|productos_precio_unitario_promo2|productos_leyenda_promo2";

describe("readRecords", () => {
  it("joins records that SEPA splits across two lines", async () => {
    const records = await collect(fixture("coto_sepa-12/productos.csv"));
    expect(records).toHaveLength(15);
    const split = records.find((r) => r.id_producto === "7792180145963");
    expect(split).toMatchObject({
      productos_descripcion: expect.stringMatching(/^PREMEZCLA/),
      productos_precio_lista: "3569",
    });
  });

  it("strips the BOM and the CRLF line endings", async () => {
    const [first] = await collect(fixture("cencosud_sepa-9/sucursales.csv"));
    expect(Object.keys(first!)[0]).toBe("id_comercio");
    expect(Object.values(first!).some((v) => v.includes("\r"))).toBe(false);
  });

  it("stops at the blank line and the footer", async () => {
    for (const chain of ["coto_sepa-12", "carrefour_sepa-10", "dia_sepa-15", "cencosud_sepa-9"]) {
      const records = await collect(fixture(`${chain}/productos.csv`));
      expect(records.every((r) => /^\d+$/.test(r.id_comercio!))).toBe(true);
    }
  });

  it("recovers the next record after a short row and counts what it drops", async () => {
    const stats = { malformed: 0 };
    const input = Readable.from([`${header}\n12|1|44|1\n12|1|44|2|1|ARROZ|1|kg|X|100|100|1|kg||||\n12|1|44|3|1\n`]);
    const records = [];
    for await (const record of readRecords(input, stats)) records.push(record);
    expect(records.map((r) => r.id_producto)).toEqual(["2"]);
    expect(stats.malformed).toBe(2);
  });

  it("counts a row with too many fields once", async () => {
    const stats = { malformed: 0 };
    const input = Readable.from([`${header}\n12|1|44|1|1|A|1|kg|X|100|100|1|kg|||||extra\n`]);
    for await (const _ of readRecords(input, stats));
    expect(stats.malformed).toBe(1);
  });

  it("keeps double quotes as literal text", async () => {
    const input = Readable.from([`${header}\r\n12|1|44|1|0|PICADA "LA TRADICIONAL"  X KG|1|kgm|.|100|100|1|kgm||||\r\n`]);
    const [record] = await collect(input);
    expect(record!.productos_descripcion).toBe('PICADA "LA TRADICIONAL"  X KG');
  });
});

describe("toCents", () => {
  it.each([
    ["22617", 2261700],
    ["3178.99", 317899],
    [".4", 40],
    ["8922.5", 892250],
    ["12.", 1200],
  ])("converts %s to %i cents", (value, cents) => expect(toCents(value)).toBe(cents));

  it.each(["", "-190.00", "0", "abc"])("rejects %j", (value) => expect(toCents(value)).toBeNull());
});

describe("parseBranch", () => {
  it("builds the branch id and keeps only CABA branches", async () => {
    const branches = (await collect(fixture("coto_sepa-12/sucursales.csv"))).map(parseBranch);
    expect(branches.filter((b) => b.caba).map((b) => b.id)).toEqual(["12-1-44", "12-1-56"]);
    expect(branches[0]).toMatchObject({ name: "MONROE", address: "Av. Monroe 3284", lat: -34.5635828, lng: -58.4684123 });
  });
});

describe("parsePriceRow", () => {
  it("reads the list price, the code and whether it is a real EAN", async () => {
    const rows = (await collect(fixture("coto_sepa-12/productos.csv"))).map(parsePriceRow);
    expect(rows[0]).toEqual({
      branchId: "12-1-44",
      code: "8445291216563",
      isEan: true,
      description: "LECHE E/POLVO ETAPA 4 NIDO LAT 800 GRM",
      brand: "NIDO",
      presentation: "800 grm",
      price: 2261700,
    });
    expect(rows.find((r) => r?.code === "2088440000000")?.isEan).toBe(false);
  });

  it("drops rows without a valid list price", () => {
    expect(parsePriceRow({ id_comercio: "15", id_bandera: "1", id_sucursal: "1", productos_precio_lista: "-190.00" })).toBeNull();
  });
});
