import type { Cents, IsoDate } from "@donde-ahorro/core";
import type postgres from "postgres";

type Sql = postgres.Sql;

/** Upper case without accents, so "baño", "BANO" and "Baño" match the same text. */
const fold = (text: string) => text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toUpperCase();
const foldColumn = (sql: Sql, column: postgres.Fragment) => sql`translate(upper(${column}), 'ÁÉÍÓÚÜÑ', 'AEIOUUN')`;

export interface ProductMatch {
  /** `bigint`, kept as text. */
  id: string;
  description: string;
  brand: string | null;
  presentation: string | null;
  /** Cheapest current price in any branch; `null` when no branch reports one. */
  minPrice: Cents | null;
  /** Chains with a current price. */
  chains: number;
}

/**
 * S2 (a): products whose description or brand holds every word of `query` (or whose EAN is `query`).
 * Descriptions that start with the first word come first, then those sold by more chains, then shorter ones.
 */
export async function searchProducts(sql: Sql, query: string, limit = 30): Promise<ProductMatch[]> {
  const terms = fold(query).split(/\s+/).filter(Boolean);
  // A query of only one- or two-letter words matches most of the catalog: ask for a real word instead.
  if (!terms.some((t) => t.length >= 3)) return [];
  const patterns = terms.map((t) => `%${t.replace(/[\\%_]/g, "\\$&")}%`);
  const starts = `${patterns[0]!.slice(1)}`; // the first word at the start of the description
  const text = foldColumn(sql, sql`description || ' ' || coalesce(brand, '')`);
  // shortcut: scans every match (~150 ms for "leche" on 42k products); add a pg_trgm index and a
  // per-product chain count if the catalog or the latency grows.
  return sql<ProductMatch[]>`
    with matches as (
      select id, description, brand, presentation
      from products
      where ean = ${query.trim()} or ${text} like all(${patterns}::text[])
    ), priced as (
      -- A branch id starts with its chain's SEPA comercio and bandera ids, so no join is needed.
      select m.*, min(pp.price)::int as "minPrice",
        count(distinct substring(pp.branch_id from '^[0-9]+-[0-9]+'))::int as chains
      from matches m
      left join price_periods pp on pp.product_id = m.id and pp.valid_to is null
      group by m.id, m.description, m.brand, m.presentation
    )
    select id::text, description, brand, presentation, "minPrice", chains
    from priced
    order by ${foldColumn(sql, sql`description`)} like ${starts} desc, chains desc, length(description), priced.id
    limit ${limit}`;
}

export interface BranchPrice {
  branchId: string;
  name: string;
  address: string;
  price: Cents;
  lastSeen: IsoDate;
}

export interface ChainPrices {
  chainId: string;
  chainName: string;
  minPrice: Cents;
  maxPrice: Cents;
  /** The most recent SEPA publication among its branches (S9). */
  lastSeen: IsoDate;
  /** Cheapest first. */
  branches: BranchPrice[];
}

export interface ProductDetail {
  id: string;
  ean: string | null;
  description: string;
  brand: string | null;
  presentation: string | null;
  /** Current prices, cheapest chain first. */
  chains: ChainPrices[];
}

export async function getProduct(sql: Sql, id: string): Promise<ProductDetail | undefined> {
  const [product] = await sql`select id::text, ean, description, brand, presentation from products where id = ${id}`;
  if (!product) return;
  const rows = await sql`
    select b.chain_id, c.name as chain_name, b.id as branch_id, b.name, b.address, pp.price, pp.last_seen::text
    from price_periods pp
    join branches b on b.id = pp.branch_id
    join chains c on c.id = b.chain_id
    where pp.product_id = ${id} and pp.valid_to is null
    order by pp.price, b.name`;
  const chains = new Map<string, ChainPrices>();
  for (const r of rows) {
    const chain: ChainPrices = chains.get(r.chain_id) ?? { chainId: r.chain_id, chainName: r.chain_name, minPrice: r.price, maxPrice: r.price, lastSeen: r.last_seen, branches: [] };
    chain.maxPrice = Math.max(chain.maxPrice, r.price);
    if (r.last_seen > chain.lastSeen) chain.lastSeen = r.last_seen;
    chain.branches.push({ branchId: r.branch_id, name: r.name, address: r.address, price: r.price, lastSeen: r.last_seen });
    chains.set(r.chain_id, chain);
  }
  // Rows come cheapest first, so chains are already ordered by their minimum price.
  return { ...(product as Omit<ProductDetail, "chains">), chains: [...chains.values()] };
}

export interface ChainPeriod {
  chainId: string;
  chainName: string;
  price: Cents;
  validFrom: IsoDate;
  validTo: IsoDate | null;
}

/** S2 (c): every stored price period of a product, with its chain. */
export function getPriceHistory(sql: Sql, id: string): Promise<ChainPeriod[]> {
  return sql<ChainPeriod[]>`
    select b.chain_id as "chainId", c.name as "chainName", pp.price,
      pp.valid_from::text as "validFrom", pp.valid_to::text as "validTo"
    from price_periods pp
    join branches b on b.id = pp.branch_id
    join chains c on c.id = b.chain_id
    where pp.product_id = ${id}
    order by pp.valid_from`;
}

export interface SimilarProduct {
  id: string;
  description: string;
  presentation: string | null;
  minPrice: Cents | null;
}

/** S10: same brand, same presentation and same first word; shown apart, never merged. */
export function similarProducts(sql: Sql, id: string, limit = 6): Promise<SimilarProduct[]> {
  return sql<SimilarProduct[]>`
    select p.id::text, p.description, p.presentation, min(pp.price)::int as "minPrice"
    from products me
    join products p on p.id <> me.id and p.brand = me.brand and p.presentation = me.presentation
      and split_part(p.description, ' ', 1) = split_part(me.description, ' ', 1)
    left join price_periods pp on pp.product_id = p.id and pp.valid_to is null
    where me.id = ${id}
    group by p.id, p.description, p.presentation
    order by count(pp.price) desc, p.description
    limit ${limit}`;
}

/** When the last loaded SEPA ZIP was published; `undefined` before the first successful run. */
export async function lastSepaUpdate(sql: Sql): Promise<Date | undefined> {
  const [run] = await sql`select source_last_modified from ingest_runs
    where source = 'sepa' and status = 'succeeded' order by started_at desc limit 1`;
  return run?.source_last_modified ?? undefined;
}
