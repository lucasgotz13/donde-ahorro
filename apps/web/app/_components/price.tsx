import type { Cents } from "@donde-ahorro/core";
import { priceParts, priceText } from "../../lib/format.ts";

/** A price as a shelf label prints it; screen readers get the plain amount. */
export function Price({ cents, size = "sm" }: { cents: Cents; size?: "sm" | "lg" }) {
  const { whole, cents: c } = priceParts(cents);
  return (
    <span className={`price price-${size}`} role="img" aria-label={priceText(cents)}>
      <span className="price-sign">$</span>
      {whole}
      <span className="price-cents">{c}</span>
    </span>
  );
}
