// Phase C (deferred) — RMA / returns workflow tests.
//   1. A dealer files a return against its own DELIVERED order; refund is
//      computed server-side from the order's effective discount/VAT.
//   2. Returns are rejected for non-delivered orders, foreign orders, and
//      over-quantity requests.
//   3. Admin approve restocks the goods + releases the dealer's credit; reject
//      is a pure state change. Non-admins cannot decide.
//   4. GET /api/returns is dealer-scoped.
// Isolated test dealer/user/orders are created and torn down so seed-integrity
// counts stay exact.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { Client } from './harness';
import { startServer, stopServer, loginAs } from './harness'
import { db, schema } from '../../server/db'
import { and, eq, inArray } from 'drizzle-orm'
import { ledgerHighWater, cleanupLedgerAbove } from './ledger'

let ledgerMark = 0

const TEST_VIN = 'MMTJNKB40NH000001'

let dealerId = 0
let userId = 0
let userEmail = ''
let oilPartId = 0
let oilPrice = 0

// orders created for the various scenarios
let deliveredOrderId = 0 // primary happy-path order (4× oil)
let pendingOrderId = 0 // non-delivered → cannot return
let rejectOrderId = 0 // for the reject scenario

// captured during the create test, consumed by the approve test
let approveReturnId = 0
let approveRefund = 0

const CREDIT_START = 100_000

async function totalOnHand(partId: number): Promise<number> {
  const rows = await db.query.inventory.findMany({ where: eq(schema.inventory.partId, partId) })
  return rows.reduce((s, r) => s + r.qtyOnHand, 0)
}
async function creditUsed(id: number): Promise<number> {
  const d = await db.query.dealers.findFirst({ where: eq(schema.dealers.id, id) })
  return d!.creditUsed
}

async function insertOrder(po: string, status: string, qty: number) {
  // grade-C dealer → 0% discount; VAT 7% on the subtotal.
  const subtotal = oilPrice * qty
  const vat = Math.round((subtotal * 7) / 100)
  const total = subtotal + vat
  const [order] = await db
    .insert(schema.orders)
    .values({
      poNumber: po,
      dealerId,
      vin: TEST_VIN,
      status,
      subtotal,
      discount: 0,
      vat,
      totalValue: total,
      invoiceNo: null,
      trackingNo: null,
      carrier: null,
      createdAt: new Date().toISOString(),
    })
    .returning()
  await db.insert(schema.orderItems).values({
    orderId: order!.id,
    partId: oilPartId,
    qty,
    unitPrice: oilPrice,
  })
  return order!.id
}

beforeAll(async () => {
  await startServer()
  ledgerMark = await ledgerHighWater()
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
      code: `TRMA${stamp}`,
      name: 'ดีลเลอร์ทดสอบ RMA',
      province: 'กรุงเทพ',
      phone: '02-000-0002',
      grade: 'C',
      creditLimit: 100_000_000,
      creditUsed: CREDIT_START,
      createdAt: now,
    })
    .returning()
  dealerId = dealer!.id

  userEmail = `rma-${stamp}@demo.co`
  const [u] = await db
    .insert(schema.users)
    .values({ email: userEmail, passwordHash: hash, role: 'sales', dealerId, createdAt: now })
    .returning()
  userId = u!.id

  deliveredOrderId = await insertOrder(`PO-RMA-${stamp}-1`, 'delivered', 4)
  pendingOrderId = await insertOrder(`PO-RMA-${stamp}-2`, 'pending', 2)
  rejectOrderId = await insertOrder(`PO-RMA-${stamp}-3`, 'delivered', 3)
})

afterAll(async () => {
  // returns + their items + scoped audit rows
  const ourReturns = await db.query.returns.findMany({ where: eq(schema.returns.dealerId, dealerId) })
  const retIds = ourReturns.map((r) => r.id)
  const rmaNos = ourReturns.map((r) => r.rmaNumber)
  if (retIds.length) {
    await db.delete(schema.returnItems).where(inArray(schema.returnItems.returnId, retIds))
    await db.delete(schema.returns).where(inArray(schema.returns.id, retIds))
  }
  if (rmaNos.length) {
    await db
      .delete(schema.auditLog)
      .where(and(eq(schema.auditLog.entity, 'return'), inArray(schema.auditLog.entityId, rmaNos)))
  }
  // orders + items
  const ourOrders = await db.query.orders.findMany({ where: eq(schema.orders.dealerId, dealerId) })
  const orderIds = ourOrders.map((o) => o.id)
  if (orderIds.length) {
    await db.delete(schema.orderItems).where(inArray(schema.orderItems.orderId, orderIds))
    await db.delete(schema.orders).where(inArray(schema.orders.id, orderIds))
  }
  // user + dealer
  await db.delete(schema.sessions).where(eq(schema.sessions.userId, userId))
  await db.delete(schema.auditLog).where(eq(schema.auditLog.userId, userId))
  await db.delete(schema.users).where(eq(schema.users.id, userId))
  await db.delete(schema.dealers).where(eq(schema.dealers.id, dealerId))
  await cleanupLedgerAbove(ledgerMark)
  await stopServer()
})

