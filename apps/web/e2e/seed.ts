// S23: recreates the E2E database from fixtures before Playwright starts the app. Never touches live sites.
import { migrate } from "@donde-ahorro/db";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
const adminUrl = process.env.E2E_ADMIN_DATABASE_URL;
if (!url || !adminUrl) throw new Error("seed.ts needs DATABASE_URL (the E2E database) and E2E_ADMIN_DATABASE_URL");
const name = new URL(url).pathname.slice(1);
if (name !== "donde_ahorro_e2e") throw new Error(`refusing to recreate ${name}: only donde_ahorro_e2e`);

const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
await admin.unsafe(`drop database if exists ${name} with (force)`);
await admin.unsafe(`create database ${name}`);
await admin.end();
await migrate(url);

const day = (offset: number) => {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(new Date());
  return new Date(Date.parse(today) + offset * 86_400_000).toISOString().slice(0, 10);
};
const tomorrowWeekday = new Date(`${day(1)}T00:00:00Z`).getUTCDay();

const sql = postgres(url, { max: 1, onnotice: () => {} });
await sql`insert into chains (id, name, sepa_comercio_id, sepa_bandera_id) values
  ('coto', 'Coto', 12, 1), ('dia', 'Día', 15, 1), ('jumbo', 'Jumbo', 9, 3)`;
await sql`insert into branches (id, chain_id, name, address, lat, lng) values
  ('12-1-1', 'coto', 'CABALLITO', 'Av. Rivadavia 5000', -34.6183, -58.4365),
  ('12-1-2', 'coto', 'PALERMO', 'Av. Santa Fe 3000', -34.588, -58.411),
  ('15-1-1', 'dia', 'Almagro', 'Medrano 800', -34.603, -58.42),
  ('9-3-1', 'jumbo', 'Jumbo Palermo', 'Bullrich 345', -34.575, -58.427)`;
const [yerba] = await sql`insert into products (ean, description, brand, presentation)
  values ('7790001000001', 'YERBA MATE PLAYADITO PAQ 1 KGM', 'PLAYADITO', '1 kgm') returning id`;
const [leche] = await sql`insert into products (ean, description, brand, presentation)
  values ('7790001000002', 'LECHE ENTERA LA SERENISIMA SACHET 1 LT', 'LA SERENISIMA', '1 lt') returning id`;
const [galletitas] = await sql`insert into products (ean, description, brand, presentation)
  values ('7790001000003', 'GALLETITAS OREO PAQ 118 GRM', 'OREO', '118 grm') returning id`;
const prices: [number, string, number][] = [
  [galletitas!.id, "12-1-1", 98000],
  [galletitas!.id, "15-1-1", 100000],
  [galletitas!.id, "9-3-1", 95000],
  [yerba!.id, "12-1-1", 500000],
  [yerba!.id, "12-1-2", 520000],
  [yerba!.id, "15-1-1", 480000],
  [yerba!.id, "9-3-1", 550000],
  [leche!.id, "12-1-1", 150000],
  [leche!.id, "15-1-1", 160000],
  [leche!.id, "9-3-1", 140000],
];
for (const [productId, branchId, price] of prices) {
  await sql`insert into price_periods (product_id, branch_id, price, valid_from, last_seen)
    values (${productId}, ${branchId}, ${price}, ${day(-10)}, ${day(-1)})`;
}

// S25: Jumbo $850 today only; Día "2DO AL 50%" ($750 each for 2).
await sql`insert into product_promos (product_id, branch_id, slot, price, min_quantity, valid_from, valid_until, published) values
  (${galletitas!.id}, '9-3-1', 1, 85000, 1, ${day(-1)}, ${day(0)}, ${day(-1)}),
  (${galletitas!.id}, '15-1-1', 2, 75000, 2, ${day(-1)}, ${day(10)}, ${day(-1)})`;

await sql`insert into entities (id, name) values ('galicia', 'Banco Galicia')`;
await sql`insert into payment_media (id, name) values ('credit', 'Tarjeta de crédito'), ('debit', 'Tarjeta de débito')`;
await sql`insert into eligibility_conditions (id, name) values ('comunidad-coto', 'Comunidad Coto')`;
await sql`insert into promotions (id, chain_id, kind, percent, entity_id, payment_medium_id, weekdays, cap_amount, cap_period, channel, valid_from, valid_to, legal_text) values
  ('coto:1', 'coto', 'refund', 25, 'galicia', 'credit', '{}', 1000000, 'transaction', 'in-store', ${day(-1)}, ${day(10)}, 'Tope de reintegro $10.000 por compra.'),
  ('dia:1', 'dia', 'discount', 50, null, null, ${[tomorrowWeekday]}, null, null, 'both', ${day(-1)}, ${day(10)}, '')`;
await sql`insert into ingest_runs (source, status, started_at, finished_at, source_last_modified) values
  ('sepa', 'succeeded', now(), now(), now()),
  ('coto', 'succeeded', now(), now(), null)`;
await sql.end();
console.log(`[e2e] seeded ${name}`);
