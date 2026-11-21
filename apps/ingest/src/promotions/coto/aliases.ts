import type { Aliases } from "../store.ts";

/**
 * S18: Coto names entities by logo file. Left out on purpose (no catalog id, skipped as "entidad
 * desconocida"): logo_visa1.png, logo_amex1.png, and the non-payment programs logo_jubiladosypensionados.png,
 * logo_comunidad.png, logo_beneficios_anses.png and logo_ciudadania_portena.png.
 */
export const COTO_ALIASES: Aliases = {
  entities: {
    "logo_ciudad1.png": "ciudad",
    "logo_columbia_1.png": "columbia",
    "logo_comafi2.png": "comafi",
    "logo_comafi_unico.png": "comafi",
    "logo_credicoop.png": "credicoop",
    "logo_galicia.png": "galicia",
    "logo_icbc_1.png": "icbc",
    "logo_macro_bma3.png": "macro",
    "logo_mercadopago.png": "mercado-pago",
    "logo_modo.png": "modo",
    "logo_nacion_d.png": "nacion",
    "logo_naranjax2.png": "naranja-x",
    "logo_patagonia2.png": "patagonia",
    "logo_supervielle2.png": "supervielle",
    "logo_tci.png": "tarjeta-coto",
    "Personal_pay.png": "personal-pay",
  },
  // The medium names the description itself uses (see `mediumOf` in scrape.ts).
  media: { "crédito": "credit", "débito": "debit", prepaga: "prepaid", QR: "qr" },
};
