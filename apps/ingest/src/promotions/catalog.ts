import type postgres from "postgres";

/** S18: canonical entities. Adapters map the names a source publishes onto these ids. */
export const ENTITIES: Record<string, string> = {
  nacion: "Banco Nación",
  provincia: "Banco Provincia",
  ciudad: "Banco Ciudad",
  galicia: "Banco Galicia",
  santander: "Santander",
  bbva: "BBVA",
  macro: "Banco Macro",
  icbc: "ICBC",
  patagonia: "Banco Patagonia",
  supervielle: "Banco Supervielle",
  credicoop: "Banco Credicoop",
  comafi: "Banco Comafi",
  hipotecario: "Banco Hipotecario",
  columbia: "Banco Columbia",
  "mercado-pago": "Mercado Pago",
  modo: "MODO",
  "cuenta-dni": "Cuenta DNI",
  "naranja-x": "Naranja X",
  uala: "Ualá",
  brubank: "Brubank",
  "personal-pay": "Personal Pay",
  "club-la-nacion": "Club La Nación",
  "tarjeta-coto": "Tarjeta Coto (TCI)",
  "tarjeta-carrefour": "Tarjeta Carrefour",
  "carrefour-cuenta-digital": "Cuenta Digital (Carrefour Banco)",
};

/** S18: canonical payment media. */
export const PAYMENT_MEDIA: Record<string, string> = {
  credit: "Tarjeta de crédito",
  debit: "Tarjeta de débito",
  prepaid: "Tarjeta prepaga",
  qr: "Pago con QR",
  "account-money": "Dinero en cuenta",
};

export async function upsertCatalog(sql: postgres.Sql | postgres.TransactionSql) {
  const rows = (catalog: Record<string, string>) => Object.entries(catalog).map(([id, name]) => ({ id, name }));
  await sql`insert into entities ${sql(rows(ENTITIES))} on conflict (id) do update set name = excluded.name`;
  await sql`insert into payment_media ${sql(rows(PAYMENT_MEDIA))} on conflict (id) do update set name = excluded.name`;
}
