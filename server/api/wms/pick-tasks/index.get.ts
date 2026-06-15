// GET /api/wms/pick-tasks — Phase 3 (WMS). List pick tasks for warehouse ops.
// admin/warehouse only. Optional ?status= filter. Newest first. Each row is
// enriched with the source order's poNumber (resolved once via inArray into a
// Map) and an item count.
import { desc, eq, inArray } from 'drizzle-orm'
import { db, schema } from '../../../db'
import { requireUser } from '../../../utils/auth'
import type { PickTask, PickTaskStatus } from '../../../../app/types'

export interface PickTaskRow extends PickTask {
  poNumber: string
  itemCount: number
}

const STATUSES: PickTaskStatus[] = ['open', 'assigned', 'picking', 'picked', 'cancelled']

export default defineEventHandler(async (event): Promise<{ pickTasks: PickTaskRow[] }> => {
  await requireUser(event, ['admin', 'warehouse'])

  const status = getQuery(event).status as string | undefined
  const tasks = await db.query.pickTasks.findMany({
    where: status && STATUSES.includes(status as PickTaskStatus)
      ? eq(schema.pickTasks.status, status)
      : undefined,
    orderBy: [desc(schema.pickTasks.id)],
  })

  // Resolve poNumbers for the referenced orders in a single query.
  const orderIds = [...new Set(tasks.map((t) => t.orderId))]
  const orders = orderIds.length
    ? await db.query.orders.findMany({ where: inArray(schema.orders.id, orderIds) })
    : []
  const poByOrderId = new Map(orders.map((o) => [o.id, o.poNumber]))

  // Item counts, grouped by pick task.
  const taskIds = tasks.map((t) => t.id)
  const items = taskIds.length
    ? await db.query.pickTaskItems.findMany({ where: inArray(schema.pickTaskItems.pickTaskId, taskIds) })
    : []
  const countByTaskId = new Map<number, number>()
  for (const it of items) {
    countByTaskId.set(it.pickTaskId, (countByTaskId.get(it.pickTaskId) ?? 0) + 1)
  }

  const pickTasks: PickTaskRow[] = tasks.map((t) => ({
    ...(t as PickTask),
    poNumber: poByOrderId.get(t.orderId) ?? String(t.orderId),
    itemCount: countByTaskId.get(t.id) ?? 0,
  }))

  return { pickTasks }
})
