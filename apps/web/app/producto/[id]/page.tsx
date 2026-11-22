import { bestPrice, cheapestSteps, multiBuy, offerCost, staleness } from "@donde-ahorro/core";
import { getPaymentCatalog, getPriceHistory, getProduct, getPromotions, promotionCoverage, similarProducts } from "@donde-ahorro/db/queries";
import Link from "next/link";
import { notFound } from "next/navigation";
import { sql } from "../../../lib/db.ts";
import { dayLabel, parseDay, toCatalogNames, weekOf } from "../../../lib/payments.ts";
import { addProductToCart } from "../../carrito/actions.ts";
import { isProductId } from "../../../lib/cart.ts";
import { selectedBranchIds, selectedConditions, selectedPaymentMethods } from "../../../lib/selection.ts";
import { freshnessLabel, priceText, sentenceCase, shortDate, tidy, titleCase, todayInArgentina } from "../../../lib/format.ts";
import { Breakdown, PromosNotReported } from "../../_components/breakdown.tsx";
import { Price } from "../../_components/price.tsx";
import { Sparkline, type SparkDomain } from "../../_components/sparkline.tsx";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ todas?: string; dia?: string; agregado?: string }> };

export async function generateMetadata({ params }: Props) {
  const { id } = await params;
  const product = isProductId(id) ? await getProduct(sql, id) : undefined;
  return { title: product ? `${sentenceCase(product.description)} | Dónde Ahorro` : "Dónde Ahorro" };
}

