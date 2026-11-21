import type postgres from "postgres";
import { runPromotionSource } from "../store.ts";
import { COTO_ALIASES } from "./aliases.ts";
import { COTO_PROMOS_URL, scrapeCoto } from "./scrape.ts";

/** One Coto promotion run (S11), logged in `ingest_runs`; `PROMOS_DISABLED=coto` turns it off (S22). */
export const runCoto = (
  sql: postgres.Sql,
  { url = COTO_PROMOS_URL, env }: { url?: string; env?: Record<string, string | undefined> } = {},
) => runPromotionSource(sql, { source: "coto", aliases: COTO_ALIASES, scrape: () => scrapeCoto(url), env });
