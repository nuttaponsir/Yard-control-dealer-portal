// Test1 (QA backend) — VIN-gated order creation & checkout side effects.
// Covers AC-5.1 (PO format), AC-5.2 (pending), AC-5.3 (total = 2×350+1×420=1120),
// AC-5.4 (tied to dealer + VIN), AC-5.5 (appears in list), AC-5.6 (creditUsed += total),
// AC-5.7 / AC-1.6 (admin cannot order), AC-11.3 (PO uniqueness).
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { startServer, stopServer, loginAs } from './harness'
import { db, schema } from '../../server/db'
import { eq } from 'drizzle-orm'

const INSTALLED_VIN = 'MMTJNKB40NH000001'
const PO_RE = /^PO-\d{4}-\d{6}$/

beforeAll(async () => {
  await startServer()
})
afterAll(async () => {
  await stopServer()
})

// Resolve the seeded part ids for the ฿350 (oil filter) and ฿420 (air filter) SKUs.
async function partIdBySku(sku: string): Promise<number> {
  const p = await db.query.parts.findFirst({ where: eq(schema.parts.sku, sku) })
  if (!p) throw new Error(`seed part ${sku} missing`)
  return p.id
}

describe('Order creation as sales (AC-5.x)', () => {
  it('creates a PO with correct format, status, total, dealer & VIN; bumps creditUsed; appears in list', async () => {
    const sales = await loginAs('sales@demo.co')
    const me = await sales.get<{ user: { dealerId: number } }>('/api/auth/me')
    const dealerId = me.body.user.dealerId

    const dealerBefore = await db.query.dealers.findFirst({ where: eq(schema.dealers.id, dealerId) })
    const creditBefore = dealerBefore!.creditUsed

    const oilId = await partIdBySku('MIT-OF-001') // ฿350
    const airId = await partIdBySku('MIT-AF-002') // ฿420

    const r = await sales.post<{
      ok: boolean
      order: { id: number; poNumber: string; status: string; totalValue: number; dealerId: number; vin: string | null }
      poNumber: string
    }>('/api/orders', {
      vin: INSTALLED_VIN,
      items: [
        { partId: oilId, qty: 2 },
        { partId: airId, qty: 1 },
      ],
    })

    expect(r.status).toBe(200)
    const order = r.body.order
    // AC-5.1 PO number format
    expect(order.poNumber).toMatch(PO_RE)
    // AC-5.2 status pending
    expect(order.status).toBe('pending')
    // AC-5.3 (Phase C) subtotal = 2×350 + 1×420 = 1120 from DB prices; the grand
    // total applies the dealer's grade-A 10% tier discount then 7% VAT:
    //   subtotal 1120 − discount 112 = net 1008; vat round(1008×0.07)=71; total 1079
    expect(order.totalValue).toBe(1079)
    // AC-5.4 tied to user's dealer + the given VIN
    expect(order.dealerId).toBe(dealerId)
    expect(order.vin).toBe(INSTALLED_VIN)

    // AC-5.6 creditUsed increased by exactly the (discounted, VAT-inclusive) total
    const dealerAfter = await db.query.dealers.findFirst({ where: eq(schema.dealers.id, dealerId) })
    expect(dealerAfter!.creditUsed).toBe(creditBefore + 1079)

    // AC-5.5 the PO appears in GET /api/orders
    const list = await sales.get<{ orders: { poNumber: string }[] }>('/api/orders')
    expect(list.body.orders.some((o) => o.poNumber === order.poNumber)).toBe(true)

    // line items persisted with captured unit prices
    const items = await db.query.orderItems.findMany({ where: eq(schema.orderItems.orderId, order.id) })
    expect(items.length).toBe(2)
    const total = items.reduce((s, i) => s + i.qty * i.unitPrice, 0)
    expect(total).toBe(1120)
  })

  it('rejects an unknown partId with 400', async () => {
    const sales = await loginAs('sales@demo.co')
    const r = await sales.post('/api/orders', {
      vin: INSTALLED_VIN,
      items: [{ partId: 999999, qty: 1 }],
    })
    expect(r.status).toBe(400)
  })

  it('rejects an empty items array (400 zod)', async () => {
    const sales = await loginAs('sales@demo.co')
    const r = await sales.post('/api/orders', { vin: INSTALLED_VIN, items: [] })
    expect(r.status).toBe(400)
  })

  it('all PO numbers remain unique after creation (AC-11.3)', async () => {
    const all = await db.query.orders.findMany()
    const pos = all.map((o) => o.poNumber)
    expect(new Set(pos).size).toBe(pos.length)
  })
})

describe('admin cannot create an order (AC-5.7 / AC-1.6)', () => {
  it('POST /api/orders as admin is forbidden (403) and creates nothing', async () => {
    const admin = await loginAs('admin@demo.co')
    const oilId = await partIdBySku('MIT-OF-001')
    const r = await admin.post('/api/orders', {
      vin: INSTALLED_VIN,
      items: [{ partId: oilId, qty: 1 }],
    })
    // Forbidden by requireUser(['owner','sales']) — admin is not a permitted role.
    expect(r.status).toBe(403)
    // Concurrency-safe: admin has no dealerId, so no order can be tied to admin.
    // Verify the request returned no created order payload.
    expect((r.body as { order?: unknown }).order).toBeUndefined()
  })
})
