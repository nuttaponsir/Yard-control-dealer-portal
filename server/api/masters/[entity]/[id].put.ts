// PUT /api/masters/:entity/:id — update a row by id (admin only).
// Body validated by the entity's partial update schema. Derived masters → 403.
import { eq } from 'drizzle-orm'
import { db } from '../../../db'
import { requireUser } from '../../../utils/auth'
import { parseBody } from '../../../utils/validation'
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

  const patch = await parseBody(event, def.update)
  if (!patch || Object.keys(patch).length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'ไม่มีข้อมูลที่จะอัปเดต' })
  }

  try {
    const [row] = await db
      .update(def.table)
      .set(patch)
      .where(eq(def.table.id, id))
      .returning()
    if (!row) {
      throw createError({ statusCode: 404, statusMessage: 'ไม่พบรายการ' })
    }
    return { ok: true, row }
  } catch (err: unknown) {
    // Re-throw createError'd HTTP errors; wrap DB constraint errors as 409.
    if (err && typeof err === 'object' && 'statusCode' in err) throw err
    throw createError({ statusCode: 409, statusMessage: 'ข้อมูลซ้ำ (รหัส/คีย์นี้มีอยู่แล้ว)' })
  }
})
