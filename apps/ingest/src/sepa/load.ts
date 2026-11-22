import { pipeline } from "node:stream/promises";
import type { IsoDate } from "@donde-ahorro/core";
import type postgres from "postgres";
import { readEntry } from "./archive.ts";
import { chainIdByKey, SEPA_CHAINS } from "./chains.ts";
import { parseBranch, parsePriceRow, readRecords, type PriceRow } from "./parse.ts";

export interface LoadBranch {
  id: string;
  chainId: string;
  name: string;
  address: string;
  lat: number | null;
  lng: number | null;
}

export async function upsertChains(sql: postgres.Sql): Promise<void> {
  const rows = SEPA_CHAINS.map((c) => ({ id: c.id, name: c.name, sepa_comercio_id: c.comercio, sepa_bandera_id: c.bandera }));
  await sql`insert into chains ${sql(rows)} on conflict (id) do update set name = excluded.name`;
}

/** COPY text format: `\N` for null, and backslash, tab and line breaks escaped. */
const copyValue = (value: string | number | null) =>
  value === null ? "\\N" : String(value).replace(/[\\\t\n\r]/g, (c) => ({ "\\": "\\\\", "\t": "\\t", "\n": "\\n", "\r": "\\r" })[c]!);

/**
 * S8: loads one chain's prices for `day`, storing only changes. A pair (product, branch) keeps one
 * open period; a new price closes it at `day` and opens another (also when the same day is
 * republished with a correction). An older `day` than the one already seen changes nothing, so
 * periods never overlap. A product listed twice for one branch keeps its lowest price. Products missing from the file keep
 * their last known price (S9).
 * S25: the load's product promotions replace the chain's, unless a newer day already set them.
 */
