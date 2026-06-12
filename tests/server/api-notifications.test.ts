// Phase E — Integrations & Notifications tests.
//   1. A domain event (claim.submitted) fans out in-app + email notifications to
//      the filing dealer's users and to admins; the inbox is user-scoped with an
//      accurate unread count; mark-read (single + all) works; a user cannot read
//      another user's notification.
//   2. Scheduled jobs (admin-triggered) compute their summary and emit an
//      admin-facing notification; non-admins are forbidden; unknown jobs 404.
//   3. Carrier tracking returns a timeline for a shipped/delivered order, an
//      empty pending result, and is dealer-scoped (403 on a foreign order).
// Isolated test dealer/users/orders are created and torn down so the rest of the
// suite's seed-integrity counts stay exact.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { startServer, stopServer, loginAs } from './harness'
import { db, schema } from '../../server/db'
import { and, eq, gte, inArray } from 'drizzle-orm'

const TEST_VIN = 'MMTJNKB40NH000099'

let dealerId = 0
let ownerId = 0
let salesId = 0
let ownerEmail = ''
let salesEmail = ''
let oilPartId = 0
let oilPrice = 0
let testStart = ''

let deliveredOrderId = 0
let pendingOrderId = 0
let foreignOrderId = 0

let claimNumber = ''

const CREDIT_START = 50_000

async function insertOrder(po: string, status: string, qty: number, withTracking: boolean) {
  const subtotal = oilPrice * qty
  const vat = Math.round((subtotal * 7) / 100)
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
      totalValue: subtotal + vat,
      invoiceNo: null,
      trackingNo: withTracking ? 'TH99000099' : null,
      carrier: withTracking ? 'Flash' : null,
      createdAt: new Date().toISOString(),
    })
    .returning()
  await db.insert(schema.orderItems).values({ orderId: order!.id, partId: oilPartId, qty, unitPrice: oilPrice })
  return order!.id
}

beforeAll(async () => {
  await startServer()
  testStart = new Date().toISOString()

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
      code: `TNOT${stamp}`,
      name: 'ดีลเลอร์ทดสอบแจ้งเตือน',
      province: 'กรุงเทพ',
      phone: '02-000-0003',
      grade: 'C',
      creditLimit: 100_000_000,
      creditUsed: CREDIT_START,
      createdAt: now,
    })
    .returning()
  dealerId = dealer!.id

  ownerEmail = `notif-owner-${stamp}@demo.co`
  salesEmail = `notif-sales-${stamp}@demo.co`
  const [owner] = await db
    .insert(schema.users)
    .values({ email: ownerEmail, passwordHash: hash, role: 'owner', dealerId, createdAt: now })
    .returning()
  ownerId = owner!.id
  const [sales] = await db
    .insert(schema.users)
    .values({ email: salesEmail, passwordHash: hash, role: 'sales', dealerId, createdAt: now })
    .returning()
  salesId = sales!.id

  deliveredOrderId = await insertOrder(`PO-NOT-${stamp}-1`, 'delivered', 2, true)
  pendingOrderId = await insertOrder(`PO-NOT-${stamp}-2`, 'pending', 1, false)
  const foreign = await db.query.orders.findFirst({ where: eq(schema.orders.dealerId, 1) })
  foreignOrderId = foreign!.id
})

afterAll(async () => {
  // notifications addressed to our users or dealer, plus admin system rows from this run
  await db
    .delete(schema.notifications)
    .where(inArray(schema.notifications.userId, [ownerId, salesId]))
  await db.delete(schema.notifications).where(eq(schema.notifications.dealerId, dealerId))
  await db
    .delete(schema.notifications)
    .where(and(eq(schema.notifications.entity, 'system'), gte(schema.notifications.createdAt, testStart)))

  if (claimNumber) {
    await db.delete(schema.claims).where(eq(schema.claims.claimNumber, claimNumber))
    await db
      .delete(schema.auditLog)
      .where(and(eq(schema.auditLog.entity, 'claim'), eq(schema.auditLog.entityId, claimNumber)))
  }
  // job-run audit rows from this run
  await db
    .delete(schema.auditLog)
    .where(and(eq(schema.auditLog.action, 'job.run'), gte(schema.auditLog.createdAt, testStart)))

  const ourOrders = await db.query.orders.findMany({ where: eq(schema.orders.dealerId, dealerId) })
  const orderIds = ourOrders.map((o) => o.id)
  if (orderIds.length) {
    await db.delete(schema.orderItems).where(inArray(schema.orderItems.orderId, orderIds))
    await db.delete(schema.orders).where(inArray(schema.orders.id, orderIds))
  }
  await db.delete(schema.sessions).where(inArray(schema.sessions.userId, [ownerId, salesId]))
  await db.delete(schema.auditLog).where(inArray(schema.auditLog.userId, [ownerId, salesId]))
  await db.delete(schema.users).where(inArray(schema.users.id, [ownerId, salesId]))
  await db.delete(schema.dealers).where(eq(schema.dealers.id, dealerId))
  await stopServer()
})

