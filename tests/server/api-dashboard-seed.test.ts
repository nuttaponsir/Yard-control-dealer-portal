// Test1 (QA backend) — Dashboard low-stock + seed integrity + cross-cutting.
// Covers AC-7.1 (low-stock set == rows where qtyOnHand < reorderPoint),
// AC-10.1 (100 dealers), AC-10.2 (4 demo users + roles/dealer wiring),
// AC-10.5 / AC-9.4 (creditUsed <= creditLimit), AC-11.1 (orders -> installed VIN).
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { startServer, stopServer, loginAs } from './harness'
import { db, schema } from '../../server/db'
import { eq, lt, like, inArray } from 'drizzle-orm'

beforeAll(async () => {
  await startServer()
})
afterAll(async () => {
  await stopServer()
})

describe('Low-stock (AC-7.1)', () => {
  it('dashboard low-stock set equals exactly the inventory rows where qtyOnHand < reorderPoint', async () => {
    const admin = await loginAs('admin@demo.co')
    const r = await admin.get<{ lowStock: { sku: string; qtyOnHand: number; reorderPoint: number }[] }>(
      '/api/dashboard',
    )
    expect(r.status).toBe(200)

    // ground truth from the DB
    const expected = await db
      .select({
        sku: schema.parts.sku,
        qtyOnHand: schema.inventory.qtyOnHand,
        reorderPoint: schema.inventory.reorderPoint,
      })
      .from(schema.inventory)
      .innerJoin(schema.parts, eq(schema.inventory.partId, schema.parts.id))
      .where(lt(schema.inventory.qtyOnHand, schema.inventory.reorderPoint))

    expect(r.body.lowStock.length).toBe(expected.length)
    // every returned row genuinely satisfies the predicate
    for (const row of r.body.lowStock) {
      expect(row.qtyOnHand).toBeLessThan(row.reorderPoint)
    }
    expect(r.body.lowStock.length).toBeGreaterThan(0) // seed guarantees non-empty
  })

  it('credit panel is present for sales and hidden for admin', async () => {
    const sales = await loginAs('sales@demo.co')
    const salesDash = await sales.get<{ credit: unknown | null }>('/api/dashboard')
    expect(salesDash.body.credit).not.toBeNull()

    const admin = await loginAs('admin@demo.co')
    const adminDash = await admin.get<{ credit: unknown | null }>('/api/dashboard')
    expect(adminDash.body.credit).toBeNull()
  })
})

describe('Seed integrity (AC-10.x)', () => {
  it('exactly 100 seeded dealers exist (code DLR####)', async () => {
    // Scope to seed-identifiable dealers so concurrent integration tests that
    // create their own operational dealers don't perturb the integrity count.
    const dealers = await db.query.dealers.findMany({ where: like(schema.dealers.code, 'DLR%') })
    expect(dealers.length).toBe(100)
  })

  it('the 4 demo users exist with correct roles & dealer wiring', async () => {
    const demoEmails = ['admin@demo.co', 'owner@demo.co', 'sales@demo.co', 'warehouse@demo.co']
    const users = await db.query.users.findMany({ where: inArray(schema.users.email, demoEmails) })
    const byEmail = new Map(users.map((u) => [u.email, u]))
    expect(users.length).toBe(4)
    expect(byEmail.get('admin@demo.co')?.role).toBe('admin')
    expect(byEmail.get('admin@demo.co')?.dealerId).toBeNull()
    expect(byEmail.get('owner@demo.co')?.role).toBe('owner')
    expect(byEmail.get('owner@demo.co')?.dealerId).not.toBeNull()
    expect(byEmail.get('sales@demo.co')?.role).toBe('sales')
    expect(byEmail.get('sales@demo.co')?.dealerId).not.toBeNull()
    expect(byEmail.get('warehouse@demo.co')?.role).toBe('warehouse')
  })

  it('every dealer satisfies creditUsed <= creditLimit (AC-10.5 / AC-9.4)', async () => {
    const dealers = await db.query.dealers.findMany()
    const violations = dealers.filter((d) => d.creditUsed > d.creditLimit)
    expect(violations).toEqual([])
  })
})

describe('Cross-cutting integrity (AC-11.1)', () => {
  it('every order references a valid dealer and an Autologic-installed VIN', async () => {
    const orders = await db.query.orders.findMany()
    const dealers = await db.query.dealers.findMany()
    const vins = await db.query.vins.findMany()
    const dealerIds = new Set(dealers.map((d) => d.id))
    const installedVins = new Set(vins.filter((v) => v.autologicInstalled).map((v) => v.vin))

    const badDealer = orders.filter((o) => !dealerIds.has(o.dealerId))
    expect(badDealer).toEqual([])

    const badVin = orders.filter((o) => o.vin != null && !installedVins.has(o.vin))
    expect(badVin.map((o) => ({ po: o.poNumber, vin: o.vin }))).toEqual([])
  })
})
