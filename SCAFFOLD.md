# Mitsubishi Dealer Portal — Scaffold & Dev Ownership Map

VIN-gated Mitsubishi spare-parts ordering portal for a dealer network. Thai-first
(TH/EN toggle), dark theme, Mitsubishi red accent (#E60012).

Stack: Nuxt 4 (SSR) + Vue 3 + Tailwind v4 + Drizzle ORM + Postgres + Zod + Vitest.
Node 24, npm.

## Run it

```bash
cp .env.example .env        # already present in the working tree
npm install
npm run db:up               # docker compose Postgres on localhost:5434
npm run db:deploy           # apply migrations (server/db/migrations) — fresh + idempotent
npm run db:seed             # 100 dealers, 4 demo users, parts, vins, orders, claims
npm run dev                 # http://localhost:3000  → /auth
npm test                    # vitest
```

> Schema changes: edit `server/db/schema.ts`, then `npm run db:generate` to emit a
> new migration, and `npm run db:deploy` to apply it. `db:push` (interactive) is
> kept only for throwaway local experiments — migrations are the source of truth.

Demo accounts (password `demo1234`): `admin@demo.co`, `owner@demo.co`,
`sales@demo.co`, `warehouse@demo.co`. The /auth page also has a
"สร้าง/รีเฟรชข้อมูลตัวอย่าง" button → `POST /api/auth/seed-demo` (re-runs the seed).
This endpoint is **disabled when `NODE_ENV=production`**.

## Deploy (production)

### Hosted (recommended): Render Blueprint — managed Postgres + HTTPS + subdomain

The repo ships a `render.yaml` Blueprint that provisions everything (no server,
no reverse proxy, no DB setup to manage by hand):

1. Push this repo to GitHub/GitLab.
2. Render → **New +** → **Blueprint** → select the repo. Render reads
   `render.yaml`: creates a managed Postgres, builds the `Dockerfile`, injects
   `DATABASE_URL` (internal) and a generated `NUXT_SESSION_SECRET`, and deploys
   the web service with auto HTTPS at `https://dealer-portal.onrender.com`.
3. Migrations run on boot via the container entrypoint (idempotent). The
   `/api/health` healthcheck gates the rollout.
4. **Seed once** (fresh prod DB has no users; `seed-demo` is 403 in prod). From
   your laptop, using the DB's **External** connection string with SSL:
   ```bash
   DATABASE_URL='postgres://USER:PWD@HOST/DB?sslmode=require' npm run db:seed
   ```
   (postgres-js reads `sslmode=require` from the URL — required for external/
   managed connections; the in-network `DATABASE_URL` on Render needs no SSL.)

Notes: Render's **free** Postgres is deleted ~30 days after creation and the
free web instance sleeps when idle — switch both to a paid plan for real
production. The same Docker image deploys unchanged on Railway / Fly.io
(set `NODE_ENV=production`, `NUXT_SESSION_SECRET`, `DATABASE_URL`; target port
`3000`); only the provisioning UI differs.

### Self-hosted: Docker Compose

The app ships as a self-contained Docker image (multi-stage build → Nitro node
server). Migrations run automatically on container boot.

```bash
# Required: a strong secret (the server refuses to boot in prod without it)
export NUXT_SESSION_SECRET="$(openssl rand -hex 32)"

docker compose up -d --build        # builds app image, starts Postgres + app
# → app on http://localhost:3000, Postgres on :5434
```

What happens on `app` boot (`docker-entrypoint.sh`):
1. `node server/db/migrate.mjs` — applies any pending migrations (idempotent;
   safe on every deploy / rolling restart).
2. `node .output/server/index.mjs` — starts the SSR server on `:3000`.

Production hardening that switches on with `NODE_ENV=production`:
- session cookies become `Secure` (HTTPS-only) + HSTS header is sent
- `/api/auth/seed-demo` returns 403
- the server **refuses to start** if `NUXT_SESSION_SECRET` is unset or the dev default

Required env: `DATABASE_URL`, `NUXT_SESSION_SECRET`, `NODE_ENV=production`.
Ops endpoints: `GET /api/health` (DB-backed liveness/readiness; also wired as the
container `HEALTHCHECK`). Seed a brand-new prod DB once with `npm run db:seed`
(an ops task, never a public HTTP call).

Manual (non-Docker) deploy:
```bash
npm ci && npm run build         # → .output
NODE_ENV=production NUXT_SESSION_SECRET=… DATABASE_URL=… npm run db:deploy
NODE_ENV=production NUXT_SESSION_SECRET=… DATABASE_URL=… node .output/server/index.mjs
```

## SHARED — DO NOT EDIT without flagging the SA
These define cross-module contracts. If a module needs a change, note it here and
ping the SA — do not silently edit.

- `server/db/schema.ts` — Drizzle tables (dealers, users, vins, parts, inventory,
  orders, orderItems, claims, sessions, payments). Phase G added: `payments`
  table, `orders.amountPaid` + `orders.paymentStatus`, `users.active`.
- `server/db/index.ts` — db client
- `server/db/seed-data.ts` + `server/db/seed.ts` — seed dataset
- `server/utils/auth.ts` — `requireUser(event, roles?)`, session helpers
- `server/utils/validation.ts` — `parseBody(event, schema)` + `loginSchema` (Zod reference pattern)
- `app/types/index.ts` — domain types
- `app/utils/labels.ts` — status→Thai label maps, tones, `thb()`
- `app/composables/useNav.ts` — sidebar nav + role gates
- `app/composables/useI18n.ts`, `usePageTitle.ts`
- `app/composables/useCart.ts` — cart STATE contract (Dev2 fleshes out logic, keep the shape)
- `app/composables/useAuth.ts` — auth contract (Dev1 owns; others consume)
- `app/middleware/auth.global.ts` — route protection
- `app/layouts/default.vue`, `app/layouts/auth.vue`, `app/app.vue`
- `app/components/AppCard.vue`, `StatCard.vue`, `StatusBadge.vue`, `DataTable.vue`,
  `AppButton.vue`, `CategoryChip.vue`, `EmptyState.vue`, `AppSidebar.vue`, `AppHeader.vue`
- `app/assets/css/main.css` — theme tokens
- root config: `nuxt.config.ts`, `drizzle.config.ts`, `docker-compose.yml`, `.env*`

Component auto-import names: file `AppCard.vue` → `<AppCard>`, etc.

## Per-dev ownership

### Dev1 — auth, dashboard, VIN
Owns / edits:
- `app/pages/auth.vue` (login already functional — polish/extend)
- `app/pages/dashboard.vue`
- `app/pages/vin.vue`
- `server/api/auth/login.post.ts`, `logout.post.ts`, `me.get.ts`, `seed-demo.post.ts`
- `server/api/dashboard.get.ts`
- `server/api/vin/[vin].get.ts`
- `app/composables/useAuth.ts` (owner of the auth contract)

### Dev2 — catalog, orders, cart
Owns / edits:
- `app/pages/catalog.vue`, `app/pages/orders.vue`
- `server/api/parts/index.get.ts`
- `server/api/orders/index.get.ts`, `server/api/orders/index.post.ts`
- cart logic inside `app/composables/useCart.ts` (keep the exported shape)
- new files: `server/api/parts/[id].get.ts`, `server/api/orders/[id].get.ts` as needed

### Dev3 — claims, fulfillment
Owns / edits:
- `app/pages/claims.vue`, `app/pages/fulfillment.vue`
- `server/api/claims/index.get.ts`, `server/api/claims/index.post.ts`
- `server/api/fulfillment.get.ts`
- new files: `server/api/fulfillment/[id].patch.ts` (Kanban moves) as needed

### Dev4 — admin, i18n, theme polish
Owns / edits:
- `app/pages/admin.vue`
- `server/api/dealers/index.get.ts`
- `app/locales/th.ts`, `app/locales/en.ts` (expand dictionaries)
- theme polish in `app/assets/css/main.css` (coordinate via SA if structural)

### Phase G — Payments / AR + User Management (post-launch)
Owns / edits:
- `app/pages/payments.vue` — record-payment form (admin/owner) + receipt history
- `app/pages/users.vue` — admin user directory + create/edit/reset-password
- `server/api/payments/index.get.ts` (dealer-scoped, fails closed),
  `server/api/payments/index.post.ts` (admin/owner; releases dealer credit in a txn)
- `server/api/reports/ar-aging.get.ts` (admin-only AR aging buckets)
- `server/api/users/index.get.ts`, `index.post.ts`, `[id].put.ts`,
  `[id]/reset-password.post.ts` (all admin-only; password hash never serialized)
- consumed contract change: `server/api/auth/login.post.ts` rejects `active === false`
- Credit lifecycle note: orders consume credit on create; cancels/returns release
  on goods movement; **payments release it on settlement** (`creditUsed = GREATEST(0, …)`).

## Conventions to follow
- Every protected API route starts with `await requireUser(event, [roles])`.
- Validate request bodies with Zod via `parseBody(event, schema)` — see
  `server/api/auth/login.post.ts` for the reference pattern.
- Never inline Thai status strings — use `app/utils/labels.ts`.
- Render codes (SKU/VIN/PO) with the `code` class / DataTable `mono` column flag.
- Dealer-scoped roles (owner/sales) must filter by `user.dealerId` in their queries.
- admin is NOT tied to a dealer and cannot place orders.
