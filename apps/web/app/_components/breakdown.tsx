import type { PriceBreakdown, Promotion } from "@donde-ahorro/core";
import { priceText } from "../../lib/format.ts";
import { describePromotion, type CatalogNames } from "../../lib/payments.ts";

/** S12, S15, S16: "Pagás $X, te reintegran $Y." plus one line per applied promotion with its cap. */
export function Breakdown({ best, promoById, names }: { best: PriceBreakdown; promoById: Map<string, Promotion>; names: CatalogNames }) {
  if (!best.applied.length) return null;
  return (
    <div className="chain-promos">
      {best.refund > 0 && (
        <p className="refund">
          Pagás {priceText(best.paidAtCheckout)}, te reintegran {priceText(best.refund)}.
        </p>
      )}
      <ul>
        {best.applied.map((a) => (
          <li key={a.promotionId}>
            {describePromotion(promoById.get(a.promotionId)!, names)}
            {a.capped && " Llegás al tope."}
          </li>
        ))}
      </ul>
    </div>
  );
}
