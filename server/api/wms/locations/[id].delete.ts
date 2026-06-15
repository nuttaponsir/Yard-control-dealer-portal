// DELETE /api/wms/locations/:id — Phase 3 (WMS). Remove a storage-location bin.
// Warehouse-level; admin/warehouse only. Blocked (409) when the bin is still
// referenced by a stock movement or a pick-task item, so the WMS ledger never
// loses a bin link.
import { eq } from 'drizzle-orm'
import { db, schema } from '../../../db'
import { requireUser } from '../../../utils/auth'
import { writeAudit } from '../../../utils/audit'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['admin', 'warehouse'])

  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'รหัสตำแหน่งไม่ถูกต้อง' })
  }

  const existing = await db.query.storageLocations.findFirst({
    where: eq(schema.storageLocations.id, id),
  })
  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: 'ไม่พบตำแหน่ง' })
  }

  // Refuse to orphan a stock-movement or pick-task-item reference.
  const movement = await db.query.stockMovements.findFirst({
    where: eq(schema.stockMovements.locationId, id),
  })
  const pickItem = await db.query.pickTaskItems.findFirst({
    where: eq(schema.pickTaskItems.locationId, id),
  })
  if (movement || pickItem) {
    throw createError({
      statusCode: 409,
      statusMessage: 'ลบไม่ได้: ตำแหน่งนี้ถูกใช้งานอยู่',
    })
  }

  await db.delete(schema.storageLocations).where(eq(schema.storageLocations.id, id))

  await writeAudit(user.id, 'location.delete', 'location', String(id), `code=${existing.code}`)

  return { ok: true }
})
