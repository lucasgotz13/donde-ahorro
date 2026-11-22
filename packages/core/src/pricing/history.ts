import type { Cents, IsoDate } from "../promotions/promotion.ts";
import type { PriceRecord } from "./price-record.ts";

export const STALE_AFTER_DAYS = 7;

/** S9: how many days ago a price was last reported, and whether that is too old to trust. */
export function staleness(lastSeen: IsoDate, today: IsoDate): { days: number; stale: boolean } {
  const days = Math.round((Date.parse(today) - Date.parse(lastSeen)) / 86_400_000);
  return { days, stale: days > STALE_AFTER_DAYS };
}

/** A step of a price history: `price` holds from `from` until the next step; `null` means no price. */
export interface PriceStep {
  from: IsoDate;
  price: Cents | null;
}

/** The cheapest price among overlapping periods (e.g. a chain's branches), as merged steps. */
export function cheapestSteps(periods: Pick<PriceRecord, "price" | "validFrom" | "validTo">[]): PriceStep[] {
  const days = [...new Set(periods.flatMap((p) => (p.validTo ? [p.validFrom, p.validTo] : [p.validFrom])))].sort();
  const steps: PriceStep[] = [];
  for (const day of days) {
    const open = periods.filter((p) => p.validFrom <= day && (p.validTo === null || day < p.validTo));
    const price = open.length ? Math.min(...open.map((p) => p.price)) : null;
    if (steps.at(-1)?.price !== price) steps.push({ from: day, price });
  }
  return steps;
}
