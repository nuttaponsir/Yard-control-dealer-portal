// GET /api/wms/pick-tasks/:id — Phase 3 (WMS). Pick-task detail + its lines.
// admin/warehouse only. 404 when missing. Each line is enriched with the part's
// sku/name and the suggested storage-location code, resolved via Maps.
import { eq, inArray } from 'drizzle-orm'
import { db, schema } from '../../../db'
import { requireUser } from '../../../utils/auth'
import type { PickTask, PickTaskItem } from '../../../../app/types'

export interface PickTaskItemRow extends PickTaskItem {
  partSku: string
  partName: string
  locationCode: string | null
}

export interface PickTaskDetail {
  pickTask: PickTask
  order: { poNumber: string; status: string }
  items: PickTaskItemRow[]
}

export default defineEventHandler(async (event): Promise<PickTaskDetail> => {
  await requireUser(event, ['admin', 'warehouse'])

  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'รหัสใบจัดไม่ถูกต้อง' })
  }

  const task = await db.query.pickTasks.findFirst({ where: eq(schema.pickTasks.id, id) })
  if (!task) {
    throw createError({ statusCode: 404, statusMessage: 'ไม่พบใบจัดสินค้า' })
  }

  const order = await db.query.orders.findFirst({ where: eq(schema.orders.id, task.orderId) })

  const lines = await db.query.pickTaskItems.findMany({
    where: eq(schema.pickTaskItems.pickTaskId, id),
  })

  const partIds = [...new Set(lines.map((l) => l.partId))]
  const parts = partIds.length
    ? await db.query.parts.findMany({ where: inArray(schema.parts.id, partIds) })
    : []
  const partById = new Map(parts.map((p) => [p.id, p]))

  const locIds = [...new Set(lines.map((l) => l.locationId).filter((x): x is number => x != null))]
  const locs = locIds.length
    ? await db.query.storageLocations.findMany({ where: inArray(schema.storageLocations.id, locIds) })
    : []
  const locById = new Map(locs.map((l) => [l.id, l]))

  const items: PickTaskItemRow[] = lines.map((l) => {
    const part = partById.get(l.partId)
    return {
      ...(l as PickTaskItem),
      partSku: part?.sku ?? String(l.partId),
      partName: part?.name ?? '',
      locationCode: l.locationId != null ? (locById.get(l.locationId)?.code ?? null) : null,
    }
  })

  return {
    pickTask: task as PickTask,
    order: { poNumber: order?.poNumber ?? String(task.orderId), status: order?.status ?? '' },
    items,
  }
})
