// POST /api/warranty/:id/void — Phase 5. Void a warranty registration.
// admin-only. 404 if missing, 409 if already void.
import { eq } from 'drizzle-orm'
import { db, schema } from '../../../db'
import { requireUser } from '../../../utils/auth'
import { writeAudit } from '../../../utils/audit'
import type { Warranty } from '../../../../app/types'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['admin'])

  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'รหัสไม่ถูกต้อง' })
  }

  const existing = await db.query.warranties.findFirst({
    where: eq(schema.warranties.id, id),
  })
  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: 'ไม่พบการรับประกัน' })
  }
  if (existing.status === 'void') {
    throw createError({ statusCode: 409, statusMessage: 'การรับประกันนี้ถูกยกเลิกแล้ว' })
  }

  const [warranty] = await db
    .update(schema.warranties)
    .set({ status: 'void' })
    .where(eq(schema.warranties.id, id))
    .returning()

  await writeAudit(user.id, 'warranty.void', 'warranty', existing.warrantyNo)

  return { ok: true, warranty: warranty as Warranty }
})
