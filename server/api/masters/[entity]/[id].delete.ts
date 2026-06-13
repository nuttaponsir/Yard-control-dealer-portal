// DELETE /api/masters/:entity/:id — remove a row by id (admin only).
// Derived masters → 403. Missing row → 404.
import { eq } from 'drizzle-orm'
import { db } from '../../../db'
import { requireUser } from '../../../utils/auth'
import { getMaster, assertEditable } from '../registry'

export default defineEventHandler(async (event) => {
  await requireUser(event, ['admin'])

  const entity = getRouterParam(event, 'entity') as string
  const def = getMaster(entity)
  assertEditable(entity, def)

  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'รหัสไม่ถูกต้อง' })
  }

  // FK safety: some masters refuse deletion while still referenced.
  if (def.assertDeletable) await def.assertDeletable(id)

  const [row] = await db.delete(def.table).where(eq(def.table.id, id)).returning()
  if (!row) {
    throw createError({ statusCode: 404, statusMessage: 'ไม่พบรายการ' })
  }
  return { ok: true, id }
})
