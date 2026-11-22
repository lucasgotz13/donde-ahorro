import { cheapestSteps, staleness } from "@donde-ahorro/core";
import { getPriceHistory, getProduct, similarProducts } from "@donde-ahorro/db/queries";
import Link from "next/link";
import { notFound } from "next/navigation";
import { sql } from "../../../lib/db.ts";
import { freshnessLabel, priceText, sentenceCase, shortDate, titleCase, todayInArgentina } from "../../../lib/format.ts";
import { Price } from "../../_components/price.tsx";
import { Sparkline, type SparkDomain } from "../../_components/sparkline.tsx";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props) {
  const { id } = await params;
  const product = /^\d+$/.test(id) ? await getProduct(sql, id) : undefined;
  return { title: product ? `${sentenceCase(product.description)} | Dónde Ahorro` : "Dónde Ahorro" };
}

export default async function ProductPage({ params }: Props) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) notFound();
  const [product, history, similar] = await Promise.all([getProduct(sql, id), getPriceHistory(sql, id), similarProducts(sql, id)]);
  if (!product) notFound();

  const today = todayInArgentina();
  const stepsByChain = new Map(
    product.chains.map((c) => [c.chainId, cheapestSteps(history.filter((h) => h.chainId === c.chainId))]),
  );
  const prices = [...stepsByChain.values()].flat().flatMap((s) => (s.price === null ? [] : [s.price]));
  const domain: SparkDomain = {
    start: history.reduce((min, h) => (h.validFrom < min ? h.validFrom : min), today),
    end: today,
    min: Math.min(...prices),
    max: Math.max(...prices),
  };
  const cheapest = product.chains[0]?.minPrice;

  return (
    <main className="page">
      <Link href="/" className="wordmark">
        Dónde Ahorro
      </Link>
      <h1 className="headline">{sentenceCase(product.description)}</h1>
      <p className="product-meta">
        {[product.brand && titleCase(product.brand), product.presentation, product.ean && `código ${product.ean}`].filter(Boolean).join(", ")}
      </p>

      {product.chains.length === 0 ? (
        <p className="notice">Ninguna sucursal de CABA informa un precio actual para este producto.</p>
      ) : (
        <ol className="chains" aria-label="Precio por cadena, del más barato al más caro">
          {product.chains.map((chain) => {
            const { stale } = staleness(chain.lastSeen, today);
            const n = chain.branches.length;
            const steps = stepsByChain.get(chain.chainId)!;
            // One step means no change in the stored history: say so instead of drawing a flat line.
            const changed = steps.length > 1;
            return (
              <li key={chain.chainId} className={`chain${chain.minPrice === cheapest ? " chain-cheapest" : ""}`}>
                <div>
                  <h2 className="chain-name">{chain.chainName}</h2>
                  <p className="chain-facts">
                    {n} {n === 1 ? "sucursal" : "sucursales"},{" "}
                    <span className={stale ? "stale-note" : undefined} title={stale ? "Puede haber cambiado desde entonces." : undefined}>
                      {freshnessLabel(chain.lastSeen, today)}
                    </span>
                    {!changed && steps[0] && steps[0].from < chain.lastSeen && `, sin cambios desde el ${shortDate(steps[0].from)}`}
                  </p>
                </div>
                <div className="chain-price">
                  <Price cents={chain.minPrice} size="lg" />
                  {chain.maxPrice !== chain.minPrice && <span className="chain-range">hasta {priceText(chain.maxPrice)}</span>}
                </div>
                {changed && (
                  <Sparkline steps={steps} domain={domain} label={`Precio más bajo de ${chain.chainName} desde el ${shortDate(domain.start)}`} />
                )}
                <details className="chain-branches">
                  <summary>Ver {n === 1 ? "la sucursal" : `las ${n} sucursales`}</summary>
                  <ul className="branch-list">
                    {chain.branches.map((b) => (
                      <li key={b.branchId}>
                        <span>
                          {b.name}
                          <span className="branch-address">{b.address}</span>
                        </span>
                        <Price cents={b.price} />
                      </li>
                    ))}
                  </ul>
                </details>
              </li>
            );
          })}
        </ol>
      )}

      {similar.length > 0 && (
        <section aria-labelledby="similares">
          <h2 id="similares" className="section-title">
            Productos similares
          </h2>
          <ul className="rows">
            {similar.map((p) => (
              <li key={p.id}>
                <Link href={`/producto/${p.id}`} className="row-link">
                  <span className="row-title">{sentenceCase(p.description)}</span>
                  {p.minPrice !== null ? <Price cents={p.minPrice} /> : <span className="from">sin precio actual</span>}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <Link href="/" className="back">
        Buscar otro producto
      </Link>
    </main>
  );
}
