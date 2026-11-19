export interface Product {
  id: string;
  /** `null` when SEPA reports an internal code instead of an EAN; such products match by description only. */
  ean: string | null;
  description: string;
  brand: string | null;
  presentation: string | null;
}
