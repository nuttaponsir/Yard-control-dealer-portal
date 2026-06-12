// @vitest-environment node
// Test2 (QA) — HTTP-LEVEL E2E flow tests against a RUNNING `npm run dev` server.
// These are NOT browser-driven; they drive the same HTTP endpoints the pages use
// (login/me/logout, vin lookup, orders GET/POST) and assert on JSON + on the SSR
// HTML returned by protected routes (redirect behaviour).
//
// These suites are OPT-IN. They require a live dev server AND they mutate the
// DB (e.g. the order-flow test POSTs a real order with no teardown), which would
// pollute the deterministic seed-based integration tests if run alongside them.
// So they run ONLY when E2E_BASE_URL is explicitly set, and skip otherwise:
//
//   E2E_BASE_URL=http://localhost:3002 pnpm test   # then re-seed afterwards
//
// In CI / a normal `pnpm test` (no E2E_BASE_URL) every suite below skips, so the
// gate stays deterministic and never depends on a running dev server.
//
// Maps to: AC-0.1 (protected route -> /auth), AC-0.2/0.3 (login),
// AC-1.3/1.4 (nav per role via /me + useNav), AC-3.1/3.2 (VIN gate),
// AC-1.6/5.7 (admin cannot order), AC-5.1/5.2/5.3/5.5 (order flow + PO + total),
// AC-4.6 (not-installed VIN never orders).
import { describe, it, expect } from 'vitest'

// Probe the base URL: it must answer AND look like this app's auth page, so a
// foreign dev server on a shared port is rejected rather than driven blindly.
async function probe(base: string): Promise<boolean> {
  try {
    const r = await fetch(base + '/auth', { redirect: 'manual', signal: AbortSignal.timeout(3000) })
    if (r.status <= 0) return false
    const html = await r.text()
    return /demo1234|เข้าสู่ระบบ|Dealer Portal/i.test(html) || /\/auth/.test(html)
  } catch {
    return false
  }
}

// Resolve the base URL ONCE at module load (top-level await). Opt-in only: unset
// E2E_BASE_URL (or an unreachable one) yields '' → suites skip.
async function resolveBase(): Promise<string> {
  const base = process.env.E2E_BASE_URL
  if (!base) return ''
  return (await probe(base)) ? base : ''
}

const BASE = await resolveBase()

// ---- tiny cookie-aware client ----------------------------------------------
function makeClient() {
  let cookie = ''
  async function req(path: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers)
    if (cookie) headers.set('cookie', cookie)
    const res = await fetch(BASE + path, { ...init, headers, redirect: 'manual' })
    const setCookie = res.headers.get('set-cookie')
    if (setCookie) {
      const first = setCookie.split(';')[0]!
      cookie = cookie
        ? cookie.replace(/dp_session=[^;]*/, '').replace(/^;\s*/, '') + (first ? '; ' + first : '')
        : first
      // simpler: just keep the latest dp_session
      const sm = setCookie.match(/dp_session=[^;]*/)
      if (sm) cookie = sm[0]
    }
    return res
  }
  async function json(path: string, init?: RequestInit) {
    const res = await req(path, init)
    let body: any = null
    try {
      body = await res.json()
    } catch {
      /* non-json */
    }
    return { res, body }
  }
  return { req, json, getCookie: () => cookie }
}

async function login(email: string, password = 'demo1234') {
  const c = makeClient()
  const { res, body } = await c.json('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  return { client: c, res, user: body?.user ?? null }
}

// These suites require a live dev server; they skip cleanly when none is found.
const e2e = describe.skipIf(!BASE)

e2e('E2E: auth & routing (HTTP)', () => {
  it('AC-0.1: unauthenticated GET /dashboard redirects/bounces to /auth', async () => {
    const res = await fetch(BASE + '/dashboard', { redirect: 'manual' })
    if (res.status >= 300 && res.status < 400) {
      expect(res.headers.get('location')).toContain('/auth')
    } else {
      // Nuxt SSR may 200 then client-redirect; the middleware sends to /auth.
      // Assert the served HTML is the auth page, not the dashboard content.
      const html = await res.text()
      const looksLikeAuth = /\/auth/.test(html) || /demo1234|เข้าสู่ระบบ|login/i.test(html)
      expect(looksLikeAuth).toBe(true)
    }
  })

  it('AC-0.2: valid login returns the session user', async () => {
    const { res, user } = await login('sales@demo.co')
    expect(res.status).toBe(200)
    expect(user).toBeTruthy()
    expect(user.role).toBe('sales')
    expect(user.dealerId).not.toBeNull()
  })

  it('AC-0.3: wrong password is rejected (401, no user)', async () => {
    const { res, user } = await login('sales@demo.co', 'wrongpass')
    expect(res.status).toBe(401)
    expect(user).toBeNull()
  })

  it('AC-0.2: /api/auth/me reflects the logged-in user with the session cookie', async () => {
    const { client } = await login('owner@demo.co')
    const { body } = await client.json('/api/auth/me')
    expect(body?.user?.role).toBe('owner')
  })

  it('AC-0.1: protected API without a session is 401', async () => {
    const r = await fetch(BASE + '/api/orders', { redirect: 'manual' })
    expect(r.status).toBe(401)
  })

  it('AC-0.4: logout clears the session (me -> null afterwards)', async () => {
    const { client } = await login('owner@demo.co')
    await client.json('/api/auth/logout', { method: 'POST' })
    const { body } = await client.json('/api/auth/me')
    expect(body?.user ?? null).toBeNull()
  })
})

e2e('E2E: RBAC nav per role (HTTP /me + nav contract)', () => {
  // The sidebar derives nav from useNav() gated by role; we assert the role the
  // server reports, which drives that gating. (Nav-list correctness is covered
  // exhaustively by component-use-nav.test.ts; this checks the live role.)
  it('AC-1.6: admin cannot place an order (POST /api/orders is forbidden)', async () => {
    const { client, user } = await login('admin@demo.co')
    expect(user.role).toBe('admin')
    expect(user.dealerId).toBeNull()
    const { res } = await client.json('/api/orders', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ vin: 'MMTJNKB40NH000001', items: [{ partId: 1, qty: 1 }] }),
    })
    expect(res.status).toBe(403)
  })
})

