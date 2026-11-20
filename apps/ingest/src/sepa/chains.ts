/** S7: the MVP chains, one per SEPA bandera (`id_comercio` + `id_bandera`). */
export const SEPA_CHAINS = [
  { id: "coto", name: "Coto", comercio: 12, bandera: 1 },
  { id: "carrefour-hiper", name: "Carrefour Hipermercado", comercio: 10, bandera: 1 },
  { id: "carrefour-market", name: "Carrefour Market", comercio: 10, bandera: 2 },
  { id: "carrefour-express", name: "Carrefour Express", comercio: 10, bandera: 3 },
  { id: "carrefour-maxi", name: "Carrefour Maxi", comercio: 10, bandera: 4 },
  { id: "dia", name: "Día", comercio: 15, bandera: 1 },
  { id: "vea", name: "Vea", comercio: 9, bandera: 1 },
  { id: "disco", name: "Disco", comercio: 9, bandera: 2 },
  { id: "jumbo", name: "Jumbo", comercio: 9, bandera: 3 },
] as const;

export const chainIdByKey = new Map<string, string>(SEPA_CHAINS.map((c) => [`${c.comercio}-${c.bandera}`, c.id]));

export const sepaComercios = [...new Set(SEPA_CHAINS.map((c) => c.comercio))];
