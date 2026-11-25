# Dónde Ahorro

Self-hosted PWA that compares CABA supermarket prices every day, using SEPA prices plus bank and product promotions, to answer where a product or a cart is cheapest on a given day.

## Layout

| Path | What it is |
| --- | --- |
| `packages/core` | Pure domain (pricing, promotions, branches). No network, no database. |
| `packages/db` | Drizzle schema and SQL migrations for Postgres. |
| `apps/web` | Next.js app: UI and API. |
| `apps/ingest` | Worker that ingests SEPA prices and scrapes promotions and links product photos (from the [Open Food Facts](https://openfoodfacts.org) dump, ~1.5 GB, weekly). |

## Requirements

- Node.js 26 LTS (`.nvmrc`)
- pnpm 12.21.0, installed standalone (Corepack is not used)
- Docker with Compose, for self-hosting

## Development

```sh
pnpm install
cp .env.example .env
docker compose up -d db
pnpm db:migrate
pnpm test        # Vitest; db tests need Postgres running, or no DATABASE_URL to skip them
pnpm test:e2e    # Playwright: recreates the donde_ahorro_e2e database from fixtures, serves on :3200
pnpm typecheck
pnpm dev:web     # http://localhost:3000
pnpm ingest
pnpm ingest:sepa  # download and load today's SEPA prices once (~3 min, ~340 MB download)
pnpm db:generate # after editing packages/db/src/schema.ts
```

If port 5432 is taken, set `POSTGRES_PORT` (and the port in `DATABASE_URL`) in `.env`.

E2E tests use the system Chromium (`/usr/bin/chromium`, or `CHROMIUM_PATH`); without one, run `pnpm --filter @donde-ahorro/web exec playwright install chromium` and unset `CHROMIUM_PATH`. They never touch the development database or live sites.

## Self-hosting

```sh
cp .env.example .env   # then set a real POSTGRES_PASSWORD
docker compose up -d --build
```

This starts `db` (Postgres), `web` (port 3000) and `ingest`, which applies migrations on start.

## License

[AGPL-3.0](LICENSE)
