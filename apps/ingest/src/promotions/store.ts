import type { Promotion } from "@donde-ahorro/core";
import type postgres from "postgres";
import { upsertCatalog } from "./catalog.ts";

/** What an adapter scrapes: a promotion whose entity and medium are still the source's raw names. */
export interface ScrapedPromotion extends Omit<Promotion, "entity" | "paymentMedium"> {
  /** `null` only when the source says any entity qualifies. */
  rawEntity: string | null;
  rawMedium: string | null;
  /** The source's raw names for the eligibility conditions it requires; absent means none. */
  rawConditions?: string[];
}

/** S18: raw name → canonical catalog id, per source. */
export interface Aliases {
  entities: Record<string, string>;
  media: Record<string, string>;
  conditions?: Record<string, string>;
}

function rejection(p: ScrapedPromotion, aliases: Aliases): string | undefined {
  // An unmapped entity is never stored as null: null means "any entity".
  if (p.rawEntity !== null && !(p.rawEntity in aliases.entities)) return `entidad desconocida: ${p.rawEntity}`;
  if (p.rawMedium !== null && !(p.rawMedium in aliases.media)) return `medio de pago desconocido: ${p.rawMedium}`;
  const condition = p.rawConditions?.find((c) => !(c in (aliases.conditions ?? {})));
  if (condition !== undefined) return `condición desconocida: ${condition}`;
  const day = p.weekdays.find((d) => !Number.isInteger(d) || d < 0 || d > 6);
  if (day !== undefined) return `día inválido: ${day}`;
  if (!(p.percent > 0 && p.percent <= 100)) return `porcentaje inválido: ${p.percent}`;
}

/**
 * One promotion-source run, logged in `ingest_runs` (S23): scrapes, maps and validates, then replaces
 * this source's promotions (ids `<source>:...`) in one transaction. A failed scrape keeps the old ones.
 * S22: `PROMOS_DISABLED=coto,carrefour` disables sources.
 */
export async function runPromotionSource(
  sql: postgres.Sql,
  { source, aliases, scrape, env = process.env }: {
    source: string;
    aliases: Aliases;
    scrape: () => Promise<ScrapedPromotion[]>;
    env?: Record<string, string | undefined>;
  },
) {
  const [run] = await sql`insert into ingest_runs (source) values (${source}) returning id`;
  const finish = (fields: Record<string, unknown>) =>
    sql`update ingest_runs set ${sql({ ...fields, finished_at: new Date() })} where id = ${run!.id}`;
  if ((env.PROMOS_DISABLED ?? "").split(",").map((s) => s.trim()).includes(source)) {
    return finish({ status: "skipped", message: `${source} disabled by PROMOS_DISABLED` });
  }
  try {
    const scraped = await scrape();
    const skipped: { id: string; reason: string }[] = [];
    const rows: Record<string, unknown>[] = [];
    for (const p of scraped) {
      if (!p.id.startsWith(`${source}:`)) throw new Error(`promotion id ${p.id} lacks the ${source}: prefix`);
      const reason = rejection(p, aliases);
      if (reason) {
        skipped.push({ id: p.id, reason });
        continue;
      }
      const cap = p.cap === "unknown" || p.cap === null ? null : p.cap;
      rows.push({
        id: p.id,
        chain_id: p.chainId,
        kind: p.kind,
        percent: p.percent,
        entity_id: p.rawEntity === null ? null : aliases.entities[p.rawEntity]!,
        payment_medium_id: p.rawMedium === null ? null : aliases.media[p.rawMedium]!,
        weekdays: p.weekdays,
        cap_amount: cap?.amount ?? null,
        cap_period: cap?.period ?? null,
        cap_unknown: p.cap === "unknown",
        channel: p.channel,
        valid_from: p.validFrom,
        valid_to: p.validTo,
        legal_text: p.legalText,
        stackable: p.stackable ?? null,
        conditions: (p.rawConditions ?? []).map((c) => aliases.conditions![c]!),
      });
    }
    // Every promotion rejected means the source changed (e.g. renamed logos), not that it has none: keep the old ones.
    if (scraped.length && !rows.length) {
      throw new Error(`every scraped promotion was rejected (${skipped.length}), first: ${skipped[0]!.reason}`);
    }
    await sql.begin(async (tx) => {
      await upsertCatalog(tx);
      const aliasRows = (map: Record<string, string>, column: string) =>
        Object.entries(map).map(([raw, id]) => ({ source, raw, [column]: id }));
      const entityAliases = aliasRows(aliases.entities, "entity_id");
      const mediumAliases = aliasRows(aliases.media, "payment_medium_id");
      await tx`delete from entity_aliases where source = ${source}`;
      await tx`delete from payment_medium_aliases where source = ${source}`;
      if (entityAliases.length) await tx`insert into entity_aliases ${tx(entityAliases)}`;
      if (mediumAliases.length) await tx`insert into payment_medium_aliases ${tx(mediumAliases)}`;
      await tx`delete from promotions where starts_with(id, ${`${source}:`})`;
      if (rows.length) await tx`insert into promotions ${tx(rows)}`;
    });
    for (const s of skipped) console.warn(`[${source}] ${s.id} skipped: ${s.reason}`);
    await finish({ status: "succeeded", stats: sql.json({ saved: rows.length, skipped }) });
  } catch (error) {
    await finish({ status: "failed", message: String(error) });
    throw error;
  }
}
