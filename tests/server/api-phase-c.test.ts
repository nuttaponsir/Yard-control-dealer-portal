// Phase C regression tests — business-rule hardening on the order lifecycle.
//   1. Tiered pricing + VAT are computed server-side (grade discount, vat_rate).
//   2. Credit-limit enforcement rejects an order that would exceed headroom.
//   3. Stock guard rejects an oversell (qty > total on-hand).
//   4. Order create decrements stock + charges credit; cancel restores both.
// Isolated test dealers/users are created so we never perturb the demo dealer.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { Client } from './harness';
import { startServer, stopServer, loginAs } from './harness'
import { db, schema } from '../../server/db'
import { eq, and, inArray } from 'drizzle-orm'
import { ledgerHighWater, cleanupLedgerAbove } from './ledger'

let ledgerMark = 0

const INSTALLED_VIN = 'MMTJNKB40NH000001'

let lowUserEmail = ''
let highUserEmail = ''
let lowDealerId = 0
let highDealerId = 0
let lowUserId = 0
let highUserId = 0

async function part(sku: string) {
  const p = await db.query.parts.findFirst({ where: eq(schema.parts.sku, sku) })
  return p!
}
async function totalOnHand(partId: number): Promise<number> {
  const rows = await db.query.inventory.findMany({ where: eq(schema.inventory.partId, partId) })
  return rows.reduce((s, r) => s + r.qtyOnHand, 0)
}
async function creditUsed(dealerId: number): Promise<number> {
  const d = await db.query.dealers.findFirst({ where: eq(schema.dealers.id, dealerId) })
  return d!.creditUsed
}

beforeAll(async () => {
  await startServer()
  ledgerMark = await ledgerHighWater()
  // Reuse the shared "demo1234" hash so loginAs() works for our test users.
  const admin = await db.query.users.findFirst({ where: eq(schema.users.email, 'admin@demo.co') })
  const hash = admin!.passwordHash
  const now = new Date().toISOString()
  const stamp = Date.now() % 1000000

  const [low] = await db
    .insert(schema.dealers)
    .values({
      code: `TCLOW${stamp}`,
      name: 'ดีลเลอร์ทดสอบ (วงเงินต่ำ)',
      province: 'กรุงเทพ',
      phone: '02-000-0000',
      grade: 'C', // 0% discount → simplest math
      creditLimit: 5000,
      creditUsed: 0,
      createdAt: now,
    })
    .returning()
  lowDealerId = low!.id
  lowUserEmail = `cphase-low-${stamp}@demo.co`
  const [lowUser] = await db.insert(schema.users).values({
    email: lowUserEmail, passwordHash: hash, role: 'sales', dealerId: lowDealerId, createdAt: now,
  }).returning()
  lowUserId = lowUser!.id

  const [high] = await db
    .insert(schema.dealers)
    .values({
      code: `TCHI${stamp}`,
      name: 'ดีลเลอร์ทดสอบ (วงเงินสูง)',
      province: 'กรุงเทพ',
      phone: '02-000-0001',
      grade: 'C',
      creditLimit: 100_000_000, // so credit never trips before the stock guard
      creditUsed: 0,
      createdAt: now,
    })
    .returning()
  highDealerId = high!.id
  highUserEmail = `cphase-high-${stamp}@demo.co`
  const [highUser] = await db.insert(schema.users).values({
    email: highUserEmail, passwordHash: hash, role: 'sales', dealerId: highDealerId, createdAt: now,
  }).returning()
  highUserId = highUser!.id
})

afterAll(async () => {
  // Tear down everything this file inserted so seed-integrity counts stay exact.
  const dealerIds = [lowDealerId, highDealerId].filter(Boolean)
  const userIds = [lowUserId, highUserId].filter(Boolean)
  if (dealerIds.length) {
    const ownOrders = await db.query.orders.findMany({
      where: inArray(schema.orders.dealerId, dealerIds),
    })
    const orderIds = ownOrders.map((o) => o.id)
    if (orderIds.length) {
      await db.delete(schema.orderItems).where(inArray(schema.orderItems.orderId, orderIds))
      await db.delete(schema.orders).where(inArray(schema.orders.id, orderIds))
    }
  }
  if (userIds.length) {
    await db.delete(schema.sessions).where(inArray(schema.sessions.userId, userIds))
    await db.delete(schema.auditLog).where(inArray(schema.auditLog.userId, userIds))
    await db.delete(schema.users).where(inArray(schema.users.id, userIds))
  }
  if (dealerIds.length) {
    await db.delete(schema.dealers).where(inArray(schema.dealers.id, dealerIds))
  }
  await cleanupLedgerAbove(ledgerMark)
  await stopServer()
})

