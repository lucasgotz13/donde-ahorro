import type postgres from "postgres";
import { USER_AGENT } from "../sepa/download.ts";

export const GEOREF_URL = "https://apis.datos.gob.ar/georef/api/direcciones";
// Georef's bulk endpoint takes at most 1,000 addresses per request.
const BATCH = 1000;

/** SEPA noise Georef cannot read: a neighborhood in parentheses, a number written twice ("Pueyrredón 2464 2464"). */
export const cleanAddress = (address: string) =>
  address
    .replace(/\(.*?\)/g, " ")
    .replace(/\b(\d+)\s+\1\b/, "$1")
    .replace(/\s+/g, " ")
    .trim();

/**
 * "Avenida Las Heras gral. Juan Gregori 2564" → "Avenida Las Heras 2564": the honoree's name after the street, which Georef
 * does not know; `undefined` when there is none. Used only to retry a miss.
 */
export function withoutTitledName(address: string): string | undefined {
  const match = /^(\S+(?:\s+\S+)+?)\s+(?:gral|general|dr|pres|tte|cnel)\.?\s.*?(\d+)$/i.exec(address);
  return match ? `${match[1]} ${match[2]}` : undefined;
}

type Position = { lat: number; lng: number } | null;

async function lookup(url: string, addresses: string[]): Promise<Position[]> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": USER_AGENT },
    body: JSON.stringify({ direcciones: addresses.map((direccion) => ({ direccion, provincia: "02", max: 1, campos: "ubicacion" })) }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`Georef: HTTP ${res.status}`);
  const { resultados } = (await res.json()) as GeorefBulk;
  return addresses.map((_, i) => {
    const { lat, lon } = resultados[i]?.direcciones[0]?.ubicacion ?? {};
    return typeof lat === "number" && typeof lon === "number" ? { lat, lng: lon } : null;
  });
}

interface GeorefBulk {
  resultados: { direcciones: { ubicacion?: { lat: number | null; lon: number | null } }[] }[];
}

/**
 * S3: SEPA places some branches wrongly (Jumbo Las Heras in Caballito, a Día at latitude -34.07), so each new or changed
 * branch address is geocoded in CABA (`provincia=02`) with Georef. Not found keeps SEPA's position. Logged in `ingest_runs`.
 */
export async function geocodeBranches(sql: postgres.Sql, { url = GEOREF_URL }: { url?: string } = {}) {
  const [run] = await sql`insert into ingest_runs (source) values ('georef') returning id`;
  const finish = (fields: Record<string, unknown>) =>
    sql`update ingest_runs set ${sql({ ...fields, finished_at: new Date() })} where id = ${run!.id}`;
  try {
    const pending = await sql`select id, address from branches where geocoded_address is distinct from address order by id`;
    const stats = { sent: pending.length, found: 0 };
    for (let i = 0; i < pending.length; i += BATCH) {
      const batch = pending.slice(i, i + BATCH);
      const cleaned = batch.map((b) => cleanAddress(b.address));
      const found = await lookup(url, cleaned);
      const retries = cleaned.flatMap((address, j) => {
        const retry = found[j] ? undefined : withoutTitledName(address);
        return retry ? [{ j, retry }] : [];
      });
      if (retries.length) (await lookup(url, retries.map((r) => r.retry))).forEach((p, k) => (found[retries[k]!.j] = p));
      const rows = batch.map((b, j) => {
        if (found[j]) stats.found++;
        return { id: b.id, address: b.address, lat: found[j]?.lat ?? null, lng: found[j]?.lng ?? null };
      });
      await sql`update branches b set geo_lat = r.lat::float8, geo_lng = r.lng::float8, geocoded_address = r.address
        from (values ${sql(rows.map((r) => [r.id, r.address, r.lat, r.lng]))}) as r(id, address, lat, lng)
        where b.id = r.id`;
    }
    await finish({ status: "succeeded", stats: sql.json(stats) });
    return stats;
  } catch (error) {
    await finish({ status: "failed", message: String(error) });
    throw error;
  }
}
