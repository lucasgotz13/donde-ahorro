import type { Cap } from "@donde-ahorro/core";
import { USER_AGENT } from "../../sepa/download.ts";
import { parseCap } from "../cap.ts";
import { assertAllowedByRobots } from "../robots.ts";
import type { ScrapedPromotion } from "../store.ts";
import { CARREFOUR_ALIASES } from "./aliases.ts";

/** One `BP` MasterData document: what www.carrefour.com.ar/descuentos-bancarios renders. */
interface BankPromotion {
  id: string;
  title: string;
  sub_title: string | null;
  discount_percentage: number | null;
  /** The label shown under the percentage, e.g. "de descuento" or "de Ahorro". */
  discount_text_info: string | null;
  active_from: string;
  active_to: string;
  legal: string | null;
  hyper: boolean;
  market: boolean;
  express: boolean;
  maxi: boolean;
  ecommerce: boolean;
  idBank: string | null;
  idCard: string | null;
  [weekday: string]: unknown;
}

export interface CarrefourSource {
  promotions: BankPromotion[];
  banks: { id: string; name: string }[];
  cards: { id: string; name: string }[];
}

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const FORMATS = [["hyper", "carrefour-hiper"], ["market", "carrefour-market"], ["express", "carrefour-express"], ["maxi", "carrefour-maxi"]] as const;
const FIELDS = ["id", "title", "sub_title", "discount_percentage", "discount_text_info", "active_from", "active_to", "legal", ...FORMATS.map(([f]) => f), "ecommerce", "idBank", "idCard", ...WEEKDAYS];

const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const plain = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** The payment medium named in the promotion's headline; `null` when it names none or several. */
function rawMedium(text: string): string | null {
  const t = plain(text);
  if (/dinero en cuenta/.test(t)) return "dinero en cuenta";
  if (/\bqr\b/.test(t)) return "QR";
  const credit = /credito/.test(t);
  const debit = /debito/.test(t);
  return credit === debit ? null : credit ? "crédito" : "débito";
}

/** The subtitle states this promotion's own cap; the legal text may list several tiers, so it comes second. */
function cap(subTitle: string, legal: string): Cap {
  const caps = [parseCap(subTitle), parseCap(legal)];
  return caps.find((c) => typeof c === "object" && c !== null) ?? caps.find((c) => c !== null) ?? null;
}

/**
 * S11, S12: Carrefour's bank promotions → one `ScrapedPromotion` per Carrefour chain it applies to.
 * Installment-only promotions (no percentage) are skipped.
 */
export function parseCarrefourPromotions({ promotions, banks, cards }: CarrefourSource): ScrapedPromotion[] {
  const names = new Map([...cards, ...banks].map((e) => [e.id, e.name]));
  return promotions.flatMap((p) => {
    if (!p.discount_percentage) return [];
    const subTitle = p.sub_title ?? "";
    const legal = p.legal ?? "";
    const text = `${p.title} ${subTitle} ${legal}`;
    const stores = FORMATS.filter(([format]) => p[format]).map(([, chain]) => chain);
    // An online-only promotion names no store format; it applies to the Carrefour online store as a whole.
    const chains = stores.length ? stores : FORMATS.map(([, chain]) => chain);
    const weekdays = WEEKDAYS.flatMap((day, i) => (p[day] ? [i] : []));
    const entityId = p.idBank ?? p.idCard;
    // A promotion with no bank or card is any-entity only when it says so; otherwise its title is the
    // unknown entity, so it is skipped instead of stored as null (null means "any entity").
    const named = entityId ? (names.get(entityId) ?? entityId) : undefined;
    // A membership listed as a bank (Mi Carrefour) is an eligibility condition, open to any entity.
    const isCondition = named !== undefined && named in CARREFOUR_ALIASES.conditions!;
    const rawConditions = isCondition
      ? [named, ...(/anses|mayor(?:es)? de 60/i.test(p.title) ? ["Anses o mayor de 60"] : [])]
      : undefined;
    const rawEntity = isCondition
      ? null
      : (named ?? (/todos los medios de pago/i.test(p.title) ? null : p.title));
    const base = {
      // The legal texts say "reintegro" even for discounts taken at checkout, so the page's own label decides.
      kind: /reintegr/i.test(`${p.title} ${p.discount_text_info ?? ""}`) ? "refund" : "discount",
      percent: p.discount_percentage,
      rawEntity,
      ...(rawConditions && { rawConditions }),
      rawMedium: rawMedium(`${p.title} ${subTitle}`),
      weekdays: weekdays.length === 7 ? [] : weekdays,
      cap: cap(subTitle, legal),
      channel: !stores.length ? "online" : p.ecommerce ? "both" : "in-store",
      validFrom: isoDay(Date.parse(p.active_from)),
      // `active_to` is an exclusive midnight; validTo is the last valid day.
      validTo: isoDay(Date.parse(p.active_to) - 1),
      legalText: legal || subTitle,
      stackable: /\bno (?:es )?acumulable/i.test(text) ? false : /acumulable/i.test(text) ? true : undefined,
    } satisfies Omit<ScrapedPromotion, "id" | "chainId">;
    return chains.map((chainId) => ({ id: `carrefour:${p.id}:${chainId}`, chainId, ...base }));
  });
}

async function search<T>(url: string): Promise<T[]> {
  await assertAllowedByRobots(url);
  const res = await fetch(url, { headers: { "user-agent": USER_AGENT, "rest-range": "resources=0-99" } });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const body = (await res.json()) as T[];
  const total = Number(res.headers.get("rest-content-range")?.split("/")[1]);
  if (total > body.length) throw new Error(`${url}: ${total} documents, only ${body.length} fetched`);
  return body;
}

/** S22: the public MasterData search the promotions page itself uses (entities BP, FB and FC). */
export async function scrapeCarrefour(baseUrl = "https://www.carrefour.com.ar", now = new Date()): Promise<ScrapedPromotion[]> {
  const url = (entity: string, params: Record<string, string>) =>
    `${baseUrl}/api/dataentities/${entity}/search?${new URLSearchParams({ _schema: "mdv1", ...params })}`;
  const at = now.toISOString().slice(0, 19);
  // S19: the day selector reaches 6 days ahead, so promotions starting this week count too; `isActiveOn` picks the day.
  const weekEnd = new Date(now.getTime() + 7 * 86_400_000).toISOString().slice(0, 19);
  const promotions = await search<BankPromotion>(
    url("BP", { _fields: FIELDS.join(","), _where: `active=true AND ((active_from < ${weekEnd}) AND (active_to > ${at}))` }),
  );
  const banks = await search<{ id: string; name: string }>(url("FB", { _fields: "id,name" }));
  const cards = await search<{ id: string; name: string }>(url("FC", { _fields: "id,name" }));
  return parseCarrefourPromotions({ promotions, banks, cards });
}
