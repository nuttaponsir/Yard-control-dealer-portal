// Phase G-1 — Payments / Accounts-Receivable tests.
//   1. Posting a payment releases the dealer's credit and (when applied to an
//      order) advances that order's amountPaid + paymentStatus.
//   2. Over-payment beyond an order's outstanding balance is rejected (409).
//   3. On-account payments (no orderId) release credit without touching orders.
//   4. RBAC: admin + owner may post; sales may not; owner is scoped to its dealer.
//   5. GET /api/payments is dealer-scoped; AR-aging is admin-only.
// Isolated test dealer/users/orders are created and torn down so seed-integrity
// counts stay exact.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { Client } from './harness'
import { startServer, stopServer, loginAs } from './harness'
import { db, schema } from '../../server/db'
import { and, eq, inArray } from 'drizzle-orm'

const TEST_VIN = 'MMTJNKB40NH000001'
const CREDIT_START = 100_000

let dealerId = 0
let ownerEmail = ''
let ownerId = 0
let oilPartId = 0
let oilPrice = 0

let orderId = 0
let orderTotal = 0

async function creditUsed(id: number): Promise<number> {
  const d = await db.query.dealers.findFirst({ where: eq(schema.dealers.id, id) })
  return d!.creditUsed
}
async function orderPaid(id: number): Promise<{ amountPaid: number; paymentStatus: string }> {
  const o = await db.query.orders.findFirst({ where: eq(schema.orders.id, id) })
  return { amountPaid: o!.amountPaid, paymentStatus: o!.paymentStatus }
}

beforeAll(async () => {
  await startServer()
  const admin = await db.query.users.findFirst({ where: eq(schema.users.email, 'admin@demo.co') })
  const hash = admin!.passwordHash
  const now = new Date().toISOString()
  const stamp = Date.now() % 1000000

  const oil = await db.query.parts.findFirst({ where: eq(schema.parts.sku, 'MIT-OF-001') })
  oilPartId = oil!.id
  oilPrice = oil!.price

  const [dealer] = await db
    .insert(schema.dealers)
    .values({
      code: `TPAY${stamp}`,
      name: 'ดีลเลอร์ทดสอบชำระเงิน',
      province: 'กรุงเทพ',
      phone: '02-000-0003',
      grade: 'C',
      creditLimit: 100_000_000,
      creditUsed: CREDIT_START,
      createdAt: now,
    })
    .returning()
  dealerId = dealer!.id

  ownerEmail = `pay-${stamp}@demo.co`
  const [u] = await db
    .insert(schema.users)
    .values({ email: ownerEmail, passwordHash: hash, role: 'owner', dealerId, active: true, createdAt: now })
    .returning()
  ownerId = u!.id

  // One delivered order, grade-C (0% discount), VAT 7%.
  const subtotal = oilPrice * 4
  const vat = Math.round((subtotal * 7) / 100)
  orderTotal = subtotal + vat
  const [order] = await db
    .insert(schema.orders)
    .values({
      poNumber: `PO-PAY-${stamp}-1`,
      dealerId,
      vin: TEST_VIN,
      status: 'delivered',
      subtotal,
      discount: 0,
      vat,
      totalValue: orderTotal,
      createdAt: now,
    })
    .returning()
  orderId = order!.id
  await db.insert(schema.orderItems).values({ orderId, partId: oilPartId, qty: 4, unitPrice: oilPrice })
})

afterAll(async () => {
  const ourPayments = await db.query.payments.findMany({ where: eq(schema.payments.dealerId, dealerId) })
  const rcpNos = ourPayments.map((p) => p.receiptNo)
  await db.delete(schema.payments).where(eq(schema.payments.dealerId, dealerId))
  if (rcpNos.length) {
    await db
      .delete(schema.auditLog)
      .where(and(eq(schema.auditLog.entity, 'payment'), inArray(schema.auditLog.entityId, rcpNos)))
  }
  const ourOrders = await db.query.orders.findMany({ where: eq(schema.orders.dealerId, dealerId) })
  const orderIds = ourOrders.map((o) => o.id)
  if (orderIds.length) {
    await db.delete(schema.orderItems).where(inArray(schema.orderItems.orderId, orderIds))
    await db.delete(schema.orders).where(inArray(schema.orders.id, orderIds))
  }
  await db.delete(schema.sessions).where(eq(schema.sessions.userId, ownerId))
  await db.delete(schema.auditLog).where(eq(schema.auditLog.userId, ownerId))
  await db.delete(schema.users).where(eq(schema.users.id, ownerId))
  await db.delete(schema.dealers).where(eq(schema.dealers.id, dealerId))
  await stopServer()
})

