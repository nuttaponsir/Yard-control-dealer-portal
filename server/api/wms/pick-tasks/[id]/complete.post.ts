// POST /api/wms/pick-tasks/:id/complete — Phase 3 (WMS). Mark a pick task done:
// every line is fully picked (pickedQty = qty, status='picked') and the task
// flips to 'picked'. admin/warehouse only. 404 when missing; 409 once the task
// is already picked/cancelled. Pick tasks are a workflow overlay — completing
// one records operational sign-off and does NOT move stock.
import { eq } from 'drizzle-orm'
import { db, schema } from '../../../../db'
import { requireUser } from '../../../../utils/auth'
import { writeAudit } from '../../../../utils/audit'
import type { PickTask } from '../../../../../app/types'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['admin', 'warehouse'])

  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'รหัสใบจัดไม่ถูกต้อง' })
  }

  const task = await db.query.pickTasks.findFirst({ where: eq(schema.pickTasks.id, id) })
  if (!task) {
    throw createError({ statusCode: 404, statusMessage: 'ไม่พบใบจัดสินค้า' })
  }
  if (task.status === 'picked' || task.status === 'cancelled') {
    throw createError({ statusCode: 409, statusMessage: 'ใบจัดนี้ปิดงานแล้ว ไม่สามารถจัดเสร็จได้' })
  }

  const now = new Date().toISOString()

  const updated = await db.transaction(async (tx) => {
    const lines = await tx.query.pickTaskItems.findMany({
      where: eq(schema.pickTaskItems.pickTaskId, id),
    })
    for (const line of lines) {
      await tx
        .update(schema.pickTaskItems)
        .set({ pickedQty: line.qty, status: 'picked' })
        .where(eq(schema.pickTaskItems.id, line.id))
    }
    const [row] = await tx
      .update(schema.pickTasks)
      .set({ status: 'picked', updatedAt: now })
      .where(eq(schema.pickTasks.id, id))
      .returning()
    return row!
  })

  await writeAudit(user.id, 'pick.complete', 'pick_task', task.pickNumber)

  return { ok: true, pickTask: updated as PickTask }
})
