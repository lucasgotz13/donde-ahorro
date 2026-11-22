# Corepack is not used (Node.js 25+ stops shipping it), so pnpm is installed explicitly.
FROM node:26-slim AS base
RUN npm install -g pnpm@12.21.0
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY apps/web/package.json apps/web/
COPY apps/ingest/package.json apps/ingest/
RUN pnpm install --frozen-lockfile
COPY . .

FROM deps AS web-build
RUN pnpm --filter @donde-ahorro/web build

FROM node:26-slim AS web
WORKDIR /app
ENV NODE_ENV=production
COPY --from=web-build /app/apps/web/.next/standalone ./
COPY --from=web-build /app/apps/web/.next/static ./apps/web/.next/static
EXPOSE 3000
CMD ["node", "apps/web/server.js"]

FROM deps AS ingest
# The SEPA adapter reads the nested ZIPs with the system unzip.
RUN apt-get update && apt-get install -y --no-install-recommends unzip && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
CMD ["pnpm", "ingest"]