describe('Return request (dealer files an RMA)', () => {
  it('creates a return for a delivered order with a server-computed refund', async () => {
    const c: Client = await loginAs(userEmail)
    const r = await c.post<{ rmaNumber: string; refundAmount: number; return: { id: number; status: string } }>(
      '/api/returns',
      { orderId: deliveredOrderId, reason: 'อะไหล่ชำรุด', items: [{ partId: oilPartId, qty: 2 }] },
    )
    expect(r.status).toBe(200)
    expect(r.body.rmaNumber).toMatch(/^RMA-\d{4}-\d{4}$/)
    expect(r.body.return.status).toBe('requested')

    // refund: subtotal 2×350=700, 0% discount, 7% VAT = round(49) → total 749
    expect(r.body.refundAmount).toBe(749)

    approveReturnId = r.body.return.id
    approveRefund = r.body.refundAmount
  })

  it('rejects a return against a non-delivered order (409)', async () => {
    const c = await loginAs(userEmail)
    const r = await c.post('/api/returns', {
      orderId: pendingOrderId,
      reason: 'x',
      items: [{ partId: oilPartId, qty: 1 }],
    })
    expect(r.status).toBe(409)
  })

  it('rejects returning more than was ordered (409)', async () => {
    const c = await loginAs(userEmail)
    const r = await c.post('/api/returns', {
      orderId: rejectOrderId, // ordered 3
      reason: 'x',
      items: [{ partId: oilPartId, qty: 99 }],
    })
    expect(r.status).toBe(409)
  })

  it("cannot return another dealer's order (403)", async () => {
    const c = await loginAs(userEmail)
    const foreign = await db.query.orders.findFirst({ where: eq(schema.orders.dealerId, 1) })
    const r = await c.post('/api/returns', {
      orderId: foreign!.id,
      reason: 'x',
      items: [{ partId: oilPartId, qty: 1 }],
    })
    expect(r.status).toBe(403)
  })
})

describe('Admin decision (approve restocks + releases credit; reject does not)', () => {
  it('approve adds stock back and releases the dealer credit', async () => {
    const stockBefore = await totalOnHand(oilPartId)
    const creditBefore = await creditUsed(dealerId)

    const admin = await loginAs('admin@demo.co')
    const r = await admin.post<{ return: { status: string } }>(
      `/api/returns/${approveReturnId}/decision`,
      { decision: 'approve' },
    )
    expect(r.status).toBe(200)
    expect(r.body.return.status).toBe('approved')

    // 2 oil units restocked, credit released by the refund amount
    expect(await totalOnHand(oilPartId)).toBe(stockBefore + 2)
    expect(await creditUsed(dealerId)).toBe(creditBefore - approveRefund)

    const audit = await db.query.auditLog.findFirst({
      where: and(eq(schema.auditLog.action, 'return.approve')),
    })
    expect(audit).toBeTruthy()
  })

  it('deciding an already-decided return is a 409', async () => {
    const admin = await loginAs('admin@demo.co')
    const r = await admin.post(`/api/returns/${approveReturnId}/decision`, { decision: 'reject' })
    expect(r.status).toBe(409)
  })

  it('reject is a pure state change (no stock/credit movement)', async () => {
    // file a fresh return on the reject order
    const dealer = await loginAs(userEmail)
    const made = await dealer.post<{ return: { id: number } }>('/api/returns', {
      orderId: rejectOrderId,
      reason: 'ส่งผิดรุ่น',
      items: [{ partId: oilPartId, qty: 1 }],
    })
    expect(made.status).toBe(200)
    const rid = made.body.return.id

    const stockBefore = await totalOnHand(oilPartId)
    const creditBefore = await creditUsed(dealerId)

    const admin = await loginAs('admin@demo.co')
    const r = await admin.post<{ return: { status: string } }>(`/api/returns/${rid}/decision`, {
      decision: 'reject',
    })
    expect(r.status).toBe(200)
    expect(r.body.return.status).toBe('rejected')
    expect(await totalOnHand(oilPartId)).toBe(stockBefore)
    expect(await creditUsed(dealerId)).toBe(creditBefore)
  })

  it('a non-admin cannot decide a return (403)', async () => {
    const dealer = await loginAs(userEmail)
    const made = await dealer.post<{ return: { id: number } }>('/api/returns', {
      orderId: deliveredOrderId,
      reason: 'อีกครั้ง',
      items: [{ partId: oilPartId, qty: 1 }],
    })
    const rid = made.body.return.id
    const r = await dealer.post(`/api/returns/${rid}/decision`, { decision: 'approve' })
    expect(r.status).toBe(403)
  })
})

describe('GET /api/returns scoping', () => {
  it('a dealer sees only its own returns', async () => {
    const c = await loginAs(userEmail)
    const r = await c.get<{ returns: { dealerId: number }[] }>('/api/returns')
    expect(r.status).toBe(200)
    expect(r.body.returns.length).toBeGreaterThan(0)
    for (const row of r.body.returns) expect(row.dealerId).toBe(dealerId)
  })
})
