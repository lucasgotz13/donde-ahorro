/** The E2E database lives next to the development one, under its own name, so a run never touches dev data. */
export function e2eDatabaseUrl(adminUrl: string | undefined): string {
  if (!adminUrl) throw new Error("DATABASE_URL is not set: E2E needs a Postgres server (see .env)");
  const url = new URL(adminUrl);
  url.pathname = "/donde_ahorro_e2e";
  return url.toString();
}
