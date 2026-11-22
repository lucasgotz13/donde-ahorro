// Server only: imported from server components, never from a "use client" module.
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");

// One pool per server process; dev reloads reuse it through globalThis.
const g = globalThis as { __sql?: postgres.Sql };
export const sql = (g.__sql ??= postgres(url, { max: 5, onnotice: () => {} }));
