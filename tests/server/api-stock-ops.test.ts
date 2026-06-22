// Phase 5 — Stock-ops: warehouse transfers + cycle counts.
// ----------------------------------------------------------------------------
// Transfers move stock at completion (issue −qty at source, receipt +qty at
// destination, both refType 'transfer'); cycle counts reconcile on-hand to the
// counted figure at post time and write a single 'adjust' movement for the
// variance (refType 'count'). Both are warehouse-level (admin/warehouse);
// owner is forbidden. The suite captures every touched inventory.qtyOnHand and
// restores it in afterAll, then deletes the stock_movements (by transferNo /
// countNo), stock_transfers, and cycle_counts it created. Shared DB unchanged.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { and, eq, inArray } from 'drizzle-orm'
import { startServer, stopServer, loginAs, Client } from './harness'
import { db, schema } from '../../server/db'

const FROM_WH = 'คลังกรุงเทพ'
const TO_WH = 'คลังเชียงใหม่'

interface Transfer {
  id: number
  transferNo: string
  status: string
}
interface Count {
  id: number
  countNo: string
  status: string
  systemQty: number
  variance: number
}

let admin: Client
let owner: Client // DLR0001
let partId = 0

// Restore map: inventoryRowId → original qtyOnHand.
const origStock = new Map<number, number>()
async function snapshotInventory() {
  const rows = await db.query.inventory.findMany({ where: eq(schema.inventory.partId, partId) })
  for (const r of rows) if (!origStock.has(r.id)) origStock.set(r.id, r.qtyOnHand)
}
async function onHand(warehouse: string): Promise<number> {
  const inv = await db.query.inventory.findFirst({
    where: and(eq(schema.inventory.partId, partId), eq(schema.inventory.warehouse, warehouse)),
  })
  return inv?.qtyOnHand ?? 0
}

// Track created rows.
const createdTransferIds: number[] = []
const createdCountIds: number[] = []
const createdRefIds: string[] = [] // transferNo + countNo for stock_movements

beforeAll(async () => {
  await startServer()
  admin = await loginAs('admin@demo.co')
  owner = await loginAs('owner@demo.co') // DLR0001

  const part = await db.query.parts.findFirst({ where: eq(schema.parts.sku, 'MIT-OF-001') })
  partId = part!.id

  await snapshotInventory()
})

afterAll(async () => {
  // Movements first (text refId, no FK), then the parent rows.
  if (createdRefIds.length) {
    await db.delete(schema.stockMovements).where(inArray(schema.stockMovements.refId, createdRefIds))
  }
  if (createdTransferIds.length) {
    await db.delete(schema.stockTransfers).where(inArray(schema.stockTransfers.id, createdTransferIds))
  }
  if (createdCountIds.length) {
    await db.delete(schema.cycleCounts).where(inArray(schema.cycleCounts.id, createdCountIds))
  }
  // Restore ALL touched inventory rows to seeded on-hand.
  for (const [id, qty] of origStock) {
    await db.update(schema.inventory).set({ qtyOnHand: qty }).where(eq(schema.inventory.id, id))
  }
  await stopServer()
})

describe('Transfers', () => {
  it('request → complete moves 3 units (from −3, to +3) + two ledger rows', async () => {
    const fromBefore = await onHand(FROM_WH)
    const toBefore = await onHand(TO_WH)

    // Request.
    const req = await admin.post<{ ok: boolean; transfer: Transfer }>('/api/stock-ops/transfers', {
      partId,
      fromWarehouse: FROM_WH,
      toWarehouse: TO_WH,
      qty: 3,
    })
    expect(req.status).toBe(200)
    expect(req.body.transfer.status).toBe('requested')
    const transferId = req.body.transfer.id
    const transferNo = req.body.transfer.transferNo
    createdTransferIds.push(transferId)
    createdRefIds.push(transferNo)

    // Complete.
    const done = await admin.post<{ ok: boolean; transfer: Transfer }>(
      `/api/stock-ops/transfers/${transferId}/complete`,
    )
    expect(done.status).toBe(200)
    expect(done.body.transfer.status).toBe('completed')

    // Re-snapshot in case the destination row was created by the transfer.
    await snapshotInventory()

    expect(await onHand(FROM_WH)).toBe(fromBefore - 3)
    expect(await onHand(TO_WH)).toBe(toBefore + 3)

    // Two transfer movements: issue −3 + receipt +3.
    const moves = await db.query.stockMovements.findMany({
      where: and(
        eq(schema.stockMovements.refType, 'transfer'),
        eq(schema.stockMovements.refId, transferNo),
      ),
    })
    expect(moves).toHaveLength(2)
    const issue = moves.find((m) => m.kind === 'issue')!
    const receipt = moves.find((m) => m.kind === 'receipt')!
    expect(issue.qty).toBe(-3)
    expect(receipt.qty).toBe(3)
  })

  it('owner (dealer-scoped) cannot request a transfer (403)', async () => {
    const r = await owner.post('/api/stock-ops/transfers', {
      partId,
      fromWarehouse: FROM_WH,
      toWarehouse: TO_WH,
      qty: 1,
    })
    expect(r.status).toBe(403)
  })
})

describe('Cycle counts', () => {
  it('open (counted = system+7) then post → on-hand=countedQty + adjust +7 movement', async () => {
    const systemQty = await onHand(FROM_WH)
    const countedQty = systemQty + 7

    // Open the count.
    const open = await admin.post<{ ok: boolean; count: Count }>('/api/stock-ops/counts', {
      partId,
      warehouse: FROM_WH,
      countedQty,
    })
    expect(open.status).toBe(200)
    expect(open.body.count.systemQty).toBe(systemQty)
    expect(open.body.count.variance).toBe(7)
    const countId = open.body.count.id
    const countNo = open.body.count.countNo
    createdCountIds.push(countId)
    createdRefIds.push(countNo)

    // Post the count.
    const post = await admin.post<{ ok: boolean; count: Count }>(
      `/api/stock-ops/counts/${countId}/post`,
    )
    expect(post.status).toBe(200)
    expect(post.body.count.status).toBe('posted')

    // Inventory now equals the counted figure.
    expect(await onHand(FROM_WH)).toBe(countedQty)

    // One 'adjust' movement for the +7 variance (refType 'count').
    const mv = await db.query.stockMovements.findFirst({
      where: and(
        eq(schema.stockMovements.kind, 'adjust'),
        eq(schema.stockMovements.refType, 'count'),
        eq(schema.stockMovements.refId, countNo),
      ),
    })
    expect(mv).toBeTruthy()
    expect(mv!.qty).toBe(7)
  })
})
