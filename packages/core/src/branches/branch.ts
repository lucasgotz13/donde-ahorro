export interface Branch {
  /** SEPA id: `<id_comercio>-<id_bandera>-<id_sucursal>`. */
  id: string;
  chainId: string;
  name: string;
  address: string;
  /** `null` when SEPA has no coordinates; such branches cannot be found by proximity. */
  lat: number | null;
  lng: number | null;
}
