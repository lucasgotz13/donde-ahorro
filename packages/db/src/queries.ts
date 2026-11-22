import type { Cents, IsoDate, Promotion } from "@donde-ahorro/core";
import type postgres from "postgres";

type Sql = postgres.Sql;

/** Upper case without accents, so "baño", "BANO" and "Baño" match the same text. */
const fold = (text: string) => text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toUpperCase();
const foldColumn = (sql: Sql, column: postgres.Fragment) => sql`translate(upper(${column}), 'ÁÉÍÓÚÜÑ', 'AEIOUUN')`;

/** The folded words of `query`, and a `LIKE` pattern per word. */
function words(query: string) {
  const terms = fold(query).split(/\s+/).filter(Boolean);
  return { terms, patterns: terms.map((t) => `%${t.replace(/[\\%_]/g, "\\$&")}%`) };
}

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
  const { terms, patterns } = words(query);
  // A query of only one- or two-letter words matches most of the catalog: ask for a real word instead.
  if (!terms.some((t) => t.length >= 3)) return [];
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

/** `branchIds` (S3): only the user's branches; chains without one are left out. */
export async function getProduct(sql: Sql, id: string, branchIds?: string[]): Promise<ProductDetail | undefined> {
  const [product] = await sql`select id::text, ean, description, brand, presentation from products where id = ${id}`;
  if (!product) return;
  const rows = await sql`
    select b.chain_id, c.name as chain_name, b.id as branch_id, b.name, b.address, pp.price, pp.last_seen::text
    from price_periods pp
    join branches b on b.id = pp.branch_id
    join chains c on c.id = b.chain_id
    where pp.product_id = ${id} and pp.valid_to is null
      ${branchIds ? sql`and pp.branch_id = any(${branchIds}::text[])` : sql``}
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

/** S2 (c): every stored price period of a product, with its chain; `branchIds` as in `getProduct`. */
export function getPriceHistory(sql: Sql, id: string, branchIds?: string[]): Promise<ChainPeriod[]> {
  return sql<ChainPeriod[]>`
    select b.chain_id as "chainId", c.name as "chainName", pp.price,
      pp.valid_from::text as "validFrom", pp.valid_to::text as "validTo"
    from price_periods pp
    join branches b on b.id = pp.branch_id
    join chains c on c.id = b.chain_id
    where pp.product_id = ${id}
      ${branchIds ? sql`and pp.branch_id = any(${branchIds}::text[])` : sql``}
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

export interface BranchSummary {
  id: string;
  chainId: string;
  chainName: string;
  name: string;
  address: string;
}

const branchColumns = (sql: Sql) =>
  sql`b.id, b.chain_id as "chainId", c.name as "chainName", b.name, b.address`;

/** S3: branches whose chain, name or address hold every word of `query`. */
export function searchBranches(sql: Sql, query: string, limit = 50): Promise<BranchSummary[]> {
  const { patterns } = words(query);
  if (!patterns.length) return Promise.resolve([]);
  return sql<BranchSummary[]>`
    select ${branchColumns(sql)} from branches b join chains c on c.id = b.chain_id
    where ${foldColumn(sql, sql`c.name || ' ' || b.name || ' ' || b.address`)} like all(${patterns}::text[])
    order by c.name, b.name
    limit ${limit}`;
}

/** S3: the closest branches to a point, with the straight-line distance in meters. */
export function nearestBranches(
  sql: Sql,
  { lat, lng }: { lat: number; lng: number },
  limit = 10,
): Promise<(BranchSummary & { meters: number })[]> {
  // Haversine on a 6,371 km sphere; a full scan of ~900 branches is instant.
  return sql<(BranchSummary & { meters: number })[]>`
    select ${branchColumns(sql)},
      round(2 * 6371000 * asin(sqrt(
        power(sin(radians(b.lat - ${lat}) / 2), 2) +
        cos(radians(${lat})) * cos(radians(b.lat)) * power(sin(radians(b.lng - ${lng}) / 2), 2)
      )))::int as meters
    from branches b join chains c on c.id = b.chain_id
    where b.lat is not null and b.lng is not null
    order by meters, b.id
    limit ${limit}`;
}

/** The branches with these ids, in chain and name order; unknown ids are ignored. */
export function getBranches(sql: Sql, ids: string[]): Promise<BranchSummary[]> {
  if (!ids.length) return Promise.resolve([]);
  return sql<BranchSummary[]>`
    select ${branchColumns(sql)} from branches b join chains c on c.id = b.chain_id
    where b.id = any(${ids}::text[])
    order by c.name, b.name`;
}

/** S12: the stored promotions of these chains, as the core model `bestPrice` takes. */
export async function getPromotions(sql: Sql, chainIds: string[]): Promise<Promotion[]> {
  if (!chainIds.length) return [];
  const rows = await sql`
    select id, chain_id, kind, percent::float8 as percent, entity_id, payment_medium_id, weekdays,
      cap_amount, cap_period, cap_unknown, channel, valid_from::text, valid_to::text, legal_text, stackable, conditions
    from promotions where chain_id = any(${chainIds}::text[]) order by id`;
  return rows.map((r) => ({
    id: r.id,
    chainId: r.chain_id,
    kind: r.kind,
    percent: r.percent,
    entity: r.entity_id,
    paymentMedium: r.payment_medium_id,
    weekdays: r.weekdays,
    cap: r.cap_unknown ? "unknown" : r.cap_amount === null ? null : { amount: r.cap_amount, period: r.cap_period },
    channel: r.channel,
    validFrom: r.valid_from,
    validTo: r.valid_to,
    legalText: r.legal_text,
    ...(r.stackable !== null && { stackable: r.stackable }),
    conditions: r.conditions,
  }));
}

export interface CatalogItem {
  id: string;
  name: string;
}

/** S18: what the user can say they have: entities some promotion names, every medium and condition. */
export async function getPaymentCatalog(sql: Sql): Promise<{ entities: CatalogItem[]; media: CatalogItem[]; conditions: CatalogItem[] }> {
  const [entities, media, conditions] = await Promise.all([
    sql<CatalogItem[]>`select id, name from entities e where exists (select 1 from promotions p where p.entity_id = e.id) order by name`,
    sql<CatalogItem[]>`select id, name from payment_media order by name`,
    sql<CatalogItem[]>`select id, name from eligibility_conditions order by name`,
  ]);
  return { entities, media, conditions };
}

export interface CartProduct {
  id: string;
  description: string;
  presentation: string | null;
  /** Cheapest current price per chain id; chains without a price are absent. */
  prices: Record<string, Cents>;
}

/** S17: cart products in the given order, unknown ids dropped; `branchIds` as in `getProduct`. */
export async function getCartProducts(sql: Sql, ids: string[], branchIds?: string[]): Promise<CartProduct[]> {
  if (!ids.length) return [];
  const rows = await sql`
    select p.id::text, p.description, p.presentation, b.chain_id, min(pp.price)::int as price
    from products p
    left join price_periods pp on pp.product_id = p.id and pp.valid_to is null
      ${branchIds ? sql`and pp.branch_id = any(${branchIds}::text[])` : sql``}
    left join branches b on b.id = pp.branch_id
    where p.id = any(${ids}::bigint[])
    group by p.id, p.description, p.presentation, b.chain_id
    order by b.chain_id`;
  const byId = new Map<string, CartProduct>();
  for (const r of rows) {
    const product: CartProduct = byId.get(r.id) ?? { id: r.id, description: r.description, presentation: r.presentation, prices: {} };
    if (r.chain_id) product.prices[r.chain_id] = r.price;
    byId.set(r.id, product);
  }
  return ids.flatMap((id) => byId.get(id) ?? []);
}

/** Chain id → display name. */
export async function getChainNames(sql: Sql): Promise<Record<string, string>> {
  return Object.fromEntries((await sql`select id, name from chains`).map((c) => [c.id, c.name]));
}
