// Phase 5 — Warranty registrations (per VIN + part).
// ----------------------------------------------------------------------------
// owner/sales register for their own dealer (dealerId forced from the session,
// body ignored); admin may void (admin-only). expiresAt = startDate + months.
// GET is dealer-scoped for owner/sales. The suite tracks every warranty id it
// creates and deletes them in afterAll, leaving the 2 seed warranties
// (WAR-2026-000001/000002) intact. No inventory/credit is touched.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { eq, inArray, gt } from 'drizzle-orm'
import { startServer, stopServer, loginAs, Client } from './harness'
import { db, schema } from '../../server/db'
import { ledgerHighWater, cleanupLedgerAbove } from './ledger'

const INSTALLED_VIN = 'MMTJNKB40NH000001'
const PART_SKU = 'MIT-OF-001'

interface Warranty {
  id: number
  warrantyNo: string
  vin: string
  dealerId: number | null
  expiresAt: string
  status: string
}

let admin: Client
let owner: Client // DLR0001
let ownerDealerId = 0
let partId = 0

const createdWarrantyIds: number[] = []
// Auto-register-on-delivery test mutates an order + its side effects; captured
// here so afterAll restores the shared DB exactly.
let ledgerMark = 0
let warrantyMark = 0
let origCreditUsed = 0
const origStock = new Map<number, number>()
let autoOrderId = 0

beforeAll(async () => {
  await startServer()
  admin = await loginAs('admin@demo.co')
  owner = await loginAs('owner@demo.co') // DLR0001

  const dealers = await admin.get<{ dealers: { id: number; code: string }[] }>('/api/dealers')
  ownerDealerId = dealers.body.dealers.find((d) => d.code === 'DLR0001')!.id

  const part = await db.query.parts.findFirst({ where: eq(schema.parts.sku, PART_SKU) })
  partId = part!.id

  // Snapshots for the auto-register order flow (restored in afterAll).
  ledgerMark = await ledgerHighWater()
  const warMax = await db.query.warranties.findMany({ columns: { id: true } })
  warrantyMark = warMax.reduce((m, w) => Math.max(m, w.id), 0)
  const dealer = await db.query.dealers.findFirst({ where: eq(schema.dealers.id, ownerDealerId) })
  origCreditUsed = dealer!.creditUsed
  const inv = await db.query.inventory.findMany({ where: eq(schema.inventory.partId, partId) })
  for (const r of inv) origStock.set(r.id, r.qtyOnHand)
})

afterAll(async () => {
  // Auto-register order chain: pick tasks → order items → order; auto + manual
  // warranties; ledger rows; then restore credit + inventory.
  if (autoOrderId) {
    const picks = await db.query.pickTasks.findMany({ where: eq(schema.pickTasks.orderId, autoOrderId) })
    const pickIds = picks.map((p) => p.id)
    if (pickIds.length) {
      await db.delete(schema.pickTaskItems).where(inArray(schema.pickTaskItems.pickTaskId, pickIds))
      await db.delete(schema.pickTasks).where(inArray(schema.pickTasks.id, pickIds))
    }
    await db.delete(schema.orderItems).where(eq(schema.orderItems.orderId, autoOrderId))
    await db.delete(schema.orders).where(eq(schema.orders.id, autoOrderId))
  }
  // Delete auto-created warranties (id above the captured mark) + tracked manual ones.
  await db.delete(schema.warranties).where(gt(schema.warranties.id, warrantyMark))
  if (createdWarrantyIds.length) {
    await db.delete(schema.warranties).where(inArray(schema.warranties.id, createdWarrantyIds))
  }
  await cleanupLedgerAbove(ledgerMark)
  // Restore credit + inventory.
  await db.update(schema.dealers).set({ creditUsed: origCreditUsed }).where(eq(schema.dealers.id, ownerDealerId))
  for (const [id, qty] of origStock) {
    await db.update(schema.inventory).set({ qtyOnHand: qty }).where(eq(schema.inventory.id, id))
  }
  await stopServer()
})

