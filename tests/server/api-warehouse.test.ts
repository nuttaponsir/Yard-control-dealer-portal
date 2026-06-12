// Test1 (QA backend) — Warehouse fulfillment state machine.
// Covers AC-6.2 (advance one step), AC-6.3 (no backward/skip), AC-6.4 (no past
// delivered), and the spec rule that advancing into 'shipped' auto-assigns a
// trackingNo + carrier.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { startServer, stopServer, loginAs, Client } from './harness'
import { db, schema } from '../../server/db'
import { eq } from 'drizzle-orm'

beforeAll(async () => {
  await startServer()
})
afterAll(async () => {
  await stopServer()
})

// Create a fresh order in a known status directly in the DB so each test is
// isolated from seed data and from other tests.
async function makeOrder(status: string, opts: Partial<typeof schema.orders.$inferInsert> = {}) {
  const dealer = await db.query.dealers.findFirst()
  const seq = Math.floor(Math.random() * 900000) + 100000
  const [o] = await db
    .insert(schema.orders)
    .values({
      poNumber: `PO-2026-T${seq}`.slice(0, 14),
      dealerId: dealer!.id,
      vin: 'MMTJNKB40NH000001',
      status,
      totalValue: 1000,
      trackingNo: null,
      carrier: null,
      createdAt: new Date().toISOString(),
      ...opts,
    })
    .returning()
  return o!
}

describe('Fulfillment advance (AC-6.2)', () => {
  it('advances exactly one step forward through the full pipeline', async () => {
    const wh = await loginAs('warehouse@demo.co')
    const order = await makeOrder('pending')
    const steps = ['confirming', 'packing', 'shipped', 'delivered']
    for (const next of steps) {
      const r = await wh.patch<{ order: { status: string } }>(`/api/warehouse/${order.id}`, {
        status: next,
      })
      expect(r.status, `advancing to ${next}`).toBe(200)
      expect(r.body.order.status).toBe(next)
    }
  })
})

describe('Fulfillment guards (AC-6.3 / AC-6.4)', () => {
  it('rejects skipping a step (pending -> packing) with 400', async () => {
    const wh = await loginAs('warehouse@demo.co')
    const order = await makeOrder('pending')
    const r = await wh.patch(`/api/warehouse/${order.id}`, { status: 'packing' })
    expect(r.status).toBe(400)
    const fresh = await db.query.orders.findFirst({ where: eq(schema.orders.id, order.id) })
    expect(fresh!.status).toBe('pending')
  })

  it('rejects moving backward (shipped -> packing) with 400', async () => {
    const wh = await loginAs('warehouse@demo.co')
    const order = await makeOrder('shipped')
    const r = await wh.patch(`/api/warehouse/${order.id}`, { status: 'packing' })
    expect(r.status).toBe(400)
  })

  it('rejects advancing past delivered with 400 (AC-6.4)', async () => {
    const wh = await loginAs('warehouse@demo.co')
    const order = await makeOrder('delivered')
    const r = await wh.patch(`/api/warehouse/${order.id}`, { status: 'delivered' })
    expect(r.status).toBe(400)
  })

  it('rejects a no-op same-status move with 400', async () => {
    const wh = await loginAs('warehouse@demo.co')
    const order = await makeOrder('pending')
    const r = await wh.patch(`/api/warehouse/${order.id}`, { status: 'pending' })
    expect(r.status).toBe(400)
  })
})

describe('Shipping auto-assigns tracking + carrier', () => {
  it('advancing into shipped sets trackingNo and carrier', async () => {
    const wh = await loginAs('warehouse@demo.co')
    const order = await makeOrder('packing')
    const r = await wh.patch<{ order: { status: string; trackingNo: string | null; carrier: string | null } }>(
      `/api/warehouse/${order.id}`,
      { status: 'shipped' },
    )
    expect(r.status).toBe(200)
    expect(r.body.order.status).toBe('shipped')
    expect(r.body.order.trackingNo).toBeTruthy()
    expect(['Flash', 'SCG']).toContain(r.body.order.carrier)
  })
})

describe('Fulfillment RBAC', () => {
  it('sales cannot advance fulfillment (403)', async () => {
    const sales = await loginAs('sales@demo.co')
    const order = await makeOrder('pending')
    const r = await sales.patch(`/api/warehouse/${order.id}`, { status: 'confirming' })
    expect(r.status).toBe(403)
  })

  it('admin can advance fulfillment (200)', async () => {
    const admin = await loginAs('admin@demo.co')
    const order = await makeOrder('pending')
    const r = await admin.patch(`/api/warehouse/${order.id}`, { status: 'confirming' })
    expect(r.status).toBe(200)
  })

  it('unauthenticated advance is rejected (401)', async () => {
    const anon = new Client()
    const order = await makeOrder('pending')
    const r = await anon.patch(`/api/warehouse/${order.id}`, { status: 'confirming' })
    expect(r.status).toBe(401)
  })
})
