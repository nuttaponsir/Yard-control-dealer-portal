# Deploy to Render — Step-by-Step (Mitsubishi Dealer Portal)

Hosted deployment of the portal using the repo's `render.yaml` Blueprint:
a Dockerized Nuxt SSR web service + managed Postgres, with auto HTTPS and a
free `*.onrender.com` subdomain. Migrations run automatically on every deploy.

- **Repo:** https://github.com/nuttaponsir/Yard-control-dealer-portal
- **Blueprint:** [`render.yaml`](../render.yaml) (repo root)
- **Related:** [`SCAFFOLD.md`](../SCAFFOLD.md) → "Deploy (production)"

---

## Step 0 — Prerequisites (already done ✅)

- Code is on GitHub (`nuttaponsir/Yard-control-dealer-portal`).
- `render.yaml` (Blueprint) is committed at the repo root.
- `Dockerfile` + migrate-on-boot (`docker-entrypoint.sh` → `server/db/migrate.mjs`)
  + `/api/health` healthcheck are in place.

---

## Step 1 — Sign in to Render

1. Open **https://dashboard.render.com**
2. **Get Started** → sign in with **GitHub** (free; use account `nuttaponsir`).
3. Authorize Render for the repo: choose **Only select repositories** →
   tick `Yard-control-dealer-portal` (safer than granting all repos).

---

## Step 2 — Create from Blueprint

1. Top-right **New +** → **Blueprint**.
2. Select repo **`Yard-control-dealer-portal`** → **Connect**.
3. Render reads `render.yaml` and lists two resources:
   - 🌐 Web Service: **`dealer-portal`** (Docker)
   - 🗄️ Database: **`dealer-portal-db`** (Postgres)
4. Name the Blueprint (e.g. `dealer-portal`) → **Apply**.

> Render provisions Postgres first, then injects `DATABASE_URL` (internal) and a
> generated `NUXT_SESSION_SECRET` automatically — **no env vars to set by hand.**

---

## Step 3 — Wait for build + verify

1. Open the **`dealer-portal`** service → **Logs** tab.
2. Expected sequence (~3–5 min):
   ```
   [entrypoint] running database migrations…
   [migrate] applying migrations from /app/server/db/migrations
   [migrate] done — database is up to date
   [entrypoint] starting server on 0.0.0.0:3000
   Listening on http://0.0.0.0:3000
   ```
3. **Events** tab shows **Live** and the `/api/health` healthcheck turns green.
4. The service URL appears at the top: **`https://dealer-portal.onrender.com`**
   (a numeric suffix may be added if the name is taken).

✅ Quick check: open `https://<your-url>/api/health` → expect
`{"status":"ok","database":"up",...}`.

---

## Step 4 — Seed demo data (once)

A fresh DB is empty; you must seed before you can log in (HTTP seeding is
disabled in production — `/api/auth/seed-demo` returns 403).

1. Render → **`dealer-portal-db`** service → **Connect** tab → copy the
   **External Database URL**.
2. On your machine, run (append `?sslmode=require` — required for external
   connections; postgres-js reads it from the URL):
   ```bash
   cd ~/claude/dealer-portal
   DATABASE_URL='<EXTERNAL_URL>?sslmode=require' npm run db:seed
   ```
   Example external URL:
   `postgres://dealerportal:xxxx@dpg-xxxx.singapore-postgres.render.com/dealerportal`
3. Log in (password `demo1234`):
   - `admin@demo.co` (admin)
   - `owner@demo.co`, `sales@demo.co`, `warehouse@demo.co`

---

## Step 5 — Day-to-day

- **Auto-deploy:** edit code → `git push` → Render rebuilds automatically
  (migrations run on every boot, idempotent).
- **Logs:** service → **Logs**.
- **Restart / rebuild:** service → **Manual Deploy** → *Clear cache & deploy*.

---

## ⚠️ Free-tier caveats

| Behavior | Free | Fix for real use |
|---|---|---|
| Web service sleeps after ~15 min idle (first hit ~30 s cold start) | yes | upgrade to **Starter** (~$7/mo) |
| Postgres deleted ~30 days after creation | yes | upgrade DB to a **Basic** plan before expiry |

Change later at service → **Settings → Plan**.

---

## Optional — Custom domain

1. Service → **Settings → Custom Domains** → add your domain.
2. Set the DNS records Render shows (CNAME / A). Render issues a free TLS cert
   and serves HTTPS automatically.

To pin region / plan / domain declaratively, edit [`render.yaml`](../render.yaml).

---

## Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| Build fails at `npm ci` | `package-lock.json` out of sync — run `npm install --package-lock-only`, commit, push |
| Healthcheck never green | check Logs for migrate errors; confirm `DATABASE_URL` wired from the DB resource |
| Can log into page but no data | DB not seeded yet — do **Step 4** |
| `npm run db:seed` SSL error | external URL missing `?sslmode=require` |
| Login works locally but cookie not set in prod | expected — prod cookies are `Secure` (HTTPS only); ensure you use the `https://` URL |