describe('Notification fan-out + inbox', () => {
  it('a filed claim notifies the dealer users in-app and writes an email outbox row', async () => {
    const owner = await loginAs(ownerEmail)
    const r = await owner.post<{ ok: boolean; claim: { claimNumber: string } }>('/api/claims', {
      vin: TEST_VIN,
      partSku: 'MIT-OF-001',
      reason: 'อะไหล่ชำรุดจากการขนส่ง',
    })
    expect(r.status).toBe(200)
    claimNumber = r.body.claim.claimNumber

    // owner's in-app inbox now carries the claim notification
    const inbox = await owner.get<{ notifications: { event: string; entityId: string }[]; unread: number }>(
      '/api/notifications',
    )
    expect(inbox.status).toBe(200)
    expect(inbox.body.unread).toBeGreaterThanOrEqual(1)
    const mine = inbox.body.notifications.find((n) => n.entityId === claimNumber)
    expect(mine?.event).toBe('claim.submitted')

    // the email outbox row exists for this event
    const emailRows = await db.query.notifications.findMany({
      where: and(
        eq(schema.notifications.channel, 'email'),
        eq(schema.notifications.entityId, claimNumber),
      ),
    })
    expect(emailRows.length).toBeGreaterThan(0)
    expect(emailRows.every((e) => e.status === 'sent')).toBe(true)
  })

  it('the sales user of the same dealer also receives the notification', async () => {
    const sales = await loginAs(salesEmail)
    const inbox = await sales.get<{ notifications: { entityId: string }[] }>('/api/notifications')
    expect(inbox.status).toBe(200)
    expect(inbox.body.notifications.some((n) => n.entityId === claimNumber)).toBe(true)
  })

  it('a user cannot mark another user\'s notification read (404)', async () => {
    // a notification row that belongs to the sales user
    const salesRow = await db.query.notifications.findFirst({
      where: and(
        eq(schema.notifications.userId, salesId),
        eq(schema.notifications.channel, 'inapp'),
      ),
    })
    const owner = await loginAs(ownerEmail)
    const r = await owner.post(`/api/notifications/${salesRow!.id}/read`)
    expect(r.status).toBe(404)
  })

  it('mark-one then read-all clears the unread count', async () => {
    const owner = await loginAs(ownerEmail)
    const before = await owner.get<{ notifications: { id: number }[]; unread: number }>('/api/notifications')
    expect(before.body.unread).toBeGreaterThanOrEqual(1)

    const one = await owner.post(`/api/notifications/${before.body.notifications[0]!.id}/read`)
    expect(one.status).toBe(200)

    const all = await owner.post<{ updated: number }>('/api/notifications/read-all')
    expect(all.status).toBe(200)

    const after = await owner.get<{ unread: number }>('/api/notifications')
    expect(after.body.unread).toBe(0)
  })
})

describe('Scheduled jobs (admin-triggered)', () => {
  it('daily-summary returns a rollup and notifies admins', async () => {
    const admin = await loginAs('admin@demo.co')
    const r = await admin.post<{ job: string; result: { orders: number; claims: number; sales: number } }>(
      '/api/jobs/daily-summary/run',
    )
    expect(r.status).toBe(200)
    expect(r.body.job).toBe('daily-summary')
    expect(typeof r.body.result.sales).toBe('number')

    const inbox = await admin.get<{ notifications: { event: string }[] }>('/api/notifications')
    expect(inbox.body.notifications.some((n) => n.event === 'summary.daily')).toBe(true)
  })

  it('low-stock and credit-risk run and report counts', async () => {
    const admin = await loginAs('admin@demo.co')
    const low = await admin.post<{ result: { count: number } }>('/api/jobs/low-stock/run')
    expect(low.status).toBe(200)
    expect(typeof low.body.result.count).toBe('number')

    const risk = await admin.post<{ result: { threshold: number; count: number } }>('/api/jobs/credit-risk/run')
    expect(risk.status).toBe(200)
    expect(risk.body.result.threshold).toBe(80)
  })

  it('a non-admin cannot trigger a job (403)', async () => {
    const owner = await loginAs(ownerEmail)
    const r = await owner.post('/api/jobs/daily-summary/run')
    expect(r.status).toBe(403)
  })

  it('an unknown job name is a 404', async () => {
    const admin = await loginAs('admin@demo.co')
    const r = await admin.post('/api/jobs/does-not-exist/run')
    expect(r.status).toBe(404)
  })
})

describe('Carrier tracking', () => {
  it('a delivered order returns the full timeline', async () => {
    const owner = await loginAs(ownerEmail)
    const r = await owner.get<{ status: string; trackingNo: string; events: unknown[] }>(
      `/api/orders/${deliveredOrderId}/tracking`,
    )
    expect(r.status).toBe(200)
    expect(r.body.status).toBe('delivered')
    expect(r.body.trackingNo).toBe('TH99000099')
    expect(r.body.events.length).toBe(4)
  })

  it('a not-yet-shipped order has no tracking', async () => {
    const owner = await loginAs(ownerEmail)
    const r = await owner.get<{ status: string; events: unknown[] }>(`/api/orders/${pendingOrderId}/tracking`)
    expect(r.status).toBe(200)
    expect(r.body.status).toBe('pending')
    expect(r.body.events.length).toBe(0)
  })

  it("a dealer cannot track another dealer's order (403)", async () => {
    const owner = await loginAs(ownerEmail)
    const r = await owner.get(`/api/orders/${foreignOrderId}/tracking`)
    expect(r.status).toBe(403)
  })
})
