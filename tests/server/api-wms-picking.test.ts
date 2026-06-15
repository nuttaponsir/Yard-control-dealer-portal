// Phase 3 — WMS pick workflow + OMS/WMS adapter mode switch (key integration).
// ----------------------------------------------------------------------------
// Drives a real order through the fulfillment workflow and asserts the WMS
// adapter behaves per the runtime `wms_mode`:
//   INTERNAL (default): advancing an order →packing auto-generates a pick task
//     (wms_auto_pick='true'). We assert the task appears, generate is
//     idempotent, the detail enriches lines (partSku + locationCode), and the
//     assign→complete lifecycle (assigned → picked, lines pickedQty==qty, then
//     assign-after-picked → 409).
//   EXTERNAL: flipping wms_mode='external' makes →packing dispatch externally —
//     NO pick task is created and an 'external_dispatch' ledger row is written
//     with refId == the order's poNumber.
//   owner (dealer-scoped) is forbidden (403) on the pick-task API.
//
// Placing real orders charges DLR0001 credit, decrements inventory, and writes
// 'issue' ledger rows; advancing creates pick tasks / external_dispatch rows.
// afterAll deletes ALL of that (children first) and hard-restores dealer
// creditUsed, the part's inventory qtyOnHand, and wms_mode/wms_auto_pick so the
// shared DB (incl. the creditUsed <= creditLimit invariant) is left as seeded.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { and, eq, inArray } from 'drizzle-orm'
import { startServer, stopServer, loginAs, Client } from './harness'
import { db, schema } from '../../server/db'

const INSTALLED_VIN = 'MMTJNKB40NH000001'

interface PickTask {
  id: number
  pickNumber: string
  orderId: number
  status: string
}
interface PickTaskRow extends PickTask {
  poNumber: string
  itemCount: number
}
interface PickTaskItemRow {
  id: number
  partId: number
  qty: number
  pickedQty: number
  status: string
  partSku: string
  locationCode: string | null
}
interface PickTaskDetail {
  pickTask: PickTask
  items: PickTaskItemRow[]
}

let admin: Client
let owner: Client // DLR0001
let warehouse: Client
let partId = 0
let dlrId = 0

// Captured for exact restore (the seed invariant asserts creditUsed <= limit).
let origCreditUsed = 0
const origStock = new Map<number, number>() // inventoryRowId → qtyOnHand

// Everything we create, for ordered teardown.
const createdOrderIds: number[] = []
const createdPoNumbers: string[] = []

async function setWmsMode(value: 'internal' | 'external') {
  await db.update(schema.appConfig).set({ value }).where(eq(schema.appConfig.key, 'wms_mode'))
}

/** Place a real order as owner (DLR0001); track it for teardown. */
async function placeOrder() {
  const r = await owner.post<{ ok: boolean; order: { id: number }; poNumber: string }>('/api/orders', {
    vin: INSTALLED_VIN,
    items: [{ partId, qty: 1 }],
  })
  expect(r.status).toBe(200)
  createdOrderIds.push(r.body.order.id)
  createdPoNumbers.push(r.body.poNumber)
  return { id: r.body.order.id, poNumber: r.body.poNumber }
}

/** Advance an order one step via the warehouse PATCH. */
async function advance(orderId: number, status: string) {
  const r = await warehouse.patch(`/api/warehouse/${orderId}`, { status })
  expect(r.status).toBe(200)
}

beforeAll(async () => {
  await startServer()
  admin = await loginAs('admin@demo.co')
  warehouse = await loginAs('warehouse@demo.co')
  owner = await loginAs('owner@demo.co') // DLR0001

  const dealers = await admin.get<{ dealers: { id: number; code: string }[] }>('/api/dealers')
  dlrId = dealers.body.dealers.find((d) => d.code === 'DLR0001')!.id

  const part = await db.query.parts.findFirst({ where: eq(schema.parts.sku, 'MIT-OF-001') })
  partId = part!.id

  // Snapshot DLR0001 credit + every inventory row for this part for exact restore.
  const dealer = await db.query.dealers.findFirst({ where: eq(schema.dealers.id, dlrId) })
  origCreditUsed = dealer!.creditUsed
  const invRows = await db.query.inventory.findMany({ where: eq(schema.inventory.partId, partId) })
  for (const r of invRows) origStock.set(r.id, r.qtyOnHand)

  // Ensure a known starting mode (default is internal/auto-pick).
  await setWmsMode('internal')
})

