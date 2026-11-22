import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createTestDatabase } from "@donde-ahorro/db/test-database";
import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cleanAddress, geocodeBranches, withoutTitledName } from "./geocode.ts";

describe("cleanAddress", () => {
  it.each([
    ["MENDEZ DE LOS ANDES 961 (CABALLITO)", "MENDEZ DE LOS ANDES 961"],
    ["Av. Pueyrredón 2464 2464", "Av. Pueyrredón 2464"],
    ["AV ALVAREZ JONTE 2539", "AV ALVAREZ JONTE 2539"],
  ])("%s → %s", (raw, clean) => expect(cleanAddress(raw)).toBe(clean));
});

// Cencosud and Día append the honoree's full name after the street: Georef only knows "AV GRAL LAS HERAS".
describe("withoutTitledName", () => {
  it.each([
    ["Avenida Las Heras gral. Juan Gregori 2564", "Avenida Las Heras 2564"],
    ["AVENIDA LAS HERAS GRAL JUAN GREGORIO DE 3925", "AVENIDA LAS HERAS 3925"],
    ["Tte. Gral. J. D. Perón 4177", undefined],
    ["AV ALVAREZ JONTE 2539", undefined],
  ])("%s → %s", (raw, retry) => expect(withoutTitledName(raw)).toBe(retry));
});

const adminUrl = process.env.DATABASE_URL;

// A local stand-in for apis.datos.gob.ar: never the live site.
describe.skipIf(!adminUrl)("geocodeBranches", () => {
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  let sql: postgres.Sql;
  let server: Server;
  let url: string;
  const bodies: { direcciones: { direccion: string; provincia: string }[] }[] = [];
  let status = 200;

  beforeAll(async () => {
    db = await createTestDatabase(adminUrl!);
    sql = db.sql;
    await sql`insert into chains (id, name, sepa_comercio_id, sepa_bandera_id) values ('jumbo', 'Jumbo', 9, 3), ('dia', 'Día', 15, 1)`;
    await sql`insert into branches (id, chain_id, name, address, lat, lng) values
      ('9-3-121', 'jumbo', 'Jumbo Las Heras', 'Avenida Las Heras gral. Juan Gregori 2564', -34.6147, -58.435),
      ('9-3-122', 'jumbo', 'Jumbo Nowhere', 'Calle Falsa 123', -34.6, -58.4),
      ('15-1-776', 'dia', 'Villa del Parque', 'AV ALVAREZ JONTE 2539 (VILLA DEL PARQUE)', -34.07254, -58.478249)`;
    server = createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        const parsed = JSON.parse(body);
        bodies.push(parsed);
        if (status !== 200) return res.writeHead(status).end();
        res.setHeader("content-type", "application/json");
        res.end(
          JSON.stringify({
            resultados: parsed.direcciones.map((d: { direccion: string }) =>
              d.direccion.startsWith("AV ALVAREZ JONTE")
                ? { direcciones: [{ nomenclatura: "AV ALVAREZ JONTE 2539, Comuna 11", ubicacion: { lat: -34.6074, lon: -58.478 } }] }
                : d.direccion.startsWith("Avenida Las Heras 25")
                  ? { direcciones: [{ nomenclatura: "AV GRAL LAS HERAS 2564, Comuna 2", ubicacion: { lat: -34.5858, lon: -58.4004 } }] }
                  : { direcciones: [] },
            ),
          }),
        );
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/georef/api/direcciones`;
  });
  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
    await db?.drop();
  });

  const positions = () => sql`select id, geo_lat, geo_lng, geocoded_address from branches order by id`;

  it("geocodes each new address in CABA once, retrying misses without a titled name, and logs the run", async () => {
    expect(await geocodeBranches(sql, { url })).toEqual({ sent: 3, found: 2 });
    expect(bodies[0]!.direcciones).toEqual([
      expect.objectContaining({ direccion: "AV ALVAREZ JONTE 2539", provincia: "02" }),
      expect.objectContaining({ direccion: "Avenida Las Heras gral. Juan Gregori 2564", provincia: "02" }),
      expect.objectContaining({ direccion: "Calle Falsa 123", provincia: "02" }),
    ]);
    // Only the miss that has a titled name is retried.
    expect(bodies[1]!.direcciones.map((d) => d.direccion)).toEqual(["Avenida Las Heras 2564"]);
    expect(await positions()).toEqual([
      { id: "15-1-776", geo_lat: -34.6074, geo_lng: -58.478, geocoded_address: "AV ALVAREZ JONTE 2539 (VILLA DEL PARQUE)" },
      { id: "9-3-121", geo_lat: -34.5858, geo_lng: -58.4004, geocoded_address: "Avenida Las Heras gral. Juan Gregori 2564" },
      // Not found: SEPA's position stays in use.
      { id: "9-3-122", geo_lat: null, geo_lng: null, geocoded_address: "Calle Falsa 123" },
    ]);
    const [run] = await sql`select status, stats from ingest_runs where source = 'georef' order by id desc limit 1`;
    expect(run).toEqual({ status: "succeeded", stats: { sent: 3, found: 2 } });

    expect(await geocodeBranches(sql, { url })).toEqual({ sent: 0, found: 0 });
    expect(bodies).toHaveLength(2);
  });

  it("geocodes a branch again when SEPA changes its address", async () => {
    await sql`update branches set address = 'AV ALVAREZ JONTE 2541' where id = '15-1-776'`;
    expect(await geocodeBranches(sql, { url })).toEqual({ sent: 1, found: 1 });
    expect(bodies.at(-1)!.direcciones.map((d) => d.direccion)).toEqual(["AV ALVAREZ JONTE 2541"]);
  });

  it("logs a failure and keeps the stored positions", async () => {
    await sql`update branches set address = 'Calle Falsa 125' where id = '9-3-122'`;
    status = 503;
    await expect(geocodeBranches(sql, { url })).rejects.toThrow("Georef: HTTP 503");
    status = 200;
    const [run] = await sql`select status, message from ingest_runs where source = 'georef' order by id desc limit 1`;
    expect(run).toEqual({ status: "failed", message: "Error: Georef: HTTP 503" });
    expect((await positions()).find((p) => p.id === "9-3-122")?.geocoded_address).toBe("Calle Falsa 123");
  });
});
