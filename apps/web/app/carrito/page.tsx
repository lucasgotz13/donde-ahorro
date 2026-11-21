import { bestSplit, totalsByChain, type CartLine } from "@donde-ahorro/core";
import { getCartProducts, getChainNames, getPaymentCatalog, getPromotions } from "@donde-ahorro/db/queries";
import Link from "next/link";
import { sql } from "../../lib/db.ts";
import { priceText, sentenceCase, todayInArgentina } from "../../lib/format.ts";
import { dayLabel, parseDay, toCatalogNames, weekOf } from "../../lib/payments.ts";
import { selectedBranchIds, selectedCart, selectedConditions, selectedPaymentMethods } from "../../lib/selection.ts";
import { Breakdown } from "../_components/breakdown.tsx";
import { Price } from "../_components/price.tsx";
import { emptyCart, updateCart } from "./actions.ts";

export const metadata = { title: "Carrito | Dónde Ahorro" };

export default async function CartPage({ searchParams }: { searchParams: Promise<{ dia?: string }> }) {
  const [cart, mine, paymentMethods, conditions, search] = await Promise.all([
    selectedCart(),
    selectedBranchIds(),
    selectedPaymentMethods(),
    selectedConditions(),
    searchParams,
  ]);
  const today = todayInArgentina();
  const day = parseDay(search.dia, today);

  const products = await getCartProducts(sql, cart.map((i) => i.productId), mine.length ? mine : undefined);
  // Unknown product ids are dropped, so a cart of only those is empty too.
  if (!products.length) {
    return (
      <main className="page">
        <h1 className="headline">Tu carrito está vacío</h1>
        <p className="lede">
          Buscá un producto y tocá “Agregar al carrito”. Después vas a ver dónde conviene comprar todo junto y cómo repartirlo entre cadenas.
        </p>
        <Link href="/">Buscar productos</Link>
      </main>
    );
  }

  const quantityOf = new Map(cart.map((i) => [i.productId, i.quantity]));
  const lines: CartLine[] = products.map((p) => ({ productId: p.id, quantity: quantityOf.get(p.id)!, prices: p.prices }));
  const chainIds = [...new Set(lines.flatMap((l) => Object.keys(l.prices)))];
  const [promotions, catalog, chainNames] = await Promise.all([getPromotions(sql, chainIds), getPaymentCatalog(sql), getChainNames(sql)]);
  const names = toCatalogNames(catalog);
  const promoById = new Map(promotions.map((p) => [p.id, p]));
  const context = { day, channel: "in-store" as const, paymentMethods, conditions };

  const totals = totalsByChain(lines, promotions, context);
  const split = bestSplit(lines, promotions, context);
  const bestSingle = totals.find((t) => !t.missing.length);
  const describe = (id: string) => products.find((p) => p.id === id)!;
  const chainName = (id: string) => chainNames[id] ?? id;

  return (
    <main className="page">
      <h1 className="headline">Tu carrito</h1>
      <p className="scope">
        {mine.length ? "En tus sucursales" : "En todas las sucursales de CABA"},{" "}
        {paymentMethods.length || conditions.length ? "con tus medios de pago." : "solo con las promos para todos los medios de pago."}{" "}
        <Link href="/medios">Cambiar medios de pago</Link>
      </p>

      <nav className="days" aria-label="Día de compra">
        {weekOf(today).map((d) => (
          <Link key={d} href={d === today ? "/carrito" : `/carrito?dia=${d}`} aria-current={d === day ? "date" : undefined} scroll={false}>
            {dayLabel(d, today)}
          </Link>
        ))}
      </nav>

      <form action={updateCart} className="cart-form">
        <ul className="rows">
          {products.map((p) => (
            <li key={p.id} className="cart-line">
              <Link href={`/producto/${p.id}`}>{sentenceCase(p.description)}</Link>
              <label className="cart-quantity">
                <span className="visually-hidden">Cantidad de {sentenceCase(p.description)}</span>
                <input type="number" name={`cantidad-${p.id}`} min={0} max={99} defaultValue={quantityOf.get(p.id)} inputMode="numeric" />
              </label>
            </li>
          ))}
        </ul>
        <div className="cart-actions">
          <button type="submit">Actualizar cantidades</button>
          <button type="submit" formAction={emptyCart} className="link-button">
            Vaciar carrito
          </button>
        </div>
      </form>

      <section aria-labelledby="todo-junto">
        <h2 id="todo-junto" className="section-title">
          Todo en una cadena
        </h2>
        <ol className="chains">
          {totals.map((t) => (
            <li key={t.chainId} className={`chain${t === bestSingle ? " chain-cheapest" : ""}`}>
              <div>
                <h3 className="chain-name">{chainName(t.chainId)}</h3>
                <p className="chain-facts">
                  {t.missing.length
                    ? `No tiene ${t.missing.length === 1 ? "1 producto" : `${t.missing.length} productos`}: ${t.missing.map((id) => sentenceCase(describe(id).description)).join(", ")}.`
                    : "Tiene todo tu carrito."}
                </p>
              </div>
              <div className="chain-price">
                <Price cents={t.best.effective} size="lg" />
                {t.best.applied.length > 0 && <span className="chain-range">sin promo {priceText(t.subtotal)}</span>}
              </div>
              <Breakdown best={t.best} promoById={promoById} names={names} />
            </li>
          ))}
        </ol>
      </section>

      {split.baskets.length > 1 && (
        <section aria-labelledby="repartido">
          <h2 id="repartido" className="section-title">
            Repartiendo entre cadenas: {priceText(split.effective)}
          </h2>
          <p className="scope">
            {bestSingle && split.effective < bestSingle.best.effective
              ? `Ahorrás ${priceText(bestSingle.best.effective - split.effective)} frente a comprar todo en ${chainName(bestSingle.chainId)}, en ${split.baskets.length} compras separadas.`
              : `Son ${split.baskets.length} compras separadas.`}
          </p>
          <ol className="chains">
            {split.baskets.map((b) => (
              <li key={b.chainId} className="chain">
                <div>
                  <h3 className="chain-name">{chainName(b.chainId)}</h3>
                  <ul className="basket-items">
                    {b.productIds.map((id) => (
                      <li key={id}>
                        {quantityOf.get(id)} × {sentenceCase(describe(id).description)}
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="chain-price">
                  <Price cents={b.best.effective} size="lg" />
                  {b.best.applied.length > 0 && <span className="chain-range">sin promo {priceText(b.subtotal)}</span>}
                </div>
                <Breakdown best={b.best} promoById={promoById} names={names} />
              </li>
            ))}
          </ol>
        </section>
      )}

      {split.unavailable.length > 0 && (
        <p className="notice">
          Sin precio en {mine.length ? "tus sucursales" : "ninguna sucursal de CABA"}:{" "}
          {split.unavailable.map((id) => sentenceCase(describe(id).description)).join(", ")}.
        </p>
      )}
    </main>
  );
}
