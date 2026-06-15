// Phase 3 — WMS stock-movement ledger + manual adjustment tests.
// ----------------------------------------------------------------------------
// POST /api/wms/movements posts a signed manual adjustment: it mutates
// inventory.qtyOnHand for (partId, warehouse) AND appends a matching 'adjust'
// ledger row, atomically. Covers: +N raises on-hand & shows up in the ledger,
// −N restores it, an over-decrement (huge negative) → 409, an unknown
// (part,warehouse) inventory row → 400, qty 0 → 400, GET kind/warehouse
// filters, and the owner 403. The +N/−N pair nets to zero, but we also delete
// every adjust row we created (by id) and hard-restore qtyOnHand in afterAll so
// the shared DB ledger + on-hand are left exactly as seeded.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { and, eq, inArray } from 'drizzle-orm'
import { startServer, stopServer, loginAs, Client } from './harness'
import { db, schema } from '../../server/db'

const BKK = 'คลังกรุงเทพ'
const N = 5

interface Movement {
  id: number
  partId: number
  warehouse: string
  kind: string
  qty: number
}

let warehouse: Client
let owner: Client
let partId = 0
let invRowId = 0
let origQty = 0

// Track every adjust movement row we create so afterAll keeps the ledger clean.
const createdMovementIds: number[] = []

beforeAll(async () => {
  await startServer()
  warehouse = await loginAs('warehouse@demo.co')
  owner = await loginAs('owner@demo.co') // DLR0001 — forbidden

  const part = await db.query.parts.findFirst({ where: eq(schema.parts.sku, 'MIT-OF-001') })
  partId = part!.id

  // Snapshot the BKK inventory row for an exact restore.
  const inv = await db.query.inventory.findFirst({
    where: and(eq(schema.inventory.partId, partId), eq(schema.inventory.warehouse, BKK)),
  })
  invRowId = inv!.id
  origQty = inv!.qtyOnHand
})

afterAll(async () => {
  // Delete any adjust rows we created, then hard-restore on-hand to seeded value.
  if (createdMovementIds.length) {
    await db
      .delete(schema.stockMovements)
      .where(inArray(schema.stockMovements.id, createdMovementIds))
  }
  await db.update(schema.inventory).set({ qtyOnHand: origQty }).where(eq(schema.inventory.id, invRowId))
  await stopServer()
})

describe('Manual adjust mutates on-hand + ledger', () => {
  it('adjust +N raises qtyOnHand and appends an adjust ledger row', async () => {
    const r = await warehouse.post<{ ok: boolean; movement: Movement }>('/api/wms/movements', {
      partId,
      warehouse: BKK,
      qty: N,
      note: 'test +N',
    })
    expect(r.status).toBe(200)
    expect(r.body.movement.kind).toBe('adjust')
    expect(r.body.movement.qty).toBe(N)
    createdMovementIds.push(r.body.movement.id)

    const inv = await db.query.inventory.findFirst({ where: eq(schema.inventory.id, invRowId) })
    expect(inv!.qtyOnHand).toBe(origQty + N)

    // The new row appears in the ledger filtered by kind=adjust.
    const list = await warehouse.get<{ movements: Movement[] }>('/api/wms/movements?kind=adjust')
    expect(list.status).toBe(200)
    expect(list.body.movements.some((m) => m.id === r.body.movement.id)).toBe(true)
  })

  it('adjust −N restores qtyOnHand back to the seeded value', async () => {
    const r = await warehouse.post<{ ok: boolean; movement: Movement }>('/api/wms/movements', {
      partId,
      warehouse: BKK,
      qty: -N,
      note: 'test -N',
    })
    expect(r.status).toBe(200)
    createdMovementIds.push(r.body.movement.id)

    const inv = await db.query.inventory.findFirst({ where: eq(schema.inventory.id, invRowId) })
    expect(inv!.qtyOnHand).toBe(origQty)
  })
})

describe('Adjust validation', () => {
  it('rejects an over-decrement (on-hand would go negative) → 409', async () => {
    const r = await warehouse.post('/api/wms/movements', {
      partId,
      warehouse: BKK,
      qty: -1_000_000,
    })
    expect(r.status).toBe(409)
  })

  it('rejects an adjustment for a (part,warehouse) with no inventory row → 400', async () => {
    const r = await warehouse.post('/api/wms/movements', {
      partId,
      warehouse: 'คลังที่ไม่มีอยู่จริง',
      qty: 1,
    })
    expect(r.status).toBe(400)
  })

  it('rejects qty 0 → 400', async () => {
    const r = await warehouse.post('/api/wms/movements', { partId, warehouse: BKK, qty: 0 })
    expect(r.status).toBe(400)
  })
})

describe('Ledger filters', () => {
  it('filters by warehouse', async () => {
    const r = await warehouse.get<{ movements: Movement[] }>(
      `/api/wms/movements?warehouse=${encodeURIComponent(BKK)}`,
    )
    expect(r.status).toBe(200)
    for (const m of r.body.movements) expect(m.warehouse).toBe(BKK)
  })

  it('filters by kind', async () => {
    const r = await warehouse.get<{ movements: Movement[] }>('/api/wms/movements?kind=adjust')
    expect(r.status).toBe(200)
    for (const m of r.body.movements) expect(m.kind).toBe('adjust')
  })
})

describe('Dealer-scoped role is forbidden', () => {
  it('owner cannot post an adjustment (403)', async () => {
    const r = await owner.post('/api/wms/movements', { partId, warehouse: BKK, qty: 1 })
    expect(r.status).toBe(403)
  })

  it('owner cannot list the ledger (403)', async () => {
    const r = await owner.get('/api/wms/movements')
    expect(r.status).toBe(403)
  })
})
