import type { PriceBreakdown, Promotion } from "@donde-ahorro/core";
import Link from "next/link";
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

/** Promotions the user could use at a chain, listed without applying them: the cart does that on the whole purchase. */
export function AvailablePromos({ promotions, names }: { promotions: Promotion[]; names: CatalogNames }) {
  if (!promotions.length) return null;
  return (
    <div className="chain-promos">
      <p className="chain-promos-title">Promos bancarias disponibles</p>
      <ul>
        {[...new Set(promotions.map((p) => describePromotion(p, names)))].map((text) => (
          <li key={text}>{text}</li>
        ))}
      </ul>
    </div>
  );
}

/** S11: we could not read this chain's promotions, so it may have some we do not show. */
export function PromosNotReported() {
  return (
    <>
      {" "}
      <Link href="/estado" className="stale-note promos-missing" title="No pudimos leer las promos de esta cadena: puede tener descuentos que no mostramos.">
        Promos no informadas
      </Link>
    </>
  );
}
