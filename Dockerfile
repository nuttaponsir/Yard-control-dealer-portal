# syntax=docker/dockerfile:1
# ============================================================================
# Mitsubishi Dealer Portal — production image (multi-stage).
#   1. builder   — installs all deps and runs `nuxt build` → .output
#   2. proddeps  — clean production-only node_modules (for the migrate step)
#   3. runner    — slim runtime: Nitro server + migrate runner, runs as non-root
# The Nitro output (.output) is self-contained; node_modules is carried only so
# the on-boot migration runner (server/db/migrate.mjs) can reach drizzle/postgres.
# ============================================================================

# ---- 1. builder ------------------------------------------------------------
FROM node:24-alpine AS builder
WORKDIR /app
ENV CI=1
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# ---- 2. production dependencies -------------------------------------------
FROM node:24-alpine AS proddeps
WORKDIR /app
ENV CI=1
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ---- 3. runner -------------------------------------------------------------
FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NITRO_PORT=3000 \
    NITRO_HOST=0.0.0.0 \
    PORT=3000

# Built app, production deps, and the migration assets.
COPY --from=builder  /app/.output                 ./.output
COPY --from=proddeps /app/node_modules            ./node_modules
COPY --from=builder  /app/package.json            ./package.json
COPY --from=builder  /app/server/db/migrate.mjs   ./server/db/migrate.mjs
COPY --from=builder  /app/server/db/migrations    ./server/db/migrations
COPY docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

# Run as the built-in unprivileged user.
USER node

EXPOSE 3000

# Liveness/readiness probe hits the app's own DB-backed health endpoint.
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD wget --spider -q http://127.0.0.1:3000/api/health || exit 1

ENTRYPOINT ["./docker-entrypoint.sh"]
