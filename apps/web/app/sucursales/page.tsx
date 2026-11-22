import { getBranches, nearestBranches, searchBranches, type BranchSummary } from "@donde-ahorro/db/queries";
import { distanceLabel, geocode, type Place } from "../../lib/branches.ts";
import { sql } from "../../lib/db.ts";
import { tidy } from "../../lib/format.ts";
import { selectedBranchIds } from "../../lib/selection.ts";
import { saveBranches } from "./actions.ts";
import { LocateButton } from "./locate-button.tsx";

export const metadata = { title: "Tus sucursales | Dónde Ahorro" };

type Search = { q?: string; lat?: string; lng?: string; guardadas?: string };

/** `?lat=&lng=` from the location button; ignored unless both are real coordinates. */
function pointFrom({ lat, lng }: Search): Place | undefined {
  const [la, ln] = [Number(lat), Number(lng)];
  if (!lat || !lng || !(Math.abs(la) <= 90 && Math.abs(ln) <= 180)) return;
  return { lat: la, lng: ln, label: "tu ubicación" };
}

/** "Jumbo Las Heras" under Jumbo reads as "Las Heras"; SEPA names are otherwise kept as published. */
const branchName = ({ chainName, name }: BranchSummary) =>
  tidy(name).replace(new RegExp(`^${chainName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+`, "i"), "");

function BranchOption({ branch, checked, distance }: { branch: BranchSummary; checked?: boolean; distance?: number }) {
  return (
    <li>
      <label className="branch-option">
        <input type="checkbox" name="branch" value={branch.id} defaultChecked={checked} />
        <span>
          <span className="branch-chain">{branch.chainName}</span> {branchName(branch)}
          <span className="branch-address">{tidy(branch.address)}</span>
        </span>
        {distance !== undefined && <span className="branch-distance">{distanceLabel(distance)}</span>}
      </label>
    </li>
  );
}

export default async function BranchesPage({ searchParams }: { searchParams: Promise<Search> }) {
  const search = await searchParams;
  const q = (search.q ?? "").trim();
  const ids = await selectedBranchIds();

  // A typed query can be an address (Georef) or a branch name; try both.
  const [selected, byName, geo] = await Promise.all([
    getBranches(sql, ids),
    q ? searchBranches(sql, q) : [],
    q ? geocode(q).catch(() => "error" as const) : undefined,
  ]);
  const point = pointFrom(search) ?? (typeof geo === "object" ? geo : undefined);
  const near = point ? await nearestBranches(sql, point, 10) : [];

  const shown = new Set(ids);
  const nearNew = near.filter((b) => !shown.has(b.id));
  nearNew.forEach((b) => shown.add(b.id));
  const byNameNew = byName.filter((b) => !shown.has(b.id));
  const saved = search.guardadas;

  return (
    <main className="page">
      <h1 className="headline">Tus sucursales</h1>
      <p className="lede">
        Elegí dónde comprás y los precios se van a mostrar solo para esas sucursales. Se guardan en este dispositivo.
      </p>

      <form className="search" action="/sucursales" role="search">
        <label htmlFor="q" className="visually-hidden">
          Dirección o nombre de la sucursal
        </label>
        <input id="q" name="q" type="search" defaultValue={q} placeholder="Av. Rivadavia 5000, Cabildo, Jumbo..." autoComplete="off" />
        <button type="submit">Buscar</button>
      </form>
      <LocateButton />

      {saved !== undefined && (
        <p className="notice" role="status">
          {saved === "0" ? "Borramos tu selección: vas a ver todas las sucursales de CABA." : `Guardamos ${saved === "1" ? "tu sucursal" : `tus ${saved} sucursales`}.`}
        </p>
      )}
      {geo === "error" && !byName.length && (
        <p className="notice">No pudimos buscar la dirección en este momento. Probá de nuevo o buscá la sucursal por nombre.</p>
      )}
      {q && geo !== "error" && !point && !byName.length && (
        <p className="notice">No encontramos “{q}” en CABA. Probá con calle y altura, como “Av. Corrientes 1500”, o con el nombre de la sucursal.</p>
      )}

      {(selected.length > 0 || nearNew.length > 0 || byNameNew.length > 0) && (
        <form action={saveBranches} className="branch-form">
          {selected.length > 0 && (
            <fieldset>
              <legend className="section-title">Elegidas</legend>
              <ul className="rows">
                {selected.map((b) => (
                  <BranchOption key={b.id} branch={b} checked />
                ))}
              </ul>
            </fieldset>
          )}
          {nearNew.length > 0 && (
            <fieldset>
              <legend className="section-title">Cerca de {tidy(point!.label)}</legend>
              <ul className="rows">
                {nearNew.map((b) => (
                  <BranchOption key={b.id} branch={b} distance={b.meters} />
                ))}
              </ul>
            </fieldset>
          )}
          {byNameNew.length > 0 && (
            <fieldset>
              <legend className="section-title">Sucursales que coinciden con “{q}”</legend>
              <ul className="rows">
                {byNameNew.map((b) => (
                  <BranchOption key={b.id} branch={b} />
                ))}
              </ul>
            </fieldset>
          )}
          <div className="save-bar">
            <button type="submit">Guardar sucursales</button>
          </div>
        </form>
      )}
    </main>
  );
}
