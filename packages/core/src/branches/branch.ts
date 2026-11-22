export interface Branch {
  /** SEPA id: `<id_comercio>-<id_bandera>-<id_sucursal>`. */
  id: string;
  chainId: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
}
