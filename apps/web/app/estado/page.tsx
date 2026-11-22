import { getChainNames, getSourceStatus, PROMOTION_SOURCE_BY_CHAIN, promotionCoverage, type SourceStatus } from "@donde-ahorro/db/queries";
import { sql } from "../../lib/db.ts";

export const metadata = { title: "Estado de los datos | Dónde Ahorro" };

const SOURCE_NAMES: Record<string, string> = {
  sepa: "Precios (registro SEPA)",
  coto: "Promos de Coto",
  carrefour: "Promos de Carrefour",
};

const when = new Intl.DateTimeFormat("es-AR", {
  day: "numeric",
  month: "long",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "America/Argentina/Buenos_Aires",
});

/** The ingest worker logs in English; the known skips read better in the page's words. */
function runOutcome(run: NonNullable<SourceStatus["lastRun"]>): string {
  const at = when.format(run.startedAt);
  switch (run.status) {
    case "succeeded":
      return `La última corrida terminó bien (${at}).`;
    case "running":
      return `Hay una corrida en curso desde el ${at}.`;
    case "skipped":
      if (/not published yet/.test(run.message ?? "")) return `${at}: el archivo de hoy todavía no se publicó. Se reintenta cada hora hasta las 20.`;
      if (/unchanged/.test(run.message ?? "")) return `${at}: el archivo no cambió desde la última carga.`;
      if (/disabled/.test(run.message ?? "")) return `${at}: está desactivada en la configuración (PROMOS_DISABLED).`;
      return `${at}: se salteó. ${run.message ?? ""}`;
    case "failed":
      return `La última corrida falló (${at}): ${run.message ?? "sin detalle"}. Se reintenta en la próxima hora entre las 14 y las 20.`;
  }
}

export default async function StatusPage() {
  const [sources, coverage, chainNames] = await Promise.all([getSourceStatus(sql), promotionCoverage(sql), getChainNames(sql)]);
  const chains = Object.entries(chainNames).sort((a, b) => a[1].localeCompare(b[1], "es"));

  return (
    <main className="page">
      <h1 className="headline">Estado de los datos</h1>
      <p className="lede">
        Los precios salen del registro oficial SEPA y se cargan todos los días a partir de las 14. Las promos se leen una vez por día de las
        páginas de cada supermercado.
      </p>

      <ul className="rows status-list">
        {sources.map((s) => (
          <li key={s.source} className="status-row">
            <h2 className="status-name">{SOURCE_NAMES[s.source] ?? s.source}</h2>
            <p className="status-main">
              {!s.lastSuccess
                ? "Todavía no se cargó nunca."
                : s.publishedAt
                  ? `Precios publicados el ${when.format(s.publishedAt)}, cargados el ${when.format(s.lastSuccess)}.`
                  : `Actualizado el ${when.format(s.lastSuccess)}.`}
            </p>
            {s.lastRun && s.lastRun.status !== "succeeded" && <p className="status-run">{runOutcome(s.lastRun)}</p>}
          </li>
        ))}
      </ul>

      <h2 className="section-title">Promos por cadena</h2>
      <ul className="rows status-list">
        {chains.map(([id, name]) => (
          <li key={id} className="status-row status-chain">
            <span>{name}</span>
            <span className={coverage[id] ? undefined : "stale-note"}>
              {coverage[id] ? "Promos al día" : PROMOTION_SOURCE_BY_CHAIN[id] ? "Promos no informadas" : "Promos no informadas: todavía no las leemos"}
            </span>
          </li>
        ))}
      </ul>
    </main>
  );
}
