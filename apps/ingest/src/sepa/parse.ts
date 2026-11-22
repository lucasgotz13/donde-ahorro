import { createInterface } from "node:readline";
import type { Readable } from "node:stream";

export type SepaRecord = Record<string, string>;

/**
 * Reads a SEPA pipe-delimited CSV. Quotes are literal text (SEPA never quotes fields), a record
 * may be split across two lines (Coto breaks some after `productos_ean`), and the file ends with
 * a blank line plus an "Última actualización" footer, which are skipped. Rows that cannot be read
 * are counted in `stats.malformed`.
 */
export async function* readRecords(input: Readable, stats = { malformed: 0 }): AsyncGenerator<SepaRecord> {
  let header: string[] | undefined;
  let pending = "";
  for await (const line of createInterface({ input, crlfDelay: Infinity })) {
    if (!header) {
      header = line.replace(/^\uFEFF/, "").split("|");
      continue;
    }
    if (!pending && !line.includes("|")) continue;
    let fields = (pending + line).split("|");
    if (fields.length < header.length) {
      pending += line;
      continue;
    }
    if (fields.length > header.length) {
      if (pending) {
        // The pending fragment was a broken row, not the first half of this one.
        stats.malformed++;
        fields = line.split("|");
      }
      pending = "";
      if (fields.length < header.length) pending = line;
      if (fields.length > header.length) stats.malformed++;
      if (fields.length !== header.length) continue;
    }
    pending = "";
    yield Object.fromEntries(header.map((name, i) => [name, fields[i]!]));
  }
  if (pending) stats.malformed++;
}

/** SEPA prices are pesos with a dot decimal (`22617`, `3178.99`, `.4`, `12.`); returns positive cents or `null`. */
export function toCents(value: string): number | null {
  if (!/^(\d+\.?\d*|\.\d+)$/.test(value)) return null;
  const cents = Math.round(Number(value) * 100);
  return cents > 0 ? cents : null;
}

const coordinate = (value: string | undefined) => {
  const n = Number(value);
  return value && Number.isFinite(n) && n !== 0 ? n : null;
};

/**
 * CABA is `AR-C`, but Carrefour also flags branches of Córdoba, Trelew and Buenos Aires province as `AR-C`: a postal code
 * outside CABA's 1000–1499 rules a branch out, unless its locality names CABA (Coto writes a street number there).
 */
function inCaba(r: SepaRecord): boolean {
  if (r.sucursales_provincia !== "AR-C") return false;
  const postal = Number((r.sucursales_codigo_postal ?? "").replace(/\D/g, "") || 0);
  if (!postal || (postal >= 1000 && postal <= 1499)) return true;
  return /capital|ciudad aut[oó]noma|caba/i.test(r.sucursales_localidad ?? "");
}

const branchId = (r: SepaRecord) => `${r.id_comercio}-${r.id_bandera}-${r.id_sucursal}`;

export function parseBranch(r: SepaRecord) {
  return {
    id: branchId(r),
    chainKey: `${r.id_comercio}-${r.id_bandera}`,
    name: (r.sucursales_nombre ?? "").trim(),
    address: `${r.sucursales_calle ?? ""} ${r.sucursales_numero ?? ""}`.trim(),
    lat: coordinate(r.sucursales_latitud),
    lng: coordinate(r.sucursales_longitud),
    caba: inCaba(r),
  };
}

const isoDate = (dmy: string) => dmy.split("/").reverse().join("-");

/**
 * S25: what a SEPA promo legend says. Día: "25% de descuento. 2DO AL 50% LECHE LV - Vigencia: Desde el 11/11/2026 hasta el
 * 16/11/2026"; Carrefour: "Promo A valida desde el 12/11/2026 hasta 18/11/2026"; Coto: "DEL 13/11/2026 AL 18/11/2026".
 * The deal after Día's "de descuento." sets the group size: "2DO AL", "3X2", "2X$1000", "LLEVANDO 2".
 */
export function parsePromoLegend(legend: string) {
  const dates = /(?:desde el|del)\s+(\d{2}\/\d{2}\/\d{4})\s+(?:hasta(?: el)?|al)\s+(\d{2}\/\d{2}\/\d{4})/i.exec(legend);
  const deal = /de descuento\.\s+(?:(\d+)(?:DO AL|X)|LLEVANDO (\d+))/i.exec(legend);
  const group = Number(deal?.[1] ?? deal?.[2] ?? 1);
  return {
    minQuantity: group >= 2 && group <= 12 ? group : 1,
    validFrom: dates ? isoDate(dates[1]!) : null,
    validUntil: dates ? isoDate(dates[2]!) : null,
  };
}

export type PriceRow = NonNullable<ReturnType<typeof parsePriceRow>>;

export function parsePriceRow(r: SepaRecord) {
  const price = toCents(r.productos_precio_lista ?? "");
  if (price === null) return null;
  const presentation = `${r.productos_cantidad_presentacion ?? ""} ${r.productos_unidad_medida_presentacion ?? ""}`.trim();
  return {
    branchId: branchId(r),
    code: r.id_producto ?? "",
    isEan: r.productos_ean === "1",
    description: (r.productos_descripcion ?? "").trim(),
    brand: (r.productos_marca ?? "").trim() || null,
    presentation: presentation || null,
    price,
    promos: [1, 2].flatMap((slot) => {
      const promoPrice = toCents(r[`productos_precio_unitario_promo${slot}`] ?? "");
      return promoPrice !== null && promoPrice < price
        ? [{ price: promoPrice, ...parsePromoLegend(r[`productos_leyenda_promo${slot}`] ?? "") }]
        : [];
    }),
  };
}
