/** S3, S20: the user's branches live in a cookie on their device; no account. */
export const BRANCHES_COOKIE = "sucursales";

const BRANCH_ID = /^\d+-\d+-\d+$/;
const MAX_BRANCHES = 50;

/** The cookie (or a form) is user input: keep only well-formed SEPA branch ids, once each. */
export function parseBranchIds(value: string | undefined): string[] {
  const ids = (value ?? "").split(",").map((id) => id.trim());
  return [...new Set(ids.filter((id) => BRANCH_ID.test(id)))].slice(0, MAX_BRANCHES);
}

const km = new Intl.NumberFormat("es-AR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export function distanceLabel(meters: number): string {
  if (meters < 995) return `a ${Math.round(meters / 10) * 10} m`;
  if (meters < 9950) return `a ${km.format(meters / 1000)} km`;
  return `a ${Math.round(meters / 1000)} km`;
}

export interface Place {
  lat: number;
  lng: number;
  label: string;
}

interface GeorefResponse {
  direcciones?: { nomenclatura?: string; ubicacion?: { lat: number | null; lon: number | null } }[];
}

export function parseGeoref(json: GeorefResponse): Place | undefined {
  const first = json.direcciones?.[0];
  const { lat, lon } = first?.ubicacion ?? {};
  if (typeof lat !== "number" || typeof lon !== "number") return;
  // "AV RIVADAVIA 5000, Comuna 6, Ciudad Autónoma de Buenos Aires" → the street and number.
  return { lat, lng: lon, label: (first!.nomenclatura ?? "").split(",")[0]!.trim() };
}

/** S3: an address in CABA (Georef `provincia=02`) to coordinates; `undefined` when Georef finds none. */
export async function geocode(address: string): Promise<Place | undefined> {
  const params = new URLSearchParams({ direccion: address, provincia: "02", max: "1" });
  const res = await fetch(`https://apis.datos.gob.ar/georef/api/direcciones?${params}`, {
    headers: { "user-agent": "donde-ahorro (self-hosted price comparison)" },
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`Georef: HTTP ${res.status}`);
  return parseGeoref((await res.json()) as GeorefResponse);
}
