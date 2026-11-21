import { dateInArgentina, USER_AGENT } from "../../sepa/download.ts";
import { parseCap } from "../cap.ts";
import { assertAllowedByRobots } from "../robots.ts";
import type { ScrapedPromotion } from "../store.ts";

/** S11: Coto's public promotion list (`enviroment` is Coto's spelling). */
export const COTO_PROMOS_URL =
  "https://www.coto.com.ar/rest/model/atg/actors/cProfileActor/getPromocionesMulticanal?enviroment=ag";

interface CotoPromo {
  id: string;
  /** Logo file, the one field that names every entity, wallets and programs included. */
  icono: string;
  /** "30% DE DESCUENTO", "+10% DE DESCUENTO" or "12 CUOTAS SIN INTERÉS". */
  textoDescuento: string;
  descripcion: string | null;
  observacion: string | null;
  /** 1 = Sunday ... 7 = Saturday. */
  dias: { id: number }[];
}

const addDays = (day: string, n: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** The one medium the description names; `null` when several or none (any of the entity's media). */
function mediumOf(text: string): string | null {
  if (/\b(QR|MODO)\b/u.test(text)) return "QR";
  const named = (
    [
      ["crédito", /cr[eé]dito/iu],
      ["débito", /d[eé]bito/iu],
      ["prepaga", /prepag/iu],
    ] as const
  ).filter(([, re]) => re.test(text));
  return named.length === 1 ? named[0]![0] : null;
}

/**
 * Validity from dates in the text ("del 01/11 al 30/11/2026"); without them, the listing only says the
 * promotion is current, so it holds for the 7-day selector (S19) until the next daily scrape replaces it.
 */
function validity(text: string, today: string): [string, string] {
  const found = [...text.matchAll(/\b(\d{2})\/(\d{2})(?:\/(\d{4}))?\b/gu)];
  const year = found.findLast((m) => m[3])?.[3] ?? today.slice(0, 4);
  const days = found.map((m) => `${m[3] ?? year}-${m[2]}-${m[1]}`).sort();
  return days.length ? [days[0]!, days.at(-1)!] : [today, addDays(today, 6)];
}

function toPromotion(p: CotoPromo, channel: "online" | "in-store", today: string): ScrapedPromotion | undefined {
  // Installment plans ("CUOTAS SIN INTERÉS") are not percent promotions: out of scope.
  const percent = /^\+?(\d+(?:[.,]\d+)?)\s*%/u.exec(p.textoDescuento.trim())?.[1];
  if (!percent) return;
  const id = `coto:${p.id}`;
  // Coto lists every day explicitly ("De Lunes a Domingo"); no days is missing data, not "every day".
  if (!p.dias.length) return void console.warn(`[coto] ${id} skipped: sin días`);
  const legalText = [p.descripcion, p.observacion].filter(Boolean).join(" ").trim();
  const [validFrom, validTo] = validity(legalText, today);
  return {
    id,
    chainId: "coto",
    // Coto titles them all "DE DESCUENTO", but the bank pays back what the terms call a "reintegro".
    kind: /reintegro/iu.test(legalText) ? "refund" : "discount",
    percent: Number(percent.replace(",", ".")),
    rawEntity: p.icono.trim(),
    rawMedium: mediumOf(p.descripcion ?? ""),
    weekdays: p.dias.map((d) => d.id - 1),
    cap: parseCap(legalText),
    channel,
    validFrom,
    validTo,
    legalText,
    // S13: only an explicit "Acumula con ..." changes the default; "No acumula" is the default for discounts.
    ...(/(?<!no )acumula con/iu.test(legalText) && { stackable: true }),
  };
}

/** Maps Coto's response; `today` (Buenos Aires) dates promotions whose text names no validity. */
export function parseCotoPromotions(json: unknown, today: string): ScrapedPromotion[] {
  const result = (json as { result?: Record<string, CotoPromo[]> } | null)?.result;
  const online = result?.promocionesDigitales;
  const inStore = result?.promocionesSucursalesFisicas;
  if (!Array.isArray(online) || !Array.isArray(inStore)) throw new Error("Coto: unexpected promotions response");
  return [
    ...online.map((p) => toPromotion(p, "online", today)),
    ...inStore.map((p) => toPromotion(p, "in-store", today)),
  ].filter((p) => p !== undefined);
}

/** S22: checks robots.txt, then fetches with the identifiable user agent. */
export async function scrapeCoto(url = COTO_PROMOS_URL, now = new Date()): Promise<ScrapedPromotion[]> {
  await assertAllowedByRobots(url);
  const res = await fetch(url, { headers: { "user-agent": USER_AGENT } });
  if (!res.ok) throw new Error(`Coto promotions: HTTP ${res.status}`);
  return parseCotoPromotions(await res.json(), dateInArgentina(now));
}
