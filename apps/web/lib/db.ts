// Server only: imported from server components, never from a "use client" module.
import postgres from "postgres";

const url = process.env.DATABASE_URL;
// `next build` imports every page to collect its config; no page queries at build time, so only runtime needs the URL.
if (!url && process.env.NEXT_PHASE !== "phase-production-build") throw new Error("DATABASE_URL is not set");

// One pool per server process; dev reloads reuse it through globalThis.
const g = globalThis as { __sql?: postgres.Sql };
export const sql = (g.__sql ??= postgres(url ?? "", { max: 5, onnotice: () => {} }));
