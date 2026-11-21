import { staleness, type Cents, type IsoDate } from "@donde-ahorro/core";

const thousands = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 });

/** A price split the way a shelf label prints it: whole pesos, then the cents set small. */
export function priceParts(cents: Cents): { whole: string; cents: string } {
  return { whole: thousands.format(Math.floor(cents / 100)), cents: String(cents % 100).padStart(2, "0") };
}

export const priceText = (cents: Cents): string => {
  const { whole, cents: c } = priceParts(cents);
  return `$${whole},${c}`;
};

/** S9: how old a price is, in the words the spec uses. */
export function freshnessLabel(lastSeen: IsoDate, today: IsoDate): string {
  const { days } = staleness(lastSeen, today);
  if (days <= 0) return "actualizado hoy";
  if (days === 1) return "actualizado ayer";
  return `actualizado hace ${days} días`;
}

/** SEPA descriptions are upper case; show them as a sentence. */
export const sentenceCase = (text: string): string => {
  const lower = text.toLocaleLowerCase("es-AR");
  return lower.charAt(0).toLocaleUpperCase("es-AR") + lower.slice(1);
};

/** SEPA brands are upper case too: "LA SERENISIMA" → "La Serenisima". */
export const titleCase = (text: string): string =>
  text.toLocaleLowerCase("es-AR").replace(/(^|[\s-])(\p{L})/gu, (_, sep: string, letter: string) => sep + letter.toLocaleUpperCase("es-AR"));

/** SEPA branch names and addresses mix cases; only all-caps ones are retitled ("CL BEIRO 3146"). */
export const tidy = (text: string): string => (text === text.toLocaleUpperCase("es-AR") ? titleCase(text) : text);

export const todayInArgentina = (now = new Date()): IsoDate =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(now);

/** `2026-11-13` → `13/11`. */
export const shortDate = (day: IsoDate): string => `${day.slice(8, 10)}/${day.slice(5, 7)}`;