describe('POST /api/warranty (register)', () => {
  it('owner registers → dealerId forced to own dealer; expiresAt = start + 12 months', async () => {
    const r = await owner.post<{ ok: boolean; warranty: Warranty }>('/api/warranty', {
      vin: INSTALLED_VIN,
      partSku: PART_SKU,
      startDate: '2026-01-15',
      months: 12,
      dealerId: 999999, // attempt to target another dealer — must be ignored
    })
    expect(r.status).toBe(200)
    expect(r.body.warranty.dealerId).toBe(ownerDealerId)
    expect(r.body.warranty.expiresAt).toBe('2027-01-15')
    expect(r.body.warranty.status).toBe('active')
    createdWarrantyIds.push(r.body.warranty.id)
  })

  it('invalid VIN (not in registry) → 400', async () => {
    const r = await owner.post('/api/warranty', {
      vin: 'ZZZZZZZZZZZZZZZZZ', // 17 chars, not in vins
      partSku: PART_SKU,
      startDate: '2026-01-15',
      months: 12,
    })
    expect(r.status).toBe(400)
  })
})

describe('GET /api/warranty (dealer-scoped)', () => {
  it('owner sees only own-dealer rows', async () => {
    const r = await owner.get<{ warranties: Warranty[] }>('/api/warranty')
    expect(r.status).toBe(200)
    expect(r.body.warranties.length).toBeGreaterThan(0)
    for (const w of r.body.warranties) expect(w.dealerId).toBe(ownerDealerId)
  })
})

describe('POST /api/warranty/:id/void', () => {
  let targetId = 0

  it('seed a void target as owner', async () => {
    const r = await owner.post<{ ok: boolean; warranty: Warranty }>('/api/warranty', {
      vin: INSTALLED_VIN,
      partSku: PART_SKU,
      startDate: '2026-02-01',
      months: 6,
    })
    expect(r.status).toBe(200)
    targetId = r.body.warranty.id
    createdWarrantyIds.push(targetId)
  })

  it('owner cannot void (403, admin-only)', async () => {
    const r = await owner.post(`/api/warranty/${targetId}/void`)
    expect(r.status).toBe(403)
  })

  it('admin voids → 200, status void', async () => {
    const r = await admin.post<{ ok: boolean; warranty: Warranty }>(`/api/warranty/${targetId}/void`)
    expect(r.status).toBe(200)
    expect(r.body.warranty.status).toBe('void')
  })
})

describe('auto-register warranty on delivery (#7)', () => {
  it('advancing an order to delivered creates a warranty for its part', async () => {
    // owner places an order for an installed VIN; we use a unique VIN with no
    // prior active warranty for PART_SKU so the auto-register isn't deduped.
    const ORDER_VIN = 'MMTJNKB40NH000002'
    const placed = await owner.post<{ ok: boolean; order: { id: number }; poNumber: string }>('/api/orders', {
      vin: ORDER_VIN,
      items: [{ partId, qty: 1 }],
    })
    expect(placed.status).toBe(200)
    autoOrderId = placed.body.order.id
    const po = placed.body.poNumber

    // admin walks the order through the pipeline to delivered.
    for (const status of ['confirming', 'packing', 'shipped', 'delivered'] as const) {
      const r = await admin.patch(`/api/warehouse/${autoOrderId}`, { status })
      expect(r.status).toBe(200)
    }

    // A warranty was auto-registered for PART_SKU on this VIN, tied to the PO.
    const wars = await db.query.warranties.findMany({ where: eq(schema.warranties.vin, ORDER_VIN) })
    const auto = wars.find((w) => w.partSku === PART_SKU && (w.note ?? '').includes(po))
    expect(auto).toBeTruthy()
    expect(auto!.status).toBe('active')
    expect(auto!.dealerId).toBe(ownerDealerId)
    const part = await db.query.parts.findFirst({ where: eq(schema.parts.id, partId) })
    expect(auto!.months).toBe(part!.warrantyMonths)
  })
})
