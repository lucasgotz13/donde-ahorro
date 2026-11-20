import { createInterface } from "node:readline";
import type { Readable } from "node:stream";

export type SepaRecord = Record<string, string>;

/**
 * Reads a SEPA pipe-delimited CSV. Quotes are literal text (SEPA never quotes fields), a record
 * may be split across two lines (Coto breaks some after `productos_ean`), and the file ends with
 * a blank line plus an "Última actualización" footer, which are skipped.
 */
export async function* readRecords(input: Readable): AsyncGenerator<SepaRecord> {
  let header: string[] | undefined;
  let pending = "";
  for await (const line of createInterface({ input, crlfDelay: Infinity })) {
    if (!header) {
      header = line.replace(/^﻿/, "").split("|");
      continue;
    }
    if (!pending && !line.includes("|")) continue;
    const joined = pending + line;
    const fields = joined.split("|");
    if (fields.length < header.length) {
      pending = joined;
      continue;
    }
    pending = "";
    // shortcut: a record with too many fields is dropped silently; count them if malformed rows show up.
    if (fields.length > header.length) continue;
    yield Object.fromEntries(header.map((name, i) => [name, fields[i]!]));
  }
}

/** SEPA prices are pesos with a dot decimal (`22617`, `3178.99`, `.4`); returns positive cents or `null`. */
export function toCents(value: string): number | null {
  if (!/^\d*\.?\d+$/.test(value)) return null;
  const cents = Math.round(Number(value) * 100);
  return cents > 0 ? cents : null;
}

const coordinate = (value: string | undefined) => {
  const n = Number(value);
  return value && Number.isFinite(n) && n !== 0 ? n : null;
};

const branchId = (r: SepaRecord) => `${r.id_comercio}-${r.id_bandera}-${r.id_sucursal}`;

export function parseBranch(r: SepaRecord) {
  return {
    id: branchId(r),
    chainKey: `${r.id_comercio}-${r.id_bandera}`,
    name: (r.sucursales_nombre ?? "").trim(),
    address: `${r.sucursales_calle ?? ""} ${r.sucursales_numero ?? ""}`.trim(),
    lat: coordinate(r.sucursales_latitud),
    lng: coordinate(r.sucursales_longitud),
    caba: r.sucursales_provincia === "AR-C",
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
  };
}