e2e('E2E: VIN gate (HTTP)', () => {
  it('AC-3.1: installed VIN returns Autologic detail + installed flag', async () => {
    const { client } = await login('sales@demo.co')
    const { res, body } = await client.json('/api/vin/MMTJNKB40NH000001')
    expect(res.status).toBe(200)
    expect(body.vin).toBeTruthy()
    expect(body.vin.autologicInstalled).toBe(true)
    expect(body.vin.model).toBe('Triton')
    expect(body.vin.modelYear).toBe(2023)
    expect(body.vin.deviceSerial).toBeTruthy()
  })

  it('AC-3.2/4.6: not-installed VIN reports autologicInstalled=false (gate blocks ordering)', async () => {
    const { client } = await login('sales@demo.co')
    const { body } = await client.json('/api/vin/MMAJNATG10NH000009')
    expect(body.vin).toBeTruthy()
    expect(body.vin.autologicInstalled).toBe(false)
  })

  it('AC-3.3: unknown VIN returns not-found (null)', async () => {
    const { client } = await login('sales@demo.co')
    const { body } = await client.json('/api/vin/ZZZZZZZZZZZZZZZZZ')
    expect(body.vin ?? null).toBeNull()
  })
})

e2e('E2E: VIN-gated ORDER flow (HTTP) — sales', () => {
  it('AC-5.1/5.2/5.3/5.5: create order 2x350 + 1x420 = 1120, PO format, pending, appears in list', async () => {
    const { client } = await login('sales@demo.co')

    // verify the VIN is installed first (the gate)
    const { body: vinBody } = await client.json('/api/vin/MMTJNKB40NH000001')
    expect(vinBody.vin.autologicInstalled).toBe(true)

    // partId 1 = MIT-OF-001 @350, partId 2 = MIT-AF-002 @420 (seed order)
    const { res, body } = await client.json('/api/orders', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        vin: 'MMTJNKB40NH000001',
        items: [
          { partId: 1, qty: 2 },
          { partId: 2, qty: 1 },
        ],
      }),
    })
    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    // AC-5.1 PO format
    expect(body.poNumber).toMatch(/^PO-\d{4}-\d{6}$/)
    // AC-5.3 (Phase C) grand total = subtotal 1120 − 10% grade-A tier (112) + 7% VAT (71) = 1079
    expect(body.order.totalValue).toBe(1079)
    // AC-5.2 status pending
    expect(body.order.status).toBe('pending')
    // AC-5.4 tied to dealer + vin
    expect(body.order.dealerId).not.toBeNull()
    expect(body.order.vin).toBe('MMTJNKB40NH000001')

    // AC-5.5 appears in the orders list for this dealer
    const { body: list } = await client.json('/api/orders')
    const found = list.orders.find((o: any) => o.poNumber === body.poNumber)
    expect(found).toBeTruthy()
    expect(found.totalValue).toBe(1079)
    expect(found.status).toBe('pending')
  })

  it('AC-1.7: sales sees only its own dealer orders', async () => {
    const { client, user } = await login('sales@demo.co')
    const { body } = await client.json('/api/orders')
    const dealerIds = new Set(body.orders.map((o: any) => o.dealerId))
    expect(dealerIds.size).toBeLessThanOrEqual(1)
    if (body.orders.length) expect([...dealerIds][0]).toBe(user.dealerId)
  })
})
