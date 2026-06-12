#!/bin/sh
# Production container entrypoint: bring the schema up to date, then start the
# Nitro server. Migrations are idempotent (drizzle journal), so this is safe to
# run on every boot / rolling deploy. A failed migration aborts startup (set -e)
# rather than booting against a stale schema.
set -e

echo "[entrypoint] running database migrations…"
node server/db/migrate.mjs

echo "[entrypoint] starting server on ${NITRO_HOST}:${NITRO_PORT}"
exec node .output/server/index.mjs
