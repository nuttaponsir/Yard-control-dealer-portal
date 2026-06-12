// Test1 (QA backend) — Auth & RBAC integration tests.
// Covers AC-0.2, AC-0.3, AC-1.7, AC-1.8, AC-9.5 (dealers admin-only),
// plus the GET /api/auth/me + unauthenticated-rejection requirements.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { startServer, stopServer, Client, loginAs } from './harness'
import { db } from '../../server/db'

beforeAll(async () => {
  await startServer()
})
afterAll(async () => {
  await stopServer()
})

describe('Auth (AC-0.2 / AC-0.3)', () => {
  it('valid login succeeds and sets a session cookie', async () => {
    const c = new Client()
    const r = await c.post<{ user: { email: string; role: string } }>('/api/auth/login', {
      email: 'sales@demo.co',
      password: 'demo1234',
    })
    expect(r.status).toBe(200)
    expect(r.body.user.email).toBe('sales@demo.co')
    expect(r.body.user.role).toBe('sales')
    expect(c.cookie).toMatch(/^dp_session=/)
  })

  it('wrong password is rejected with 401', async () => {
    const c = new Client()
    const r = await c.post('/api/auth/login', { email: 'sales@demo.co', password: 'wrong' })
    expect(r.status).toBe(401)
    expect(c.cookie).toBeNull()
  })

  it('GET /api/auth/me reflects the logged-in user incl. dealerId', async () => {
    const sales = await loginAs('sales@demo.co')
    const me = await sales.get<{ user: { email: string; role: string; dealerId: number | null } }>(
      '/api/auth/me',
    )
    expect(me.status).toBe(200)
    expect(me.body.user.email).toBe('sales@demo.co')
    expect(me.body.user.role).toBe('sales')
    expect(typeof me.body.user.dealerId).toBe('number')

    // admin has no dealer
    const admin = await loginAs('admin@demo.co')
    const adminMe = await admin.get<{ user: { dealerId: number | null } }>('/api/auth/me')
    expect(adminMe.body.user.dealerId).toBeNull()
  })

  it('an unauthenticated protected call is rejected (401 on /api/orders)', async () => {
    const anon = new Client()
    const r = await anon.get('/api/orders')
    expect(r.status).toBe(401)
  })
})

describe('RBAC data scoping (AC-1.7 / AC-1.8)', () => {
  it('sales sees ONLY its own dealer rows in GET /api/orders', async () => {
    const sales = await loginAs('sales@demo.co')
    const me = await sales.get<{ user: { dealerId: number } }>('/api/auth/me')
    const dealerId = me.body.user.dealerId
    const r = await sales.get<{ orders: { dealerId: number }[] }>('/api/orders')
    expect(r.status).toBe(200)
    expect(r.body.orders.length).toBeGreaterThan(0)
    expect(r.body.orders.every((o) => o.dealerId === dealerId)).toBe(true)
  })

  it('owner sees ONLY its own dealer rows in GET /api/orders', async () => {
    const owner = await loginAs('owner@demo.co')
    const me = await owner.get<{ user: { dealerId: number } }>('/api/auth/me')
    const dealerId = me.body.user.dealerId
    const r = await owner.get<{ orders: { dealerId: number }[] }>('/api/orders')
    expect(r.body.orders.every((o) => o.dealerId === dealerId)).toBe(true)
  })

  it('admin sees ALL dealers rows in GET /api/orders', async () => {
    const admin = await loginAs('admin@demo.co')
    const r = await admin.get<{ orders: { dealerId: number }[] }>('/api/orders')
    // total order count from DB == admin-visible count
    const all = await db.query.orders.findMany()
    expect(r.body.orders.length).toBe(all.length)
    const distinctDealers = new Set(r.body.orders.map((o) => o.dealerId))
    expect(distinctDealers.size).toBeGreaterThan(1) // spans multiple dealers
  })
})

describe('RBAC route guard — GET /api/dealers is admin-only (AC-9.5)', () => {
  it('admin can list dealers', async () => {
    const admin = await loginAs('admin@demo.co')
    const r = await admin.get<{ dealers: unknown[] }>('/api/dealers')
    expect(r.status).toBe(200)
    expect(Array.isArray(r.body.dealers)).toBe(true)
  })

  it('sales is forbidden (403) from GET /api/dealers', async () => {
    const sales = await loginAs('sales@demo.co')
    const r = await sales.get('/api/dealers')
    expect(r.status).toBe(403)
  })

  it('unauthenticated GET /api/dealers is rejected (401)', async () => {
    const anon = new Client()
    const r = await anon.get('/api/dealers')
    expect(r.status).toBe(401)
  })
})
