# Dónde Ahorro

Self-hosted PWA that compares CABA supermarket prices every day, using SEPA prices plus bank and product promotions, to answer where a product or a cart is cheapest on a given day.

## Layout

| Path | What it is |
| --- | --- |
| `packages/core` | Pure domain (pricing, promotions, branches). No network, no database. |
| `apps/web` | Next.js app: UI and API. |
| `apps/ingest` | Worker that ingests SEPA prices and scrapes promotions. |

## Requirements

- Node.js 26 LTS (`.nvmrc`)
- pnpm 12.21.0, installed standalone (Corepack is not used)
- Docker with Compose, for self-hosting

## Development

```sh
pnpm install
pnpm test        # Vitest
pnpm typecheck
pnpm dev:web     # http://localhost:3000
pnpm ingest
```

## Self-hosting

```sh
cp .env.example .env   # then set a real POSTGRES_PASSWORD
docker compose up -d --build
```

This starts `db` (Postgres), `web` (port 3000) and `ingest`.

## License

[AGPL-3.0](LICENSE)
