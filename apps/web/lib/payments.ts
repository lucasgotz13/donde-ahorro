import type { IsoDate, PaymentMethod, Promotion } from "@donde-ahorro/core";
import { priceText } from "./format.ts";

/** S18, S20: the user's payment methods and eligibility conditions, in cookies on their device. */
export const METHODS_COOKIE = "medios";
export const CONDITIONS_COOKIE = "condiciones";

const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Cookies and forms are user input: keep well-formed `entity:medium` pairs once, at most 100 (about 3 KB, under the 4 KB cookie limit). */
export function parsePaymentMethods(value: string | undefined): PaymentMethod[] {
  const pairs = new Set((value ?? "").split(",").map((s) => s.trim()));
  return [...pairs]
    .map((pair) => pair.split(":"))
    .filter((parts): parts is [string, string] => parts.length === 2 && parts.every((p) => ID.test(p)))
    .slice(0, 100)
    .map(([entity, medium]) => ({ entity, medium }));
}

export const serializePaymentMethods = (methods: PaymentMethod[]): string => methods.map((m) => `${m.entity}:${m.medium}`).join(",");

export function parseConditions(value: string | undefined): string[] {
  return [...new Set((value ?? "").split(",").map((s) => s.trim()))].filter((id) => ID.test(id)).slice(0, 20);
}

const addDays = (day: IsoDate, n: number): IsoDate => new Date(Date.parse(day) + n * 86_400_000).toISOString().slice(0, 10);

/** S19: today and the next 6 days. */
export const weekOf = (today: IsoDate): IsoDate[] => Array.from({ length: 7 }, (_, i) => addDays(today, i));

/** `?dia=` when it is one of the selectable days; otherwise today. */
export const parseDay = (param: string | undefined, today: IsoDate): IsoDate =>
  param && weekOf(today).includes(param) ? param : today;

const WEEKDAYS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

export function dayLabel(day: IsoDate, today: IsoDate): string {
  if (day === today) return "Hoy";
  if (day === addDays(today, 1)) return "Mañana";
  return `${WEEKDAYS[new Date(`${day}T00:00:00Z`).getUTCDay()]} ${Number(day.slice(8))}`;
}

export interface CatalogNames {
  entities: Record<string, string>;
  media: Record<string, string>;
  conditions: Record<string, string>;
}

type Catalog = Record<keyof CatalogNames, { id: string; name: string }[]>;

/** The catalog query's rows as id → name lookups. */
export const toCatalogNames = (catalog: Catalog): CatalogNames => ({
  entities: Object.fromEntries(catalog.entities.map((e) => [e.id, e.name])),
  media: Object.fromEntries(catalog.media.map((m) => [m.id, m.name])),
  conditions: Object.fromEntries(catalog.conditions.map((c) => [c.id, c.name])),
});

const lowerFirst = (text: string) => text.charAt(0).toLocaleLowerCase("es-AR") + text.slice(1);
const PERIOD = { transaction: "por compra", day: "por día", week: "por semana", month: "por mes" } as const;

/** S12, S16: "25% de reintegro con Banco Galicia, tarjeta de crédito. Tope $10.000 por mes." */
export function describePromotion(promo: Promotion, names: CatalogNames): string {
  const who = [
    promo.entity && (names.entities[promo.entity] ?? promo.entity),
    promo.paymentMedium && lowerFirst(names.media[promo.paymentMedium] ?? promo.paymentMedium),
    ...(promo.conditions ?? []).map((c) => names.conditions[c] ?? c),
  ].filter(Boolean);
  const kind = promo.kind === "refund" ? "reintegro" : "descuento";
  const cap =
    promo.cap === "unknown"
      ? " Tope sin informar."
      : promo.cap
        ? ` Tope ${priceText(promo.cap.amount).replace(/,00$/, "")} ${PERIOD[promo.cap.period]}.`
        : "";
  return `${promo.percent}% de ${kind} con ${who.length ? who.join(", ") : "cualquier medio de pago"}.${cap}`;
}
