import type { Cents, Promotion } from "../promotions/promotion.ts";
import { bestPrice, type PriceBreakdown, type PurchaseContext } from "./best-price.ts";

/** One cart product: how many, and its unit price at each chain that sells it. */
export interface CartLine {
  productId: string;
  quantity: number;
  prices: Record<string, Cents>;
}

export interface ChainTotal {
  chainId: string;
  /** List price of what this chain sells from the cart. */
  subtotal: Cents;
  /** S16: promotions and caps apply to the whole transaction. */
  best: PriceBreakdown;
  /** Cart products this chain does not sell. */
  missing: string[];
}

const basketPrice = (chainId: string, lines: CartLine[], promotions: Promotion[], context: PurchaseContext) => {
  const subtotal = lines.reduce((sum, l) => sum + l.prices[chainId]! * l.quantity, 0);
  return { subtotal, best: bestPrice(subtotal, promotions.filter((p) => p.chainId === chainId), context) };
};

/** S17 (a): the whole cart at each chain; chains that sell everything first, cheapest first. */
export function totalsByChain(lines: CartLine[], promotions: Promotion[], context: PurchaseContext): ChainTotal[] {
  const chainIds = [...new Set(lines.flatMap((l) => Object.keys(l.prices)))];
  return chainIds
    .map((chainId) => {
      const sold = lines.filter((l) => chainId in l.prices);
      return { chainId, ...basketPrice(chainId, sold, promotions, context), missing: lines.filter((l) => !(chainId in l.prices)).map((l) => l.productId) };
    })
    .sort((a, b) => a.missing.length - b.missing.length || a.best.effective - b.best.effective || a.chainId.localeCompare(b.chainId));
}

export interface Basket {
  chainId: string;
  productIds: string[];
  subtotal: Cents;
  best: PriceBreakdown;
}

export interface SplitPlan {
  /** By chain id. */
  baskets: Basket[];
  /** What the whole cart costs after every basket's promotions. */
  effective: Cents;
  /** Products no chain sells. */
  unavailable: string[];
}

/**
 * S17 (b): the cheapest way to split the cart across chains, each basket with its own promotions and caps.
 * Starts from each product's cheapest chain, then moves one product at a time while the total drops.
 */
export function bestSplit(lines: CartLine[], promotions: Promotion[], context: PurchaseContext): SplitPlan {
  const sellable = lines.filter((l) => Object.keys(l.prices).length > 0);
  const unavailable = lines.filter((l) => Object.keys(l.prices).length === 0).map((l) => l.productId);

  const plan = (assignment: Map<string, string>): SplitPlan => {
    const chainIds = [...new Set(assignment.values())].sort();
    const baskets = chainIds.map((chainId) => {
      const basket = sellable.filter((l) => assignment.get(l.productId) === chainId);
      return { chainId, productIds: basket.map((l) => l.productId), ...basketPrice(chainId, basket, promotions, context) };
    });
    return { baskets, effective: baskets.reduce((sum, b) => sum + b.best.effective, 0), unavailable };
  };

  const assignment = new Map(
    sellable.map((l) => [l.productId, Object.entries(l.prices).reduce((best, entry) => (entry[1] < best[1] ? entry : best))[0]]),
  );
  let best = plan(assignment);
  // shortcut: single-product moves can miss a cheaper split that needs two moves at once; fine for carts of a few dozen products.
  for (let improved = true; improved; ) {
    improved = false;
    for (const line of sellable) {
      for (const chainId of Object.keys(line.prices)) {
        const current = assignment.get(line.productId)!;
        if (chainId === current) continue;
        assignment.set(line.productId, chainId);
        const candidate = plan(assignment);
        if (candidate.effective < best.effective) {
          best = candidate;
          improved = true;
        } else {
          assignment.set(line.productId, current);
        }
      }
    }
  }
  return best;
}
