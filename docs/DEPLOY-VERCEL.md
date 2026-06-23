# Deploy to Vercel

Vercel runs the Nuxt SSR app as serverless functions — Nitro auto-selects its
`vercel` preset when it detects the Vercel build env, so **no code changes are
needed**. Two things differ from the Render/Docker path:

1. **Database is external.** Vercel doesn't host a long-running Postgres. Use a
   serverless Postgres — **Neon** (free) is the easiest and integrates with
   Vercel. (Supabase / Vercel Postgres also work.)
2. **Migrations don't run on boot.** There's no container entrypoint on Vercel,
   so you run `db:deploy` yourself (once, and after any schema change).

---

## Step 1 — Create the database (Neon)

1. **neon.tech** → sign in → **New Project** (region close to users, e.g. Singapore).
2. Copy the **pooled** connection string (the host contains `-pooler`, and it
   ends with `?sslmode=require`). Pooled is important for serverless.
   ```
   postgres://USER:PASSWORD@ep-xxxx-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require
   ```
   > Or: Vercel dashboard → **Storage → Marketplace → Neon** to provision it and
   > have `DATABASE_URL` injected automatically.

## Step 2 — Run migrations (once, from your machine)

The migrate runner (`server/db/migrate.mjs`) applies every migration (idempotent):

```bash
cd ~/claude/dealer-portal
DATABASE_URL='<NEON_POOLED_URL>' npm run db:deploy
```

Re-run this whenever you add a migration. (Optional: set Vercel's **Build
Command** to `npm run db:deploy && npm run build` to auto-migrate on every
deploy — only do this if the build env has `DATABASE_URL`.)

## Step 3 — Deploy the app

1. **vercel.com** → sign in with GitHub → **Add New… → Project** → import
   `nuttaponsir/Yard-control-dealer-portal`.
2. Vercel auto-detects **Nuxt** (Framework Preset = Nuxt; Build = `nuxt build`).
   Leave the defaults. Set **Node.js Version = 22.x** in Project Settings.
3. **Environment Variables** (Production):
   | Key | Value |
   |-----|-------|
   | `DATABASE_URL` | the Neon **pooled** URL from Step 1 |
   | `NUXT_SESSION_SECRET` | a strong random string — generate with `openssl rand -base64 32` |
   | `ALLOW_DEMO_SEED` | `true` (demo/trial only — see Step 4) |
4. **Deploy**. Wait for the build, then open the assigned `*.vercel.app` URL.

## Step 4 — Seed demo data

- **One click (demo):** with `ALLOW_DEMO_SEED=true`, open `/auth` → click
  **"สร้าง / รีเฟรชข้อมูลตัวอย่าง"** → log in. Set the flag to `false` afterwards
  for a real DB.
- **Ops (locked-down):** `DATABASE_URL='<NEON_POOLED_URL>' npm run db:seed`.

Demo logins (password `demo1234`): `admin@demo.co`, `owner@demo.co`,
`sales@demo.co`, `warehouse@demo.co`.

---

## Serverless caveats (fine for a demo)

- **Cold starts / Neon auto-suspend** — the free Neon DB sleeps when idle; the
  first request after a pause is slow (a few seconds), then warm.
- **Login rate limiting** is in-memory, so it's per-function-instance on Vercel
  (not shared). Acceptable for a trial; use a shared store (Redis/Upstash) for
  real production.
- **Connections** — always use the Neon **pooled** endpoint; the app keeps a
  small client per warm instance.

## Render vs Vercel

| | Render (Blueprint) | Vercel |
|---|---|---|
| Web | Docker container (always-on / free sleeps) | serverless functions |
| Postgres | managed, provisioned by `render.yaml` | external (Neon) |
| Migrations | auto on each deploy (entrypoint) | manual `db:deploy` (or build step) |
| Secret | auto-generated | you set `NUXT_SESSION_SECRET` |
| One-file IaC | `render.yaml` ✅ | not required (auto-detect) |