afterAll(async () => {
  // Teardown order matters: pick_task_items → pick_tasks → order_items →
  // stock_movements → orders, then restore credit / inventory / config.
  if (createdOrderIds.length) {
    const tasks = await db.query.pickTasks.findMany({
      where: inArray(schema.pickTasks.orderId, createdOrderIds),
    })
    const taskIds = tasks.map((t) => t.id)
    if (taskIds.length) {
      await db
        .delete(schema.pickTaskItems)
        .where(inArray(schema.pickTaskItems.pickTaskId, taskIds))
      await db.delete(schema.pickTasks).where(inArray(schema.pickTasks.id, taskIds))
    }
    await db.delete(schema.orderItems).where(inArray(schema.orderItems.orderId, createdOrderIds))
  }
  // Stock movements reference orders only via refId text (no FK): delete the
  // 'issue' rows from our orders + the 'external_dispatch' rows by poNumber.
  if (createdPoNumbers.length) {
    await db
      .delete(schema.stockMovements)
      .where(inArray(schema.stockMovements.refId, createdPoNumbers))
  }
  if (createdOrderIds.length) {
    await db.delete(schema.orders).where(inArray(schema.orders.id, createdOrderIds))
  }
  // Restore dealer credit + part inventory + WMS config to seeded values.
  await db
    .update(schema.dealers)
    .set({ creditUsed: origCreditUsed })
    .where(eq(schema.dealers.id, dlrId))
  for (const [id, qty] of origStock) {
    await db.update(schema.inventory).set({ qtyOnHand: qty }).where(eq(schema.inventory.id, id))
  }
  await db.update(schema.appConfig).set({ value: 'internal' }).where(eq(schema.appConfig.key, 'wms_mode'))
  await db.update(schema.appConfig).set({ value: 'true' }).where(eq(schema.appConfig.key, 'wms_auto_pick'))
  await stopServer()
})

describe('INTERNAL mode — auto pick on →packing', () => {
  let orderId = 0
  let poNumber = ''
  let pickTaskId = 0

  it('places an order and advances pending→confirming→packing', async () => {
    const o = await placeOrder()
    orderId = o.id
    poNumber = o.poNumber
    await advance(orderId, 'confirming')
    await advance(orderId, 'packing')
  })

  it('auto-generated a pick task for the order (open, itemCount 1)', async () => {
    const r = await warehouse.get<{ pickTasks: PickTaskRow[] }>('/api/wms/pick-tasks')
    expect(r.status).toBe(200)
    const task = r.body.pickTasks.find((t) => t.poNumber === poNumber)
    expect(task).toBeTruthy()
    expect(task!.status).toBe('open')
    expect(task!.itemCount).toBe(1)
    pickTaskId = task!.id
  })

  it('generate is idempotent — POST returns created:false and the same task id', async () => {
    const r = await warehouse.post<{ ok: boolean; pickTask: PickTask; created: boolean }>(
      '/api/wms/pick-tasks',
      { orderId },
    )
    expect(r.status).toBe(200)
    expect(r.body.created).toBe(false)
    expect(r.body.pickTask.id).toBe(pickTaskId)
  })

  it('detail enriches lines with partSku + locationCode', async () => {
    const r = await warehouse.get<PickTaskDetail>(`/api/wms/pick-tasks/${pickTaskId}`)
    expect(r.status).toBe(200)
    expect(r.body.items).toHaveLength(1)
    const line = r.body.items[0]!
    expect(line.partSku).toBe('MIT-OF-001')
    // A bin is seeded for every warehouse, so a code is suggested.
    expect(line.locationCode).toBeTruthy()
  })

  it('assign (empty body → self) sets status assigned', async () => {
    const r = await warehouse.post<{ ok: boolean; pickTask: PickTask }>(
      `/api/wms/pick-tasks/${pickTaskId}/assign`,
    )
    expect(r.status).toBe(200)
    expect(r.body.pickTask.status).toBe('assigned')
  })

  it('complete sets status picked; lines show pickedQty==qty and status picked', async () => {
    const r = await warehouse.post<{ ok: boolean; pickTask: PickTask }>(
      `/api/wms/pick-tasks/${pickTaskId}/complete`,
    )
    expect(r.status).toBe(200)
    expect(r.body.pickTask.status).toBe('picked')

    const detail = await warehouse.get<PickTaskDetail>(`/api/wms/pick-tasks/${pickTaskId}`)
    for (const line of detail.body.items) {
      expect(line.status).toBe('picked')
      expect(line.pickedQty).toBe(line.qty)
    }
  })

  it('assign after picked → 409 (terminal)', async () => {
    const r = await warehouse.post(`/api/wms/pick-tasks/${pickTaskId}/assign`)
    expect(r.status).toBe(409)
  })
})

describe('EXTERNAL mode — dispatch, no pick task', () => {
  it('→packing creates NO pick task and writes an external_dispatch ledger row', async () => {
    await setWmsMode('external')
    const { id, poNumber } = await placeOrder()
    await advance(id, 'confirming')
    await advance(id, 'packing')

    // No pick task for this order.
    const tasks = await db.query.pickTasks.findMany({ where: eq(schema.pickTasks.orderId, id) })
    expect(tasks).toHaveLength(0)

    // An external_dispatch movement exists with refId == poNumber.
    const dispatch = await db.query.stockMovements.findFirst({
      where: and(
        eq(schema.stockMovements.kind, 'external_dispatch'),
        eq(schema.stockMovements.refId, poNumber),
      ),
    })
    expect(dispatch).toBeTruthy()
    expect(dispatch!.refType).toBe('external')
  })
})

describe('Dealer-scoped role is forbidden', () => {
  it('owner cannot list pick tasks (403)', async () => {
    const r = await owner.get('/api/wms/pick-tasks')
    expect(r.status).toBe(403)
  })

  it('owner cannot assign a pick task (403)', async () => {
    // Use any existing task id; the role check happens before the lookup.
    const r = await owner.post('/api/wms/pick-tasks/1/assign')
    expect(r.status).toBe(403)
  })
})
