import { getPaymentCatalog } from "@donde-ahorro/db/queries";
import { sql } from "../../lib/db.ts";
import { MAX_PAYMENT_METHODS } from "../../lib/payments.ts";
import { selectedConditions, selectedPaymentMethods } from "../../lib/selection.ts";
import { savePaymentMethods } from "./actions.ts";
import { SelectAllButton } from "./select-all-button.tsx";

export const metadata = { title: "Tus medios de pago | Dónde Ahorro" };

export default async function PaymentMethodsPage({ searchParams }: { searchParams: Promise<{ guardados?: string; recortados?: string }> }) {
  const [catalog, methods, conditions, { guardados, recortados }] = await Promise.all([
    getPaymentCatalog(sql),
    selectedPaymentMethods(),
    selectedConditions(),
    searchParams,
  ]);
  const has = new Set(methods.map((m) => `${m.entity}:${m.medium}`));
  // Keep showing saved entities even when no current promotion names them.
  const listed = new Set(catalog.entities.map((e) => e.id));
  const entities = [...catalog.entities, ...methods.filter((m) => !listed.has(m.entity)).map((m) => ({ id: m.entity, name: m.entity }))].filter(
    (e, i, all) => all.findIndex((x) => x.id === e.id) === i,
  );

  return (
    <main className="page">
      <h1 className="headline">Tus medios de pago</h1>
      <p className="lede">
        Marcá con qué pagás y a qué programas pertenecés. Así cada producto muestra las promos que te corresponden y el carrito las
        aplica. Se guarda en este dispositivo.
      </p>

      {guardados !== undefined && (
        <p className="notice" role="status">
          {guardados === "0" ? "Borramos tus medios de pago: solo se aplican las promos para todos." : "Guardamos tus medios de pago."}
          {recortados && ` Solo entran ${MAX_PAYMENT_METHODS}: guardamos los primeros.`}
        </p>
      )}

      <form action={savePaymentMethods} className="branch-form">
        {catalog.conditions.length > 0 && (
          <fieldset>
            <legend className="section-title">Programas y tarjetas</legend>
            <ul className="rows">
              {catalog.conditions.map((c) => (
                <li key={c.id}>
                  <label className="branch-option">
                    <input type="checkbox" name="condition" value={c.id} defaultChecked={conditions.includes(c.id)} />
                    <span>{c.name}</span>
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
        )}

        <fieldset>
          <legend className="section-title">Bancos y billeteras</legend>
          <SelectAllButton />
          <ul className="rows">
            {entities.map((e) => (
              <li key={e.id} className="method-row">
                <fieldset>
                  <legend className="method-entity">{e.name}</legend>
                  <div className="method-media">
                    {catalog.media.map((m) => (
                      <label key={m.id} className="chip">
                        <input type="checkbox" name="method" value={`${e.id}:${m.id}`} defaultChecked={has.has(`${e.id}:${m.id}`)} />
                        <span>{m.name}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              </li>
            ))}
          </ul>
        </fieldset>

        <div className="save-bar">
          <button type="submit">Guardar medios de pago</button>
        </div>
      </form>
    </main>
  );
}
