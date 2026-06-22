// Phase 5 — Procurement: create + receive a purchase order.
// ----------------------------------------------------------------------------
// Creating a PO (admin/warehouse only) and receiving it bumps the destination
// warehouse's inventory.qtyOnHand and posts a 'receipt' stock_movement
// (refType 'purchase', refId poNumber). The suite captures the part's on-hand
// at คลังกรุงเทพ before receiving and restores it in afterAll, then deletes
// every row it created (stock_movements by refId, purchase_order_items by
// purchaseOrderId, purchase_orders by id). The seed PO PO-IN-2026-000001 is
// left intact. owner is forbidden (admin/warehouse only).
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { and, eq, inArray } from 'drizzle-orm'
import { startServer, stopServer, loginAs, Client } from './harness'
import { db, schema } from '../../server/db'

const WAREHOUSE = 'คลังกรุงเทพ'

interface PurchaseOrder {
  id: number
  poNumber: string
  status: string
}
interface PoDetailItem {
  id: number
  partId: number
  qtyOrdered: number
  qtyReceived: number
}

let admin: Client
let owner: Client // DLR0001
let supplierId = 0
let partId = 0

// Capture for exact restore (inventory row at the destination warehouse).
let origInventoryId: number | null = null
let origQtyOnHand: number | null = null

// Track everything created.
const createdPoIds: number[] = []
const createdPoNumbers: string[] = []

beforeAll(async () => {
  await startServer()
  admin = await loginAs('admin@demo.co')
  owner = await loginAs('owner@demo.co') // DLR0001

  const supplier = await db.query.suppliers.findFirst()
  supplierId = supplier!.id

  const part = await db.query.parts.findFirst({ where: eq(schema.parts.sku, 'MIT-OF-001') })
  partId = part!.id

  // Snapshot the destination inventory row (may not exist yet).
  const inv = await db.query.inventory.findFirst({
    where: and(eq(schema.inventory.partId, partId), eq(schema.inventory.warehouse, WAREHOUSE)),
  })
  if (inv) {
    origInventoryId = inv.id
    origQtyOnHand = inv.qtyOnHand
  }
})

afterAll(async () => {
  // Delete in child→parent order. Movements first (text refId, no FK).
  if (createdPoNumbers.length) {
    await db
      .delete(schema.stockMovements)
      .where(inArray(schema.stockMovements.refId, createdPoNumbers))
  }
  if (createdPoIds.length) {
    await db
      .delete(schema.purchaseOrderItems)
      .where(inArray(schema.purchaseOrderItems.purchaseOrderId, createdPoIds))
    await db.delete(schema.purchaseOrders).where(inArray(schema.purchaseOrders.id, createdPoIds))
  }
  // Restore the destination inventory on-hand to the seeded value.
  if (origInventoryId != null && origQtyOnHand != null) {
    await db
      .update(schema.inventory)
      .set({ qtyOnHand: origQtyOnHand })
      .where(eq(schema.inventory.id, origInventoryId))
  }
  await stopServer()
})

describe('POST /api/procurement (create)', () => {
  it('admin creates a PO → 200, status ordered', async () => {
    const r = await admin.post<{ ok: boolean; purchaseOrder: PurchaseOrder }>('/api/procurement', {
      supplierId,
      warehouse: WAREHOUSE,
      items: [{ partId, qtyOrdered: 5, unitCost: 100 }],
    })
    expect(r.status).toBe(200)
    expect(r.body.purchaseOrder.status).toBe('ordered')
    createdPoIds.push(r.body.purchaseOrder.id)
    createdPoNumbers.push(r.body.purchaseOrder.poNumber)
  })

  it('owner (dealer-scoped) cannot list procurement (403)', async () => {
    const r = await owner.get('/api/procurement')
    expect(r.status).toBe(403)
  })
})

describe('POST /api/procurement/:id/receive (receive all)', () => {
  it('receives all 5 → inventory +5, status received, item.qtyReceived 5, receipt movement', async () => {
    const poId = createdPoIds[0]!
    const poNumber = createdPoNumbers[0]!

    // Capture qtyOnHand BEFORE receiving (0 if no inventory row existed).
    const before = await db.query.inventory.findFirst({
      where: and(eq(schema.inventory.partId, partId), eq(schema.inventory.warehouse, WAREHOUSE)),
    })
    const qtyBefore = before?.qtyOnHand ?? 0

    // Empty object body = receive all remaining (no `lines`); an undefined
    // body fails the zod object parse, so send {}.
    const r = await admin.post<{ ok: boolean; purchaseOrder: PurchaseOrder }>(
      `/api/procurement/${poId}/receive`,
      {},
    )
    expect(r.status).toBe(200)
    expect(r.body.purchaseOrder.status).toBe('received')

    // Inventory increased by 5.
    const after = await db.query.inventory.findFirst({
      where: and(eq(schema.inventory.partId, partId), eq(schema.inventory.warehouse, WAREHOUSE)),
    })
    expect(after).toBeTruthy()
    expect(after!.qtyOnHand).toBe(qtyBefore + 5)
    // If the row was created by the receipt, capture it for restore.
    if (origInventoryId == null) {
      origInventoryId = after!.id
      origQtyOnHand = 0
    }

    // PO line fully received.
    const detail = await admin.get<{ items: PoDetailItem[] }>(`/api/procurement/${poId}`)
    expect(detail.status).toBe(200)
    const line = detail.body.items.find((i) => i.partId === partId)!
    expect(line.qtyReceived).toBe(5)

    // A 'receipt' stock_movement exists (refType 'purchase', refId poNumber).
    const mv = await db.query.stockMovements.findFirst({
      where: and(
        eq(schema.stockMovements.kind, 'receipt'),
        eq(schema.stockMovements.refType, 'purchase'),
        eq(schema.stockMovements.refId, poNumber),
      ),
    })
    expect(mv).toBeTruthy()
    expect(mv!.qty).toBe(5)
  })
})