describe('POST /api/payments — record + release credit', () => {
  it('a partial payment releases credit and marks the order partial', async () => {
    const creditBefore = await creditUsed(dealerId)
    const c: Client = await loginAs(ownerEmail)
    const r = await c.post<{ receiptNo: string; payment: { amount: number } }>('/api/payments', {
      dealerId,
      orderId,
      amount: 100,
      method: 'transfer',
      reference: 'TRX-1',
    })
    expect(r.status).toBe(200)
    expect(r.body.receiptNo).toMatch(/^RCP-\d{4}-\d{6}$/)

    expect(await creditUsed(dealerId)).toBe(creditBefore - 100)
    const paid = await orderPaid(orderId)
    expect(paid.amountPaid).toBe(100)
    expect(paid.paymentStatus).toBe('partial')

    const audit = await db.query.auditLog.findFirst({ where: eq(schema.auditLog.action, 'payment.create') })
    expect(audit).toBeTruthy()
  })

  it('paying the remaining balance marks the order paid', async () => {
    const creditBefore = await creditUsed(dealerId)
    const c = await loginAs(ownerEmail)
    const remaining = orderTotal - 100
    const r = await c.post('/api/payments', { dealerId, orderId, amount: remaining, method: 'cash' })
    expect(r.status).toBe(200)

    expect(await creditUsed(dealerId)).toBe(creditBefore - remaining)
    const paid = await orderPaid(orderId)
    expect(paid.amountPaid).toBe(orderTotal)
    expect(paid.paymentStatus).toBe('paid')
  })

  it('rejects a payment that exceeds the order outstanding balance (409)', async () => {
    const c = await loginAs(ownerEmail)
    const r = await c.post('/api/payments', { dealerId, orderId, amount: 1, method: 'transfer' })
    expect(r.status).toBe(409)
  })

  it('an on-account payment (no order) still releases credit', async () => {
    const creditBefore = await creditUsed(dealerId)
    const c = await loginAs(ownerEmail)
    const r = await c.post('/api/payments', { dealerId, amount: 250, method: 'transfer' })
    expect(r.status).toBe(200)
    expect(await creditUsed(dealerId)).toBe(creditBefore - 250)
  })

  it('never drives creditUsed below zero', async () => {
    const c = await loginAs(ownerEmail)
    const r = await c.post('/api/payments', { dealerId, amount: 10_000_000, method: 'transfer' })
    expect(r.status).toBe(200)
    expect(await creditUsed(dealerId)).toBe(0)
  })
})

describe('POST /api/payments — RBAC + scoping', () => {
  it('a sales user cannot post a payment (403)', async () => {
    const c = await loginAs('sales@demo.co')
    const r = await c.post('/api/payments', { dealerId, amount: 100, method: 'cash' })
    expect(r.status).toBe(403)
  })

  it('an owner cannot post a payment for another dealer (403)', async () => {
    const c = await loginAs(ownerEmail)
    const r = await c.post('/api/payments', { dealerId: 1, amount: 100, method: 'cash' })
    expect(r.status).toBe(403)
  })

  it('rejects an order that belongs to a different dealer (409)', async () => {
    const c = await loginAs('admin@demo.co')
    const foreign = await db.query.orders.findFirst({ where: eq(schema.orders.dealerId, 1) })
    const r = await c.post('/api/payments', {
      dealerId,
      orderId: foreign!.id,
      amount: 100,
      method: 'cash',
    })
    expect(r.status).toBe(409)
  })
})

describe('GET /api/payments + AR aging', () => {
  it('a dealer sees only its own payments', async () => {
    const c = await loginAs(ownerEmail)
    const r = await c.get<{ payments: { dealerId: number }[] }>('/api/payments')
    expect(r.status).toBe(200)
    expect(r.body.payments.length).toBeGreaterThan(0)
    for (const row of r.body.payments) expect(row.dealerId).toBe(dealerId)
  })

  it('AR-aging is admin-only and returns bucketed totals', async () => {
    const dealer = await loginAs(ownerEmail)
    expect((await dealer.get('/api/reports/ar-aging')).status).toBe(403)

    const admin = await loginAs('admin@demo.co')
    const r = await admin.get<{ rows: unknown[]; totals: Record<string, number> }>('/api/reports/ar-aging')
    expect(r.status).toBe(200)
    expect(r.body.totals).toHaveProperty('all')
    expect(Array.isArray(r.body.rows)).toBe(true)
  })
})
