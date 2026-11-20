import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream } from "node:stream/web";

export const SEPA_CKAN_URL = "https://datos.produccion.gob.ar";
// S22: an identifiable client.
export const USER_AGENT = "donde-ahorro (self-hosted price comparison)";

const headers = { "user-agent": USER_AGENT };

const timeZone = "America/Argentina/Buenos_Aires";

/** The SEPA ZIP is published per weekday (`sepa_jueves.zip`), by the calendar in Buenos Aires. */
export function weekdayInArgentina(date: Date): string {
  const name = new Intl.DateTimeFormat("es-AR", { weekday: "long", timeZone }).format(date);
  return name.normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

/** `YYYY-MM-DD` in Buenos Aires. */
export const dateInArgentina = (date: Date): string => new Intl.DateTimeFormat("en-CA", { timeZone }).format(date);

export async function resolveSepaUrl(date: Date, ckanUrl = SEPA_CKAN_URL): Promise<string> {
  const res = await fetch(`${ckanUrl}/api/3/action/package_show?id=sepa-precios`, { headers });
  if (!res.ok) throw new Error(`SEPA CKAN: HTTP ${res.status}`);
  const { result } = (await res.json()) as { result: { resources: { url: string }[] } };
  const file = `sepa_${weekdayInArgentina(date)}.zip`;
  const resource = result.resources.find((r) => r.url.endsWith(`/${file}`));
  if (!resource) throw new Error(`SEPA CKAN: no resource ${file}`);
  return resource.url;
}

/** S21: when the ZIP was last published, from a HEAD request. */
export async function fetchLastModified(url: string): Promise<Date> {
  const head = await fetch(url, { method: "HEAD", headers });
  if (!head.ok) throw new Error(`SEPA ZIP: HTTP ${head.status}`);
  const lastModified = new Date(head.headers.get("last-modified") ?? "");
  if (Number.isNaN(lastModified.getTime())) throw new Error("SEPA ZIP: no last-modified header");
  return lastModified;
}

export async function download(url: string, dest: string): Promise<void> {
  const res = await fetch(url, { headers });
  if (!res.ok || !res.body) throw new Error(`SEPA ZIP: HTTP ${res.status}`);
  // fetch's body is a web ReadableStream; only its DOM and Node typings differ.
  await pipeline(Readable.fromWeb(res.body as ReadableStream), createWriteStream(dest));
}
