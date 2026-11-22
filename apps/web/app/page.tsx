import { lastSepaUpdate, searchProducts } from "@donde-ahorro/db/queries";
import Link from "next/link";
import { sql } from "../lib/db.ts";
import { sentenceCase, titleCase } from "../lib/format.ts";
import { Price } from "./_components/price.tsx";

const updated = new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "long", timeZone: "America/Argentina/Buenos_Aires" });

export default async function HomePage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const q = ((await searchParams).q ?? "").trim();
  const [results, lastUpdate] = await Promise.all([q ? searchProducts(sql, q) : [], lastSepaUpdate(sql)]);

  return (
    <main className="page">
      <h1 className="headline">¿Qué querés comprar?</h1>
      <p className="lede">
        Precios de Coto, Carrefour, Día, Disco, Jumbo y Vea en CABA, del registro oficial SEPA.
        {lastUpdate && ` Últimos precios publicados el ${updated.format(lastUpdate)}.`} <Link href="/estado">Estado de los datos</Link>
      </p>
      <form className="search" action="/" role="search">
        <label htmlFor="q" className="visually-hidden">
          Producto o código de barras
        </label>
        <input id="q" name="q" type="search" defaultValue={q} placeholder="yerba playadito, leche, 7790070..." autoComplete="off" />
        <button type="submit">Buscar</button>
      </form>

      {q && results.length === 0 && (
        <p className="notice">
          No encontramos productos para “{q}”. Probá con menos palabras, con la marca o con el código de barras.
        </p>
      )}

      {results.length > 0 && (
        <ul className="rows" aria-label={`Resultados para ${q}`}>
          {results.map((p) => (
            <li key={p.id}>
              <Link href={`/producto/${p.id}`} className="row-link">
                <span className="row-title">{sentenceCase(p.description)}</span>
                {p.minPrice !== null ? (
                  <span>
                    <span className="from">desde </span>
                    <Price cents={p.minPrice} />
                  </span>
                ) : (
                  <span className="from">sin precio actual</span>
                )}
                <span className="row-meta">
                  {[p.brand && titleCase(p.brand), p.presentation, p.chains > 0 && `en ${p.chains} ${p.chains === 1 ? "cadena" : "cadenas"}`]
                    .filter(Boolean)
                    .join(", ")}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
