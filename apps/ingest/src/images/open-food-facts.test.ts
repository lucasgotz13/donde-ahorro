import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { gzipSync } from "node:zlib";
import { createTestDatabase } from "@donde-ahorro/db/test-database";
import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadProductImages } from "./open-food-facts.ts";

const adminUrl = process.env.DATABASE_URL;
const image = (n: number) => `https://images.openfoodfacts.org/images/products/779/000/000/000${n}/front_es.4.200.jpg`;

// A local stand-in for the Open Food Facts dump: never the live site.
describe.skipIf(!adminUrl)("loadProductImages", () => {
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  let sql: postgres.Sql;
  let server: Server;
  let url: string;
  let body: Buffer;
  let requests = 0;

  const dump = (...rows: string[][]) =>
    gzipSync([["code", "product_name", "image_small_url"], ...rows].map((r) => r.join("\t")).join("\n"));
  const images = async () => (await sql`select image_url from products order by id`).map((r) => r.image_url);
  const lastRun = async () => (await sql`select status, message from ingest_runs where source = 'images' order by id desc limit 1`)[0];
  // The same tick a week later, which may wake slightly earlier than this week's did.
  const weekLater = () => new Date(Date.now() + 7 * 86_400_000 - 60_000);

  beforeAll(async () => {
    db = await createTestDatabase(adminUrl!);
    sql = db.sql;
    await sql`insert into chains (id, name, sepa_comercio_id, sepa_bandera_id) values ('coto', 'Coto', 12, 1)`;
    server = createServer((_, res) => {
      requests++;
      res.end(body);
    });
    await new Promise<void>((r) => server.listen(0, r));
    url = `http://localhost:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    server?.close();
    await db?.drop();
  });

  it("downloads nothing before there are products", async () => {
    body = dump(["7790000000001", "A", image(1)]);
    await loadProductImages(sql, { url });
    expect(requests).toBe(0);
    expect(await lastRun()).toEqual({ status: "skipped", message: "no products with an EAN yet" });
  });

  it("sets images by EAN, only from the Open Food Facts image host", async () => {
    await sql`insert into products (ean, description) values ('7790000000001', 'A'), ('7790000000002', 'B'), ('7790000000003', 'C')`;
    await sql`insert into products (chain_id, chain_product_code, description) values ('coto', '7790000000001', 'D')`;
    body = dump(
      ["7790000000001", 'Yerba "ñandú', image(1)],
      ["7790000000002", "B", "https://evil.example/x.jpg"],
      ["7790000000003", "C", ""],
      ["7790000000099", "Unknown", image(9)],
    );
    await loadProductImages(sql, { url });
    expect(await images()).toEqual([image(1), null, null, null]);
    expect((await lastRun())!.status).toBe("succeeded");
  });

  it("downloads nothing within a week of the last success", async () => {
    const before = requests;
    await loadProductImages(sql, { url });
    expect(requests).toBe(before);
    expect((await lastRun())!.status).toBe("skipped");
  });

  it("keeps the images when the download is cut short", async () => {
    body = dump(["7790000000002", "B", image(2)]).subarray(0, -12);
    await expect(loadProductImages(sql, { url, now: weekLater() })).rejects.toThrow();
    expect(await images()).toEqual([image(1), null, null, null]);
    expect((await lastRun())!.status).toBe("failed");
  });

  it("keeps the images when the dump matches no product or lacks a column", async () => {
    body = dump(["7790000000099", "Unknown", image(9)]);
    await expect(loadProductImages(sql, { url, now: weekLater() })).rejects.toThrow(/no image/);
    body = gzipSync("code\tname\n7790000000001\tA");
    await expect(loadProductImages(sql, { url, now: weekLater() })).rejects.toThrow(/column/);
    expect(await images()).toEqual([image(1), null, null, null]);
  });

  it("drops an image the dump no longer has and adds new ones", async () => {
    body = dump(["7790000000002", "B", image(2)]);
    await loadProductImages(sql, { url, now: weekLater() });
    expect(await images()).toEqual([null, image(2), null, null]);
  });
});