export async function loadChain(
  sql: postgres.Sql,
  { day, branches, rows }: { day: IsoDate; branches: LoadBranch[]; rows: AsyncIterable<PriceRow> },
) {
  const chainOf = new Map(branches.map((b) => [b.id, b.chainId]));
  const stats = { day, branches: branches.length, rows: 0, skipped: 0, new: 0, changed: 0, inPlace: 0, unchanged: 0, promos: 0 };

  await sql.begin(async (tx) => {
    if (branches.length > 0) {
      const values = branches.map((b) => ({ id: b.id, chain_id: b.chainId, name: b.name, address: b.address, lat: b.lat, lng: b.lng }));
      await tx`insert into branches ${tx(values)} on conflict (id) do update
        set chain_id = excluded.chain_id, name = excluded.name, address = excluded.address, lat = excluded.lat, lng = excluded.lng`;
    }

    await tx`create temp table staging (chain_id text, branch_id text, code text, is_ean boolean,
      description text, brand text, presentation text, price integer,
      promo1_price integer, promo1_min smallint, promo1_from date, promo1_until date,
      promo2_price integer, promo2_min smallint, promo2_from date, promo2_until date) on commit drop`;
    const copy = await tx`copy staging from stdin`.writable();
    await pipeline(async function* () {
      for await (const r of rows) {
        const chainId = chainOf.get(r.branchId);
        if (!chainId || !r.code) {
          stats.skipped++;
          continue;
        }
        stats.rows++;
        const promos = [0, 1].flatMap((i) => {
          const p = r.promos[i];
          return p ? [p.price, p.minQuantity, p.validFrom, p.validUntil] : [null, null, null, null];
        });
        yield [chainId, r.branchId, r.code, r.isEan ? "t" : "f", r.description, r.brand, r.presentation, r.price, ...promos].map(copyValue).join("\t") + "\n";
      }
    }, copy);

    // S10: one product per EAN across chains; codes that are not EANs belong to their chain.
    await tx`insert into products (ean, description, brand, presentation)
      select distinct on (code) code, description, brand, presentation from staging where is_ean order by code, description
      on conflict (ean) do nothing`;
    await tx`insert into products (chain_id, chain_product_code, description, brand, presentation)
      select distinct on (chain_id, code) chain_id, code, description, brand, presentation from staging where not is_ean
      order by chain_id, code, description
      on conflict (chain_id, chain_product_code) do nothing`;
    await tx`create temp table resolved on commit drop as
      select p.id as product_id, s.* from staging s join products p on p.ean = s.code where s.is_ean
      union all
      select p.id, s.* from staging s join products p on p.chain_id = s.chain_id and p.chain_product_code = s.code where not s.is_ean`;
    await tx`create temp table today on commit drop as
      select distinct on (product_id, branch_id) product_id, branch_id, price from resolved order by product_id, branch_id, price`;
    await tx`analyze today`;

    const chainIds = [...new Set(branches.map((b) => b.chainId))];
    const chainBranches = tx`select id from branches where chain_id = any(${chainIds}::text[])`;
    const [newer] = await tx`select 1 from product_promos where branch_id in (${chainBranches}) and published > ${day} limit 1`;
    if (!newer) {
      await tx`delete from product_promos where branch_id in (${chainBranches})`;
      stats.promos = (await tx`insert into product_promos (product_id, branch_id, slot, price, min_quantity, valid_from, valid_until, published)
        select distinct on (product_id, branch_id, slot) product_id, branch_id, slot, price, min_quantity, valid_from, valid_until, ${day}::date
        from (
          select product_id, branch_id, 1 as slot, promo1_price as price, promo1_min as min_quantity, promo1_from as valid_from, promo1_until as valid_until
          from resolved where promo1_price is not null
          union all
          select product_id, branch_id, 2, promo2_price, promo2_min, promo2_from, promo2_until from resolved where promo2_price is not null
        ) p order by product_id, branch_id, slot, price`).count;
    }

    const open = tx`pp.product_id = t.product_id and pp.branch_id = t.branch_id and pp.valid_to is null`;
    // The same day loaded again (a republished ZIP): correct the price that day opened.
    stats.inPlace = (await tx`update price_periods pp set price = t.price from today t
      where ${open} and pp.valid_from = ${day} and pp.last_seen = ${day} and pp.price <> t.price`).count;
    // Another price on this day or a newer one: close the open period at `day` and open a new one.
    await tx`create temp table closed on commit drop as
      with c as (
        update price_periods pp set valid_to = ${day} from today t
        where ${open} and pp.valid_from < ${day} and pp.last_seen <= ${day} and pp.price <> t.price
        returning pp.product_id, pp.branch_id, t.price
      ) select * from c`;
    stats.changed = (await tx`insert into price_periods (product_id, branch_id, price, valid_from, last_seen)
      select product_id, branch_id, price, ${day}, ${day} from closed`).count;
    stats.new = (await tx`insert into price_periods (product_id, branch_id, price, valid_from, last_seen)
      select t.product_id, t.branch_id, t.price, ${day}, ${day} from today t
      where not exists (select 1 from price_periods pp where ${open})`).count;
    stats.unchanged = (await tx`update price_periods pp set last_seen = ${day} from today t
      where ${open} and pp.price = t.price and pp.last_seen < ${day}`).count;
  });
  return stats;
}

/** Loads one inner SEPA archive (one `id_comercio`): its CABA branches of the MVP chains and their prices. */
export async function loadInnerArchive(sql: postgres.Sql, innerZip: string) {
  const [comercio] = await collect(readRecords(readEntry(innerZip, "comercio.csv")));
  const day = comercio?.comercio_ultima_actualizacion?.slice(0, 10) ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error(`SEPA ${innerZip}: no publication date in comercio.csv`);

  const branches: LoadBranch[] = [];
  for await (const record of readRecords(readEntry(innerZip, "sucursales.csv"))) {
    const { chainKey, caba, ...branch } = parseBranch(record);
    const chainId = chainIdByKey.get(chainKey);
    if (caba && chainId) branches.push({ ...branch, chainId });
  }

  const parsing = { malformed: 0, invalidPrice: 0 };
  async function* rows() {
    for await (const record of readRecords(readEntry(innerZip, "productos.csv"), parsing)) {
      const row = parsePriceRow(record);
      if (row) yield row;
      else parsing.invalidPrice++;
    }
  }
  return { ...(await loadChain(sql, { day, branches, rows: rows() })), ...parsing };
}

async function collect<T>(items: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of items) out.push(item);
  return out;
}
