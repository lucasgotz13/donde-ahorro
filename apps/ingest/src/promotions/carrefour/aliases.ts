import type { Aliases } from "../store.ts";

/**
 * S18: Carrefour's MasterData bank (FB) and card (FC) names → catalog ids. Names with no canonical id
 * stay out so their promotions are skipped as "entidad desconocida" (e.g. Cuenta Digital, Mi Carrefour,
 * card networks, regional banks).
 */
export const CARREFOUR_ALIASES: Aliases = {
  entities: {
    "Banco_Nacion": "nacion",
    "Banco_Provincia": "provincia",
    "Banco_Ciudad": "ciudad",
    "Banco Galicia": "galicia",
    "Galicia": "galicia",
    "Santander_Rio": "santander",
    "BBVA": "bbva",
    "Frances": "bbva",
    "Macro": "macro",
    "ICBC": "icbc",
    "Patagonia": "patagonia",
    "Superville": "supervielle",
    "Banco_Credicoop": "credicoop",
    "Banco_Hipotecario": "hipotecario",
    "Banco_Columbia": "columbia",
    "Mercado Pago": "mercado-pago",
    "Cuenta Dni": "cuenta-dni",
    "Tarjeta Naranja": "naranja-x",
    "Club La Nación": "club-la-nacion",
    "Tarjeta_Standard_Master_Carrefour": "tarjeta-carrefour",
  },
  // The raw media are the words scrape.ts reads from the promotion's title and subtitle.
  media: {
    "crédito": "credit",
    "débito": "debit",
    "dinero en cuenta": "account-money",
    "QR": "qr",
  },
};
