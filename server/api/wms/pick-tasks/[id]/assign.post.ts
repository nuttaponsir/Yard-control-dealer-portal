// POST /api/wms/pick-tasks/:id/assign — Phase 3 (WMS). Assign a pick task to a
// picker. admin/warehouse only. Defaults to the acting user when no userId is
// given. 404 when missing; 409 once the task is picked/cancelled (terminal).
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { db, schema } from '../../../../db'
import { requireUser } from '../../../../utils/auth'
import { parseBody } from '../../../../utils/validation'
import { writeAudit } from '../../../../utils/audit'
import type { PickTask } from '../../../../../app/types'

// `.default({})` so an empty POST body (no userId → assign to self) parses
// cleanly instead of failing the object check with a 400.
const assignSchema = z
  .object({
    userId: z.number().int().positive().optional(),
  })
  .default({})

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['admin', 'warehouse'])

  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'รหัสใบจัดไม่ถูกต้อง' })
  }

  const body = await parseBody(event, assignSchema)

  const task = await db.query.pickTasks.findFirst({ where: eq(schema.pickTasks.id, id) })
  if (!task) {
    throw createError({ statusCode: 404, statusMessage: 'ไม่พบใบจัดสินค้า' })
  }
  if (task.status === 'picked' || task.status === 'cancelled') {
    throw createError({ statusCode: 409, statusMessage: 'ใบจัดนี้ปิดงานแล้ว ไม่สามารถรับงานได้' })
  }

  const assignedTo = body.userId ?? user.id
  const now = new Date().toISOString()

  const [updated] = await db
    .update(schema.pickTasks)
    .set({ assignedTo, status: 'assigned', updatedAt: now })
    .where(eq(schema.pickTasks.id, id))
    .returning()

  await writeAudit(user.id, 'pick.assign', 'pick_task', task.pickNumber, `assignedTo=${assignedTo}`)

  return { ok: true, pickTask: updated as PickTask }
})
