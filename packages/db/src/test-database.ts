import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { migrate } from "./migrate.ts";

/** Creates and migrates a throwaway database next to `adminUrl`; `drop()` removes it. For tests only. */
export async function createTestDatabase(adminUrl: string) {
  const name = `test_${randomUUID().replaceAll("-", "")}`;
  const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  await admin.unsafe(`create database ${name}`);
  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  await migrate(url.toString());
  const sql = postgres(url.toString(), { max: 1, onnotice: () => {} });
  return {
    url: url.toString(),
    sql,
    async drop() {
      await sql.end();
      await admin.unsafe(`drop database if exists ${name} with (force)`);
      await admin.end();
    },
  };
}
