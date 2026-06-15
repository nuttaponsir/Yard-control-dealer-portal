// ============================================================================
// Phase 3 — internal pick-task engine (SA-owned shared helper).
// ----------------------------------------------------------------------------
// Generates a pick task (+ one item per order line) for an order, suggesting a
// storage bin per line. Reused by the internal WMS adapter (auto-generate on
// →packing) and the pick-task API (manual generate). Idempotent: an order that
// already has a live (non-cancelled) pick task returns that task unchanged.
// Pick tasks are a WORKFLOW overlay — they do not move stock (the order already
// issued stock at placement); completing one records operational sign-off.
// ============================================================================
import { and, desc, eq, inArray, ne } from 'drizzle-orm'
import { db, schema } from '../../db'
import { writeAudit } from '../audit'

function pad(n: number, len: number) {
  return String(n).padStart(len, '0')
}

/** Next PICK-2026-###### sequence, continuing past any seeded rows. */
async function genPickNumber(): Promise<string> {
  const rows = await db.query.pickTasks.findMany()
  const maxSeq = rows.reduce((max, t) => {
    const m = /^PICK-\d{4}-(\d{6})$/.exec(t.pickNumber)
    return m ? Math.max(max, Number(m[1])) : max
  }, 0)
  return `PICK-2026-${pad(maxSeq + 1, 6)}`
}

/**
 * Choose the warehouse to fulfil an order from: the one holding stock for the
 * most of the order's parts (ties → most total on-hand). Falls back to the
 * first warehouse master, then to the first inventory warehouse seen.
 */
async function resolveWarehouse(partIds: number[]): Promise<string> {
  if (partIds.length) {
    const rows = await db.query.inventory.findMany({
      where: inArray(schema.inventory.partId, partIds),
    })
    const score = new Map<string, { parts: Set<number>; qty: number }>()
    for (const r of rows) {
      const s = score.get(r.warehouse) ?? { parts: new Set<number>(), qty: 0 }
      s.parts.add(r.partId)
      s.qty += r.qtyOnHand
      score.set(r.warehouse, s)
    }
    let best: string | null = null
    let bestKey = [-1, -1]
    for (const [wh, s] of score) {
      const key = [s.parts.size, s.qty]
      if (key[0]! > bestKey[0]! || (key[0] === bestKey[0] && key[1]! > bestKey[1]!)) {
        best = wh
        bestKey = key
      }
    }
    if (best) return best
  }
  const wh = await db.query.warehouses.findFirst()
  return wh?.name ?? 'คลังกรุงเทพ'
}

/** Suggest an active bin in the given warehouse (or null when none exist). */
async function suggestLocation(warehouse: string): Promise<number | null> {
  const loc = await db.query.storageLocations.findFirst({
    where: and(eq(schema.storageLocations.warehouse, warehouse), eq(schema.storageLocations.active, true)),
  })
  return loc?.id ?? null
}

export interface GeneratePickResult {
  pickTask: typeof schema.pickTasks.$inferSelect
  created: boolean
}

/**
 * Create (or return the existing live) pick task for an order. `actorId` is
 * recorded on the audit row. Throws 404 when the order does not exist.
 */
export async function generatePickForOrder(
  orderId: number,
  actorId?: number | null,
): Promise<GeneratePickResult> {
  const order = await db.query.orders.findFirst({ where: eq(schema.orders.id, orderId) })
  if (!order) {
    throw createError({ statusCode: 404, statusMessage: 'ไม่พบคำสั่งซื้อ' })
  }

  // Idempotent: reuse a live pick task if one already exists.
  const existing = await db.query.pickTasks.findFirst({
    where: and(eq(schema.pickTasks.orderId, orderId), ne(schema.pickTasks.status, 'cancelled')),
    orderBy: [desc(schema.pickTasks.id)],
  })
  if (existing) return { pickTask: existing, created: false }

  const items = await db.query.orderItems.findMany({
    where: eq(schema.orderItems.orderId, orderId),
  })
  const warehouse = await resolveWarehouse(items.map((i) => i.partId))
  const locationId = await suggestLocation(warehouse)
  const pickNumber = await genPickNumber()
  const now = new Date().toISOString()

  const pickTask = await db.transaction(async (tx) => {
    const [task] = await tx
      .insert(schema.pickTasks)
      .values({ pickNumber, orderId, warehouse, status: 'open', assignedTo: null, createdAt: now, updatedAt: null })
      .returning()
    if (items.length) {
      await tx.insert(schema.pickTaskItems).values(
        items.map((it) => ({
          pickTaskId: task!.id,
          partId: it.partId,
          qty: it.qty,
          locationId,
          pickedQty: 0,
          status: 'pending' as const,
        })),
      )
    }
    return task!
  })

  await writeAudit(actorId ?? null, 'pick.generate', 'pick_task', pickNumber, `order=${order.poNumber}`)
  return { pickTask, created: true }
}
