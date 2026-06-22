// Phase L — configurable credit enforcement (appConfig: credit_enforcement).
// ----------------------------------------------------------------------------
// The order-placement credit guard must honour the runtime policy:
//   block → reject when projected use exceeds the (over-)limit ceiling (409)
//   off   → skip the check entirely (200)
//   warn  → allow the order but flag it (200 + creditWarn: true)
// We drive this against a dedicated dealer (DLR0002) whose credit limit is
// forced to 0, so any positive order is "over limit", and toggle the policy
// through the appConfig row the handler reads. Restores the default at the end.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { eq } from 'drizzle-orm'
import { startServer, stopServer, loginAs, Client } from './harness'
import { db, schema } from '../../server/db'

const INSTALLED_VIN = 'MMTJNKB40NH000001'

let ownerB: Client
let partId = 0
let dlrB = 0
// Captured so the suite leaves DLR0002 exactly as it was seeded (the
// dashboard-seed invariant asserts creditUsed <= creditLimit for every dealer).
let origLimit = 0
let origUsed = 0

async function setPolicy(value: 'block' | 'warn' | 'off') {
  await db
    .update(schema.appConfig)
    .set({ value })
    .where(eq(schema.appConfig.key, 'credit_enforcement'))
}

beforeAll(async () => {
  await startServer()
  const admin = await loginAs('admin@demo.co')

  const dealers = await admin.get<{ dealers: { id: number; code: string }[] }>('/api/dealers')
  dlrB = dealers.body.dealers.find((d) => d.code === 'DLR0002')!.id

  // Capture original credit state, then force a zero limit so every order is
  // "over limit". Restored in afterAll.
  const before = await db.query.dealers.findFirst({ where: eq(schema.dealers.id, dlrB) })
  origLimit = before!.creditLimit
  origUsed = before!.creditUsed
  await db
    .update(schema.dealers)
    .set({ creditLimit: 0, creditUsed: 0 })
    .where(eq(schema.dealers.id, dlrB))

  // A stocked part to order.
  const part = await db.query.parts.findFirst({ where: eq(schema.parts.sku, 'MIT-OF-001') })
  partId = part!.id

  const email = `credit-owner-${Date.now()}@demo.co`
  await admin.post('/api/users', {
    email,
    password: 'demo1234',
    role: 'owner',
    dealerId: dlrB,
  })
  ownerB = await loginAs(email)
})

// Orders successfully placed (off/warn modes) — cleaned up in afterAll so the
// shared DB (and its stock-movement ledger) is left exactly as seeded.
const createdOrders: { id: number; po: string }[] = []

afterAll(async () => {
  await setPolicy('block') // restore default for other suites
  // Remove the orders (+ their items + ledger rows) this suite created.
  for (const o of createdOrders) {
    await db.delete(schema.stockMovements).where(eq(schema.stockMovements.refId, o.po))
    await db.delete(schema.orderItems).where(eq(schema.orderItems.orderId, o.id))
    await db.delete(schema.orders).where(eq(schema.orders.id, o.id))
  }
  // Restore DLR0002's credit so the seed invariant (used <= limit) holds again.
  await db
    .update(schema.dealers)
    .set({ creditLimit: origLimit, creditUsed: origUsed })
    .where(eq(schema.dealers.id, dlrB))
  await stopServer()
})

async function placeOrder() {
  const r = await ownerB.post<{ ok: boolean; creditWarn?: boolean; order?: { id: number }; poNumber?: string }>(
    '/api/orders',
    { vin: INSTALLED_VIN, items: [{ partId, qty: 1 }] },
  )
  if (r.body?.order?.id && r.body.poNumber) {
    createdOrders.push({ id: r.body.order.id, po: r.body.poNumber })
  }
  return r
}

describe('credit_enforcement = block', () => {
  it('rejects an over-limit order with 409', async () => {
    await setPolicy('block')
    const r = await placeOrder()
    expect(r.status).toBe(409)
  })
})

describe('credit_enforcement = off', () => {
  it('allows the order despite being over limit', async () => {
    await setPolicy('off')
    const r = await placeOrder()
    expect(r.status).toBe(200)
    expect(r.body.creditWarn).toBeFalsy()
  })
})

describe('credit_enforcement = warn', () => {
  it('allows the order but flags it as a credit risk', async () => {
    await setPolicy('warn')
    const r = await placeOrder()
    expect(r.status).toBe(200)
    expect(r.body.creditWarn).toBe(true)
  })
})