describe('Tiered pricing + VAT (computed server-side)', () => {
  it('applies grade-A 10% discount and 7% VAT', async () => {
    const sales = await loginAs('sales@demo.co') // DLR0001, grade A
    const oil = await part('MIT-OF-001') // price 350
    const r = await sales.post<{
      money: { subtotal: number; discount: number; vat: number; total: number }
      poNumber: string
      invoiceNo: string
    }>('/api/orders', { vin: INSTALLED_VIN, items: [{ partId: oil.id, qty: 2 }] })

    expect(r.status).toBe(200)
    // subtotal 700, discount 10% = 70, net 630, vat 7% = round(44.1)=44, total 674
    expect(r.body.money).toEqual({ subtotal: 700, discount: 70, vat: 44, total: 674 })
    expect(r.body.invoiceNo).toMatch(/^INV-2026-\d{6}$/)

    const row = await db.query.orders.findFirst({
      where: eq(schema.orders.poNumber, r.body.poNumber),
    })
    expect(row!.subtotal).toBe(700)
    expect(row!.discount).toBe(70)
    expect(row!.vat).toBe(44)
    expect(row!.totalValue).toBe(674)
    expect(row!.invoiceNo).toBe(r.body.invoiceNo)
  })
})

describe('Credit-limit enforcement', () => {
  it('rejects an order that exceeds remaining credit (409)', async () => {
    const c = await loginAs(lowUserEmail) // creditLimit 5000
    const headlight = await part('MIT-HL-006') // price 8900 → total > 5000
    const r = await c.post('/api/orders', {
      vin: INSTALLED_VIN,
      items: [{ partId: headlight.id, qty: 1 }],
    })
    expect(r.status).toBe(409)
    // nothing was charged
    expect(await creditUsed(lowDealerId)).toBe(0)
  })
})

describe('Stock guard', () => {
  it('rejects an oversell (qty > total on-hand) with 409', async () => {
    const c = await loginAs(highUserEmail) // huge credit so stock trips first
    const brake = await part('MIT-BP-004')
    const have = await totalOnHand(brake.id)
    const r = await c.post('/api/orders', {
      vin: INSTALLED_VIN,
      items: [{ partId: brake.id, qty: have + 5 }],
    })
    expect(r.status).toBe(409)
    // stock untouched
    expect(await totalOnHand(brake.id)).toBe(have)
  })
})

describe('Order create decrements stock + charges credit; cancel restores both', () => {
  it('round-trips stock and credit through create → cancel', async () => {
    const c: Client = await loginAs(highUserEmail)
    const oil = await part('MIT-OF-001')

    const stockBefore = await totalOnHand(oil.id)
    const creditBefore = await creditUsed(highDealerId)

    const created = await c.post<{ order: { id: number; totalValue: number } }>('/api/orders', {
      vin: INSTALLED_VIN,
      items: [{ partId: oil.id, qty: 3 }],
    })
    expect(created.status).toBe(200)
    const orderId = created.body.order.id
    const charged = created.body.order.totalValue

    // create side effects
    expect(await totalOnHand(oil.id)).toBe(stockBefore - 3)
    expect(await creditUsed(highDealerId)).toBe(creditBefore + charged)

    // cancel restores both
    const cancelled = await c.post<{ order: { status: string } }>(`/api/orders/${orderId}/cancel`)
    expect(cancelled.status).toBe(200)
    expect(cancelled.body.order.status).toBe('cancelled')
    expect(await totalOnHand(oil.id)).toBe(stockBefore)
    expect(await creditUsed(highDealerId)).toBe(creditBefore)

    // audit row written
    const audit = await db.query.auditLog.findFirst({
      where: and(
        eq(schema.auditLog.action, 'order.cancel'),
        eq(schema.auditLog.entityId, String(orderId)),
      ),
    })
    expect(audit).toBeTruthy()
  })

  it('cannot cancel another dealer’s order (403)', async () => {
    const c = await loginAs(highUserEmail)
    // find a seeded order that belongs to DLR0001 (not our test dealer)
    const foreign = await db.query.orders.findFirst({
      where: eq(schema.orders.dealerId, 1),
    })
    const r = await c.post(`/api/orders/${foreign!.id}/cancel`)
    expect(r.status).toBe(403)
  })
})
