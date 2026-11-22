import { describe, expect, it } from "vitest";
import { multiBuy, offerCost, type Offer } from "./product-promo.ts";

const day = "2026-11-20";

// S25, S19: a product promotion applies only on days its validity covers.
describe("offerCost", () => {
  const simple: Offer = { price: 1000, promos: [{ price: 800, minQuantity: 1, validFrom: "2026-11-18", validUntil: "2026-11-20" }] };

  it("uses the promo price on a day its validity covers, the list price otherwise", () => {
    expect(offerCost(simple, 1, day)).toBe(800);
    expect(offerCost(simple, 3, day)).toBe(2400);
    expect(offerCost(simple, 1, "2026-11-21")).toBe(1000);
    expect(offerCost(simple, 1, "2026-11-17")).toBe(1000);
  });

  it("applies an undated promo on any day", () => {
    expect(offerCost({ price: 1000, promos: [{ price: 900, minQuantity: 1, validFrom: null, validUntil: null }] }, 1, "2027-01-01")).toBe(900);
  });

  // "the cart applies it only to complete groups of 2 (or 3)".
  it("prices a multi-buy only for complete groups, the rest at the list price", () => {
    const twoForLess: Offer = { price: 325000, promos: [{ price: 243750, minQuantity: 2, validFrom: null, validUntil: "2026-11-30" }] };
    expect(offerCost(twoForLess, 1, day)).toBe(325000);
    expect(offerCost(twoForLess, 2, day)).toBe(487500);
    expect(offerCost(twoForLess, 3, day)).toBe(487500 + 325000);
  });

  it("takes the cheapest promo; promos never combine", () => {
    const both: Offer = {
      price: 1000,
      promos: [
        { price: 800, minQuantity: 1, validFrom: null, validUntil: null },
        { price: 700, minQuantity: 2, validFrom: null, validUntil: null },
      ],
    };
    expect(offerCost(both, 1, day)).toBe(800);
    expect(offerCost(both, 2, day)).toBe(1400);
    expect(offerCost(both, 3, day)).toBe(2400);
  });
});

// "Llevando 2: $2.437,50 c/u".
describe("multiBuy", () => {
  it("returns the cheapest valid multi-buy that beats the single-unit price", () => {
    const offer: Offer = {
      price: 1000,
      promos: [
        { price: 900, minQuantity: 1, validFrom: null, validUntil: null },
        { price: 750, minQuantity: 2, validFrom: null, validUntil: null },
        { price: 600, minQuantity: 3, validFrom: null, validUntil: "2026-11-19" },
      ],
    };
    expect(multiBuy(offer, day)).toEqual(offer.promos[1]);
    expect(multiBuy({ price: 1000, promos: [{ price: 950, minQuantity: 2, validFrom: null, validUntil: null }, offer.promos[0]!] }, day)).toBeUndefined();
  });
});
