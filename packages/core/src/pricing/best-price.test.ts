import { describe, expect, it } from "vitest";
import type { Promotion } from "../promotions/promotion.ts";
import { bestPrice, type PurchaseContext } from "./best-price.ts";

const promo = (overrides: Partial<Promotion> & Pick<Promotion, "id">): Promotion => ({
  chainId: "coto",
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
  ...overrides,
});

// 2026-11-19 is a Thursday (weekday 4).
const context: PurchaseContext = {
  day: "2026-11-19",
  channel: "in-store",
  paymentMethods: [{ entity: "galicia", medium: "credit" }],
};

describe("bestPrice", () => {
  it("returns the plain amount when no promotion applies", () => {
    expect(bestPrice(10_000, [], context)).toEqual({
      paidAtCheckout: 10_000,
      refund: 0,
      effective: 10_000,
      applied: [],
      capUnknown: false,
    });
  });

  // S13: refunds stack by default.
  it("stacks refunds by default", () => {
    const result = bestPrice(
      10_000,
      [promo({ id: "r1", kind: "refund", percent: 10 }), promo({ id: "r2", kind: "refund", percent: 5 })],
      context,
    );
    expect(result.applied.map((a) => a.promotionId).sort()).toEqual(["r1", "r2"]);
    expect(result.refund).toBe(1_500);
    expect(result.effective).toBe(8_500);
  });

  // S13: discounts do not stack unless explicit; S14: the cheapest combination wins.
  it("applies only the best discount when discounts do not stack", () => {
    const result = bestPrice(
      10_000,
      [promo({ id: "d10", percent: 10 }), promo({ id: "d20", percent: 20 })],
      context,
    );
    expect(result.applied.map((a) => a.promotionId)).toEqual(["d20"]);
    expect(result.paidAtCheckout).toBe(8_000);
    expect(result.effective).toBe(8_000);
  });

  it("stacks discounts that are explicitly stackable, one after another", () => {
    const result = bestPrice(
      10_000,
      [promo({ id: "d10", percent: 10, stackable: true }), promo({ id: "d20", percent: 20, stackable: true })],
      context,
    );
    // 10_000 - 20% = 8_000, then - 10% = 7_200 (the order does not change the result).
    expect(result.paidAtCheckout).toBe(7_200);
    expect(result.applied).toHaveLength(2);
  });

  it("never combines a non-stacking discount with other promotions", () => {
    const result = bestPrice(
      10_000,
      [
        promo({ id: "d25", percent: 25 }),
        promo({ id: "r10", kind: "refund", percent: 10 }),
        promo({ id: "r10b", kind: "refund", percent: 10 }),
      ],
      context,
    );
    // d25 alone: 7_500. Both refunds: 8_000. d25 + refunds is not a valid combination.
    expect(result.applied.map((a) => a.promotionId)).toEqual(["d25"]);
    expect(result.effective).toBe(7_500);
  });

  // S14 assumption: refunds are computed on the amount paid at checkout.
  it("computes refunds on the amount paid after stackable discounts", () => {
    const result = bestPrice(
      10_000,
      [promo({ id: "d20", percent: 20, stackable: true }), promo({ id: "r10", kind: "refund", percent: 10 })],
      context,
    );
    expect(result.paidAtCheckout).toBe(8_000);
    expect(result.refund).toBe(800);
    expect(result.effective).toBe(7_200);
  });

  // S15: paid amount and refund are reported separately; effective is the main number.
  it("reports what you pay and what is refunded", () => {
    const result = bestPrice(10_000, [promo({ id: "r30", kind: "refund", percent: 30 })], context);
    expect(result).toMatchObject({ paidAtCheckout: 10_000, refund: 3_000, effective: 7_000 });
    expect(result.applied).toEqual([
      { promotionId: "r30", kind: "refund", savings: 3_000, capped: false },
    ]);
  });

  // S16: the cap applies to the whole transaction.
  it("limits the savings to the cap on the transaction total", () => {
    const result = bestPrice(
      100_000,
      [promo({ id: "r30", kind: "refund", percent: 30, cap: { amount: 15_000, period: "month" } })],
      context,
    );
    expect(result.refund).toBe(15_000);
    expect(result.applied[0]).toMatchObject({ savings: 15_000, capped: true });
  });

  it("never refunds more than was paid", () => {
    const result = bestPrice(
      10_000,
      [promo({ id: "r60", kind: "refund", percent: 60 }), promo({ id: "r70", kind: "refund", percent: 70 })],
      context,
    );
    expect(result.refund).toBe(10_000);
    expect(result.effective).toBe(0);
    // The breakdown adds up to the refund actually paid back.
    expect(result.applied.reduce((sum, a) => sum + a.savings, 0)).toBe(10_000);
    expect(result.applied.some((a) => a.capped)).toBe(true);
  });

  it("computes an unknown cap uncapped and flags it", () => {
    const result = bestPrice(10_000, [promo({ id: "r30", kind: "refund", percent: 30, cap: "unknown" })], context);
    expect(result.refund).toBe(3_000);
    expect(result.capUnknown).toBe(true);
  });

  // S14 assumption: one payment method per transaction.
  it("never combines promotions tied to different payment methods", () => {
    const result = bestPrice(
      10_000,
      [
        promo({ id: "galicia", kind: "refund", percent: 20, entity: "galicia" }),
        promo({ id: "nacion", kind: "refund", percent: 15, entity: "nacion" }),
        promo({ id: "any", kind: "refund", percent: 5 }),
      ],
      { ...context, paymentMethods: [{ entity: "galicia", medium: "credit" }, { entity: "nacion", medium: "debit" }] },
    );
    expect(result.applied.map((a) => a.promotionId).sort()).toEqual(["any", "galicia"]);
    expect(result.paymentMethod).toEqual({ entity: "galicia", medium: "credit" });
    expect(result.effective).toBe(7_500);
  });
});

