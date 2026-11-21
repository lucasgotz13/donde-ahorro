import { describe, expect, it } from "vitest";
import type { Promotion } from "../promotions/promotion.ts";
import type { PurchaseContext } from "./best-price.ts";
import { bestSplit, totalsByChain, type CartLine } from "./cart.ts";

const promo = (fields: Partial<Promotion> & Pick<Promotion, "id" | "chainId">): Promotion => ({
  kind: "discount",
  percent: 10,
  entity: null,
  paymentMedium: null,
  weekdays: [],
  cap: null,
  channel: "both",
  validFrom: "2026-11-01",
  validTo: "2026-11-30",
  legalText: "",
  ...fields,
});

const context: PurchaseContext = { day: "2026-11-21", channel: "in-store", paymentMethods: [] };

// S17 (a): the whole cart's total per chain.
describe("totalsByChain", () => {
  const lines: CartLine[] = [
    { productId: "a", quantity: 2, prices: { coto: 1000, dia: 900 } },
    { productId: "b", quantity: 1, prices: { coto: 500 } },
  ];

  it("totals each chain, complete chains first, and lists what a chain lacks", () => {
    expect(totalsByChain(lines, [], context).map((t) => [t.chainId, t.subtotal, t.best.effective, t.missing])).toEqual([
      ["coto", 2500, 2500, []],
      ["dia", 1800, 1800, ["b"]],
    ]);
  });

  // S16: the cap applies to the whole transaction, not per product.
  it("applies a chain's promotions and caps to the cart total", () => {
    const capped = promo({ id: "coto:1", chainId: "coto", kind: "refund", percent: 50, cap: { amount: 600, period: "transaction" } });
    const [coto] = totalsByChain(lines, [capped], context);
    expect(coto).toMatchObject({ chainId: "coto", subtotal: 2500, best: { paidAtCheckout: 2500, refund: 600, effective: 1900 } });
  });

  it("is empty for an empty cart", () => expect(totalsByChain([], [], context)).toEqual([]));
});

// S17 (b): the best split across chains, with caps applied per chain.
describe("bestSplit", () => {
  const plan = (lines: CartLine[], promotions: Promotion[] = []) => {
    const split = bestSplit(lines, promotions, context);
    return { baskets: split.baskets.map((b) => [b.chainId, b.productIds, b.best.effective]), effective: split.effective, unavailable: split.unavailable };
  };

  it("buys each product where it is cheapest without promotions", () => {
    expect(
      plan([
        { productId: "a", quantity: 1, prices: { coto: 1000, dia: 900 } },
        { productId: "b", quantity: 2, prices: { coto: 500, dia: 600 } },
      ]),
    ).toEqual({ baskets: [["coto", ["b"], 1000], ["dia", ["a"], 900]], effective: 1900, unavailable: [] });
  });

  it("moves products to a chain whose promotion makes the whole basket cheaper", () => {
    const lines: CartLine[] = [
      { productId: "a", quantity: 1, prices: { coto: 1000, dia: 900 } },
      { productId: "b", quantity: 1, prices: { coto: 1000, dia: 1100 } },
    ];
    // Without promotions: a at Día (900) + b at Coto (1000) = 1900. With 20% off at Coto, all at Coto = 1600.
    expect(plan(lines, [promo({ id: "coto:1", chainId: "coto", percent: 20 })])).toEqual({
      baskets: [["coto", ["a", "b"], 1600]],
      effective: 1600,
      unavailable: [],
    });
  });

  it("splits when a chain's cap is used up by part of the cart", () => {
    const lines: CartLine[] = [
      { productId: "a", quantity: 1, prices: { coto: 1000, dia: 1000 } },
      { productId: "b", quantity: 1, prices: { coto: 1000, dia: 990 } },
    ];
    const capped = promo({ id: "coto:1", chainId: "coto", kind: "refund", percent: 50, cap: { amount: 500, period: "transaction" } });
    // All at Coto: 2000 - 500 = 1500. Split: a at Coto (1000 - 500) + b at Día (990) = 1490.
    expect(plan(lines, [capped])).toEqual({ baskets: [["coto", ["a"], 500], ["dia", ["b"], 990]], effective: 1490, unavailable: [] });
  });

  it("reports products no chain sells", () => {
    expect(plan([{ productId: "a", quantity: 1, prices: {} }])).toEqual({ baskets: [], effective: 0, unavailable: ["a"] });
  });
});