export default async function ProductPage({ params, searchParams }: Props) {
  const { id } = await params;
  // A bigint id only: a longer one would make Postgres throw instead of a 404.
  if (!isProductId(id)) notFound();
  const search = await searchParams;
  const [mine, methods, conditions] = await Promise.all([selectedBranchIds(), selectedPaymentMethods(), selectedConditions()]);
  // S3: only the user's branches, unless they ask for all of CABA.
  const showAll = search.todas === "1";
  const filter = mine.length && !showAll ? mine : undefined;
  const today = todayInArgentina();
  const day = parseDay(search.dia, today);
  const href = (changes: { todas?: boolean; dia?: string }) => {
    const todas = changes.todas ?? showAll;
    const dia = changes.dia ?? day;
    const q = new URLSearchParams({ ...(todas && { todas: "1" }), ...(dia !== today && { dia }) }).toString();
    return `/producto/${id}${q ? `?${q}` : ""}`;
  };

  const [product, history, similar] = await Promise.all([
    getProduct(sql, id, filter),
    getPriceHistory(sql, id, filter),
    similarProducts(sql, id),
  ]);
  if (!product) notFound();
  const [promotions, catalog, coverage] = await Promise.all([
    getPromotions(sql, product.chains.map((c) => c.chainId)),
    getPaymentCatalog(sql),
    promotionCoverage(sql),
  ]);
  const names = toCatalogNames(catalog);
  const promoById = new Map(promotions.map((p) => [p.id, p]));

  // S13–S16, S19, S25: each chain's best effective price on the chosen day: its cheapest branch after product
  // promotions, then the user's payment methods.
  // shortcut: in-store only, since prices come from branches; add the channel when online prices exist.
  const context = { day, channel: "in-store" as const, paymentMethods: methods, conditions };
  const priced = product.chains
    .map((chain) => {
      const branches = chain.branches.map((b) => ({ ...b, unit: offerCost(b, 1, day), multi: multiBuy(b, day) }));
      const unit = Math.min(...branches.map((b) => b.unit));
      const multi = branches.flatMap((b) => b.multi ?? []).reduce<(typeof branches)[number]["multi"]>((m, p) => (!m || p.price < m.price ? p : m), undefined);
      const best = bestPrice(unit, promotions.filter((p) => p.chainId === chain.chainId), context);
      return { chain, branches: branches.sort((a, b) => a.unit - b.unit), best, multi: multi && multi.price < unit ? multi : undefined };
    })
    .sort((a, b) => a.best.effective - b.best.effective || a.chain.minPrice - b.chain.minPrice);
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
  const cheapest = priced[0]?.best.effective;

  return (
    <main className="page">
      <h1 className="headline">{sentenceCase(product.description)}</h1>
      <p className="product-meta">
        {[product.brand && titleCase(product.brand), product.presentation, product.ean && `código ${product.ean}`].filter(Boolean).join(", ")}
      </p>

      <form action={addProductToCart} className="add-to-cart">
        <input type="hidden" name="productId" value={product.id} />
        <label htmlFor="quantity" className="visually-hidden">
          Cantidad
        </label>
        <select id="quantity" name="quantity" defaultValue="1">
          {Array.from({ length: 10 }, (_, i) => (
            <option key={i + 1} value={i + 1}>
              {i + 1}
            </option>
          ))}
        </select>
        <button type="submit">Agregar al carrito</button>
        {search.agregado === "lleno" ? (
          <span role="status">
            Tu carrito ya tiene 50 productos. <Link href="/carrito">Sacá alguno</Link> para agregar otro.
          </span>
        ) : (
          search.agregado && (
            <span role="status">
              Agregado. <Link href="/carrito">Ver carrito</Link>
            </span>
          )
        )}
      </form>

      <p className="scope">
        {filter ? (
          <>
            {mine.length === 1 ? "En tu sucursal" : `En tus ${mine.length} sucursales`}. <Link href={href({ todas: true })}>Ver todas las de CABA</Link>
          </>
        ) : mine.length ? (
          <>
            En todas las sucursales de CABA. <Link href={href({ todas: false })}>Ver solo las tuyas</Link>
          </>
        ) : (
          <>
            En todas las sucursales de CABA. <Link href="/sucursales">Elegí las tuyas</Link>
          </>
        )}
      </p>
      <p className="scope">
        {methods.length || conditions.length ? (
          <>
            Con tus medios de pago. <Link href="/medios">Cambiar</Link>
          </>
        ) : (
          <>
            Solo con las promos para todos los medios de pago. <Link href="/medios">Elegí los tuyos</Link>
          </>
        )}
      </p>

      <nav className="days" aria-label="Día de compra">
        {weekOf(today).map((d) => (
          <Link key={d} href={href({ dia: d })} aria-current={d === day ? "date" : undefined} scroll={false}>
            {dayLabel(d, today)}
          </Link>
        ))}
      </nav>

      {product.chains.length === 0 ? (
        <p className="notice">
          {filter
            ? "Ninguna de tus sucursales informa un precio actual para este producto."
            : "Ninguna sucursal de CABA informa un precio actual para este producto."}
        </p>
      ) : (
        <ol className="chains" aria-label="Precio por cadena, del más barato al más caro">
          {priced.map(({ chain, branches, best, multi }) => {
            const { stale } = staleness(chain.lastSeen, today);
            const n = chain.branches.length;
            const steps = stepsByChain.get(chain.chainId)!;
            // One step means no change in the stored history: say so instead of drawing a flat line.
            const changed = steps.length > 1;
            return (
              <li key={chain.chainId} className={`chain${best.effective === cheapest ? " chain-cheapest" : ""}`}>
                <div>
                  <h2 className="chain-name">{chain.chainName}</h2>
                  <p className="chain-facts">
                    {n} {n === 1 ? "sucursal" : "sucursales"},{" "}
                    <span className={stale ? "stale-note" : undefined} title={stale ? "Puede haber cambiado desde entonces." : undefined}>
                      {freshnessLabel(chain.lastSeen, today)}
                    </span>
                    {!changed && steps[0] && steps[0].from < chain.lastSeen && `, sin cambios desde el ${shortDate(steps[0].from)}`}
                    {!coverage[chain.chainId] && <PromosNotReported />}
                  </p>
                </div>
                <div className="chain-price">
                  <Price cents={best.effective} size="lg" />
                  {best.effective < chain.minPrice ? (
                    <span className="chain-range">sin promo {priceText(chain.minPrice)}</span>
                  ) : (
                    chain.maxPrice !== chain.minPrice && <span className="chain-range">hasta {priceText(chain.maxPrice)}</span>
                  )}
                  {/* S25: a multi-buy only holds for the whole group, so it is a note, not the price. */}
                  {multi && (
                    <span className="chain-range multi-buy">
                      Llevando {multi.minQuantity}: {priceText(multi.price)} c/u
                    </span>
                  )}
                </div>
                <Breakdown best={best} promoById={promoById} names={names} />
                {changed && (
                  <Sparkline steps={steps} domain={domain} label={`Precio más bajo de ${chain.chainName} desde el ${shortDate(domain.start)}`} />
                )}
                <details className="chain-branches">
                  <summary>Ver {n === 1 ? "la sucursal" : `las ${n} sucursales`}</summary>
                  <ul className="branch-list">
                    {branches.map((b) => (
                      <li key={b.branchId}>
                        <span>
                          {tidy(b.name)}
                          <span className="branch-address">{tidy(b.address)}</span>
                        </span>
                        <Price cents={b.unit} />
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
