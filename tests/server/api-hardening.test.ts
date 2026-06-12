// Phase F — production hardening tests.
//   1. /api/health is an unauthenticated DB-backed liveness probe.
//   2. /api/auth/seed-demo is hard-disabled when NODE_ENV=production (it reseeds
//      the whole DB unauthenticated, so it must never be reachable in prod).
//   3. Login is brute-force throttled: repeated failures for one IP+email return
//      429 once the window limit is exceeded; a wrong attempt does not lock out a
//      different identity.
//   4. Server-side session expiry: an expired session row is rejected (and
//      cleaned up) by getUser, regardless of the cookie's own lifetime.
// All assertions use isolated identities / read-only probes so the shared seed
// data and the rest of the suite are untouched.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { startServer, stopServer, loginAs, Client } from './harness'
import { db, schema } from '../../server/db'
import { eq } from 'drizzle-orm'
import { __resetRateLimits } from '../../server/utils/rate-limit'

beforeAll(async () => {
  await startServer()
})
afterAll(async () => {
  await stopServer()
})

describe('Phase F: health probe', () => {
  it('GET /api/health reports ok + database up (no auth needed)', async () => {
    const c = new Client()
    const r = await c.get<{ status: string; database: string; latencyMs: number; uptime: number }>(
      '/api/health',
    )
    expect(r.status).toBe(200)
    expect(r.body.status).toBe('ok')
    expect(r.body.database).toBe('up')
    expect(typeof r.body.latencyMs).toBe('number')
    expect(typeof r.body.uptime).toBe('number')
  })
})

describe('Phase F: seed-demo production gate', () => {
  it('is blocked with 403 when NODE_ENV=production (no DB mutation)', async () => {
    const prev = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    try {
      const c = new Client()
      const r = await c.post('/api/auth/seed-demo')
      expect(r.status).toBe(403)
    } finally {
      process.env.NODE_ENV = prev
    }
  })
})

describe('Phase F: login rate limiting', () => {
  it('returns 429 after too many failed attempts for one IP+email', async () => {
    __resetRateLimits()
    const email = 'rl-probe@nowhere.test' // never exists → every attempt fails
    const c = new Client()

    // 8 failures are allowed (each an honest 401)…
    for (let i = 0; i < 8; i++) {
      const r = await c.post('/api/auth/login', { email, password: 'wrong-pass' })
      expect(r.status).toBe(401)
    }
    // …the 9th trips the limiter.
    const blocked = await c.post('/api/auth/login', { email, password: 'wrong-pass' })
    expect(blocked.status).toBe(429)
  })

  it('does not lock out a different identity', async () => {
    __resetRateLimits()
    const victim = new Client()
    // Burn down one email…
    for (let i = 0; i < 9; i++) {
      await victim.post('/api/auth/login', { email: 'rl-a@nowhere.test', password: 'x' })
    }
    // …a real demo login on a different email still succeeds.
    const ok = await victim.post('/api/auth/login', { email: 'admin@demo.co', password: 'demo1234' })
    expect(ok.status).toBe(200)
  })
})

describe('Phase F: server-side session expiry', () => {
  it('rejects and cleans up an expired session', async () => {
    __resetRateLimits()
    const c = await loginAs('admin@demo.co')

    // The httpOnly cookie value is the opaque session id.
    const sid = (c.cookie ?? '').split('=')[1] ?? ''
    expect(sid).not.toBe('')

    // Confirm the live session is valid first.
    const before = await c.get<{ user: unknown }>('/api/auth/me')
    expect(before.body.user).not.toBeNull()

    // Force-expire it in the past.
    await db
      .update(schema.sessions)
      .set({ expiresAt: new Date(Date.now() - 1000).toISOString() })
      .where(eq(schema.sessions.id, sid))

    // getUser now treats it as logged-out…
    const after = await c.get<{ user: unknown }>('/api/auth/me')
    expect(after.body.user).toBeNull()

    // …and the expired row was deleted.
    const row = await db.query.sessions.findFirst({ where: eq(schema.sessions.id, sid) })
    expect(row).toBeUndefined()
  })
})
