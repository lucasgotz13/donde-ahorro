import type { Cents, IsoDate } from "../promotions/promotion.ts";

/** S25: a product promotion published in SEPA. `price` is the unit price, averaged over the group for a multi-buy. */
export interface ProductPromo {
  price: Cents;
  /** Units the promotion needs ("2DO AL 50%" → 2); 1 for a plain discount. */
  minQuantity: number;
  /** Inclusive; `null` when the legend gives no date. */
  validFrom: IsoDate | null;
  validUntil: IsoDate | null;
}

/** One branch's list price and its product promotions. */
export interface Offer {
  price: Cents;
  promos: ProductPromo[];
}

const validOn = (p: ProductPromo, day: IsoDate) => (!p.validFrom || p.validFrom <= day) && (!p.validUntil || day <= p.validUntil);

/** What `quantity` units cost on `day`: the cheapest promo for its complete groups, the rest at the list price. Promos never combine. */
export function offerCost(offer: Offer, quantity: number, day: IsoDate): Cents {
  let best = offer.price * quantity;
  for (const p of offer.promos) {
    if (!validOn(p, day)) continue;
    const grouped = Math.floor(quantity / p.minQuantity) * p.minQuantity;
    best = Math.min(best, grouped * p.price + (quantity - grouped) * offer.price);
  }
  return best;
}

/** The cheapest multi-buy valid on `day` whose unit price beats buying one unit. */
export function multiBuy(offer: Offer, day: IsoDate): ProductPromo | undefined {
  const single = offerCost(offer, 1, day);
  return offer.promos
    .filter((p) => p.minQuantity > 1 && validOn(p, day) && p.price < single)
    .reduce<ProductPromo | undefined>((best, p) => (!best || p.price < best.price ? p : best), undefined);
}