// S12: entity, payment medium, days, channel and validity decide whether a promotion applies.
describe("bestPrice applicability", () => {
  const cases: Array<[string, Partial<Promotion>]> = [
    ["outside its validity", { validFrom: "2026-11-20" }],
    ["on another weekday", { weekdays: [1, 2] }],
    ["for an entity the user does not have", { entity: "nacion" }],
    ["for a payment medium the user does not have", { entity: "galicia", paymentMedium: "debit" }],
    ["for another channel", { channel: "online" }],
    ["for an eligibility condition the user does not meet", { conditions: ["comunidad-coto"] }],
  ];

  it.each(cases)("ignores a promotion %s", (_, overrides) => {
    const result = bestPrice(10_000, [promo({ id: "p", ...overrides })], context);
    expect(result.applied).toEqual([]);
    expect(result.effective).toBe(10_000);
  });

  it("applies a promotion on its weekday, entity, medium and channel", () => {
    const result = bestPrice(
      10_000,
      [promo({ id: "p", weekdays: [4], entity: "galicia", paymentMedium: "credit", channel: "in-store" })],
      context,
    );
    expect(result.applied.map((a) => a.promotionId)).toEqual(["p"]);
  });

  it("applies a promotion only when the user meets every eligibility condition", () => {
    const promotions = [promo({ id: "p", conditions: ["mi-carrefour", "anses-o-mayor-60"] })];
    const owned = (conditions: string[]) => bestPrice(10_000, promotions, { ...context, conditions }).applied.map((a) => a.promotionId);
    expect(owned(["mi-carrefour"])).toEqual([]);
    expect(owned(["anses-o-mayor-60", "mi-carrefour", "visa-nfc"])).toEqual(["p"]);
  });

  it("combines a condition with the payment method that the promotion requires", () => {
    const visa = promo({ id: "visa", paymentMedium: "debit", conditions: ["visa-nfc"] });
    const result = bestPrice(10_000, [visa], { ...context, paymentMethods: [{ entity: "galicia", medium: "debit" }], conditions: ["visa-nfc"] });
    expect(result.applied.map((a) => a.promotionId)).toEqual(["visa"]);
    expect(bestPrice(10_000, [visa], { ...context, conditions: ["visa-nfc"] }).applied).toEqual([]);
  });
});
