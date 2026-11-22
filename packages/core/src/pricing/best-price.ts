import {
  acceptsPaymentMethod,
  isActiveOn,
  isStackable,
  requiresPaymentMethod,
  type Cents,
  type Channel,
  type IsoDate,
  type PaymentMethod,
  type Promotion,
} from "../promotions/promotion.ts";

export interface PurchaseContext {
  day: IsoDate;
  channel: Channel;
  paymentMethods: PaymentMethod[];
}

export interface AppliedPromotion {
  promotionId: string;
  kind: Promotion["kind"];
  savings: Cents;
  capped: boolean;
}

export interface PriceBreakdown {
  paidAtCheckout: Cents;
  refund: Cents;
  /** What the purchase really costs: paid at checkout minus refunds. */
  effective: Cents;
  applied: AppliedPromotion[];
  /** The payment method the applied promotions require, if any. */
  paymentMethod?: PaymentMethod;
  /** Some applied promotion has a cap that could not be parsed; savings may be overstated. */
  capUnknown: boolean;
}

/**
 * Cheapest way to pay `amount` (one transaction at one chain) on `context.day`.
 * Tries every valid combination of the applicable promotions for each payment method.
 */
export function bestPrice(amount: Cents, promotions: Promotion[], context: PurchaseContext): PriceBreakdown {
  const applicable = promotions.filter(
    (p) => isActiveOn(p, context.day) && (p.channel === "both" || p.channel === context.channel),
  );
  const free = applicable.filter((p) => !requiresPaymentMethod(p));

  let best = evaluate(amount, []);
  const consider = (combination: Promotion[], method?: PaymentMethod) => {
    const candidate = evaluate(amount, combination, method);
    if (
      candidate.effective < best.effective ||
      (candidate.effective === best.effective && candidate.applied.length < best.applied.length)
    ) {
      best = candidate;
    }
  };

  for (const combination of validCombinations(free)) consider(combination);
  for (const method of context.paymentMethods) {
    const tied = applicable.filter((p) => requiresPaymentMethod(p) && acceptsPaymentMethod(p, method));
    for (const combination of validCombinations([...free, ...tied])) {
      if (combination.some(requiresPaymentMethod)) consider(combination, method);
    }
  }
  return best;
}

/** Each non-stacking promotion alone, plus every subset of the stacking ones. */
function* validCombinations(promotions: Promotion[]): Generator<Promotion[]> {
  const stacking = promotions.filter(isStackable);
  for (const p of promotions) if (!isStackable(p)) yield [p];
  // shortcut: 2^n subsets, fine for the handful of promos a chain runs per day; prune if n grows past ~15.
  for (let mask = 1; mask < 1 << stacking.length; mask++) {
    yield stacking.filter((_, i) => mask & (1 << i));
  }
}

function evaluate(amount: Cents, combination: Promotion[], method?: PaymentMethod): PriceBreakdown {
  const applied: AppliedPromotion[] = [];
  const save = (promotion: Promotion, base: Cents): Cents => {
    const uncapped = Math.round((base * promotion.percent) / 100);
    const limit = typeof promotion.cap === "object" && promotion.cap !== null ? promotion.cap.amount : Infinity;
    const savings = Math.min(uncapped, limit);
    applied.push({ promotionId: promotion.id, kind: promotion.kind, savings, capped: savings < uncapped });
    return savings;
  };

  // Discounts apply one after another (largest first); refunds are computed on what was paid.
  let paidAtCheckout = amount;
  const discounts = combination.filter((p) => p.kind === "discount").sort((a, b) => b.percent - a.percent);
  for (const discount of discounts) paidAtCheckout -= save(discount, paidAtCheckout);
  let refund = 0;
  for (const p of combination) if (p.kind === "refund") refund += save(p, paidAtCheckout);
  refund = Math.min(refund, paidAtCheckout);

  const breakdown: PriceBreakdown = {
    paidAtCheckout,
    refund,
    effective: paidAtCheckout - refund,
    applied,
    capUnknown: combination.some((p) => p.cap === "unknown"),
  };
  if (method) breakdown.paymentMethod = method;
  return breakdown;
}
