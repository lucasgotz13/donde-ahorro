import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/** A SEPA "bandera": Coto, Carrefour, Día, Disco, Jumbo, Vea. */
export const chains = pgTable(
  "chains",
  {
    id: text().primaryKey(),
    name: text().notNull(),
    sepaComercioId: integer().notNull(),
    sepaBanderaId: integer().notNull(),
  },
  (t) => [unique("chains_sepa").on(t.sepaComercioId, t.sepaBanderaId)],
);

export const branches = pgTable("branches", {
  /** SEPA id: `<id_comercio>-<id_bandera>-<id_sucursal>`. */
  id: text().primaryKey(),
  chainId: text()
    .notNull()
    .references(() => chains.id),
  name: text().notNull(),
  address: text().notNull(),
  lat: doublePrecision(),
  lng: doublePrecision(),
});

/** S10: identified by EAN; without one, by the chain's own product code. */
export const products = pgTable(
  "products",
  {
    id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    ean: text(),
    chainId: text().references(() => chains.id),
    chainProductCode: text(),
    description: text().notNull(),
    brand: text(),
    presentation: text(),
  },
  (t) => [
    unique("products_ean").on(t.ean),
    unique("products_chain_code").on(t.chainId, t.chainProductCode),
    check("products_identity", sql`${t.ean} is not null or (${t.chainId} is not null and ${t.chainProductCode} is not null)`),
  ],
);

/** S8: one row per price change; `validTo` is the first day the price no longer held. */
export const pricePeriods = pgTable(
  "price_periods",
  {
    productId: bigint({ mode: "number" })
      .notNull()
      .references(() => products.id),
    branchId: text()
      .notNull()
      .references(() => branches.id),
    /** Integer cents of ARS. */
    price: integer().notNull(),
    validFrom: date().notNull(),
    validTo: date(),
    /** S9: last SEPA publication that reported this price. */
    lastSeen: date().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.productId, t.branchId, t.validFrom] }),
    uniqueIndex("price_periods_one_open").on(t.productId, t.branchId).where(sql`${t.validTo} is null`),
    check("price_periods_valid_range", sql`${t.validTo} is null or ${t.validTo} > ${t.validFrom}`),
  ],
);

/**
 * S25: the product promotions of the latest SEPA load (no history), up to two per product and branch (SEPA's promo1 and promo2).
 * `price` is the unit price, averaged over the group for a multi-buy of `min_quantity` units. Dates are inclusive; null when unknown.
 */
export const productPromos = pgTable(
  "product_promos",
  {
    productId: bigint({ mode: "number" })
      .notNull()
      .references(() => products.id),
    branchId: text()
      .notNull()
      .references(() => branches.id),
    slot: smallint().notNull(),
    /** Integer cents of ARS. */
    price: integer().notNull(),
    minQuantity: smallint().notNull(),
    validFrom: date(),
    validUntil: date(),
    /** The SEPA publication day that reported it. */
    published: date().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.productId, t.branchId, t.slot] }),
    index("product_promos_branch").on(t.branchId),
    check("product_promos_min_quantity", sql`${t.minQuantity} >= 1`),
    check("product_promos_valid_range", sql`${t.validFrom} is null or ${t.validUntil} is null or ${t.validUntil} >= ${t.validFrom}`),
  ],
);

/** S18: canonical catalog of entities (banks, wallets) and payment media (credit, debit, ...). */
export const entities = pgTable("entities", {
  id: text().primaryKey(),
  name: text().notNull(),
});

export const paymentMedia = pgTable("payment_media", {
  id: text().primaryKey(),
  name: text().notNull(),
});

/** S12: canonical eligibility conditions a promotion can require (memberships, card networks). */
export const eligibilityConditions = pgTable("eligibility_conditions", {
  id: text().primaryKey(),
  name: text().notNull(),
});

/** S18: per-adapter mapping from the raw names a source publishes to the catalog. */
export const entityAliases = pgTable(
  "entity_aliases",
  {
    source: text().notNull(),
    raw: text().notNull(),
    entityId: text()
      .notNull()
      .references(() => entities.id),
  },
  (t) => [primaryKey({ columns: [t.source, t.raw] })],
);

export const paymentMediumAliases = pgTable(
  "payment_medium_aliases",
  {
    source: text().notNull(),
    raw: text().notNull(),
    paymentMediumId: text()
      .notNull()
      .references(() => paymentMedia.id),
  },
  (t) => [primaryKey({ columns: [t.source, t.raw] })],
);

export const promotionKind = pgEnum("promotion_kind", ["discount", "refund"]);
export const promotionChannel = pgEnum("promotion_channel", ["online", "in-store", "both"]);
export const capPeriod = pgEnum("cap_period", ["transaction", "day", "week", "month"]);

/** S12: mirrors `Promotion` in `@donde-ahorro/core`. */
export const promotions = pgTable(
  "promotions",
  {
    /** Source-scoped id, e.g. `coto:1234`. */
    id: text().primaryKey(),
    chainId: text()
      .notNull()
      .references(() => chains.id),
    kind: promotionKind().notNull(),
    percent: numeric({ precision: 5, scale: 2, mode: "number" }).notNull(),
    entityId: text().references(() => entities.id),
    paymentMediumId: text().references(() => paymentMedia.id),
    /** 0 = Sunday; empty means every day. */
    weekdays: smallint().array().notNull().default(sql`'{}'`),
    capAmount: integer(),
    capPeriod: capPeriod(),
    capUnknown: boolean().notNull().default(false),
    channel: promotionChannel().notNull(),
    validFrom: date().notNull(),
    validTo: date().notNull(),
    legalText: text().notNull().default(""),
    /** `null`: the default for its kind (refunds stack, discounts do not). */
    stackable: boolean(),
    /** Ids from `eligibility_conditions`, all required; empty means none. */
    conditions: text().array().notNull().default(sql`'{}'`),
    scrapedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      "promotions_cap",
      sql`(${t.capAmount} is null) = (${t.capPeriod} is null) and not (${t.capUnknown} and ${t.capAmount} is not null)`,
    ),
    check("promotions_percent", sql`${t.percent} > 0 and ${t.percent} <= 100`),
    check("promotions_valid_range", sql`${t.validTo} >= ${t.validFrom}`),
  ],
);

export const ingestStatus = pgEnum("ingest_status", ["running", "succeeded", "failed", "skipped"]);

/** S21, S23: one row per source per attempt; feeds the `/estado` page. */
export const ingestRuns = pgTable("ingest_runs", {
  id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  /** `sepa`, or a promotion adapter such as `coto`. */
  source: text().notNull(),
  status: ingestStatus().notNull().default("running"),
  startedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp({ withTimezone: true }),
  /** S21: `last-modified` of the SEPA ZIP this run saw. */
  sourceLastModified: timestamp({ withTimezone: true }),
  message: text(),
  stats: jsonb(),
});
