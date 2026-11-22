import type postgres from "postgres";
import { runPromotionSource } from "../store.ts";
import { CARREFOUR_ALIASES } from "./aliases.ts";
import { scrapeCarrefour } from "./scrape.ts";

export function runCarrefour(
  sql: postgres.Sql,
  { baseUrl, env, now }: { baseUrl?: string; env?: Record<string, string | undefined>; now?: Date } = {},
) {
  return runPromotionSource(sql, { source: "carrefour", aliases: CARREFOUR_ALIASES, scrape: () => scrapeCarrefour(baseUrl, now), env });
}
