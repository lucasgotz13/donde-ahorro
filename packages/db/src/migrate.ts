import { drizzle } from "drizzle-orm/postgres-js";
import { migrate as runMigrations } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const migrationsFolder = new URL("../migrations", import.meta.url).pathname;

/** Applies pending migrations; safe to run on every start. */
export async function migrate(databaseUrl: string): Promise<void> {
  const client = postgres(databaseUrl, { max: 1, onnotice: () => {} });
  try {
    await runMigrations(drizzle(client), { migrationsFolder });
  } finally {
    await client.end();
  }
}
