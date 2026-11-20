import type { Cents, IsoDate } from "../promotions/promotion.ts";

/** A price that held at one branch from `validFrom` until `validTo` (`null` while it still holds). */
export interface PriceRecord {
  productId: string;
  branchId: string;
  price: Cents;
  validFrom: IsoDate;
  validTo: IsoDate | null;
  /** Last SEPA publication that reported this price; drives staleness (S9). */
  lastSeen: IsoDate;
}
