// POST /api/masters/:entity — create a row in an editable master (admin only).
// Body is validated by the entity's Zod create schema. Derived masters → 403.
import { db } from '../../../db'
import { requireUser } from '../../../utils/auth'
import { parseBody } from '../../../utils/validation'
import { getMaster, assertEditable } from '../registry'

export default defineEventHandler(async (event) => {
  await requireUser(event, ['admin'])

  const entity = getRouterParam(event, 'entity') as string
  const def = getMaster(entity)
  assertEditable(entity, def)

  const values = await parseBody(event, def.create)
  // Some masters inject server-managed columns (timestamps, system defaults)
  // that the client is not allowed to set.
  const toInsert = def.prepareCreate
    ? def.prepareCreate(values as Record<string, unknown>)
    : values

  try {
    // `def.table` is a heterogeneous union of master tables; the Zod-validated
    // `values` shape is checked at runtime, so cast at the insert boundary.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [row] = await db.insert(def.table).values(toInsert as any).returning()
    return { ok: true, row }
  } catch {
    // Most likely a unique-constraint violation on the natural key.
    throw createError({
      statusCode: 409,
      statusMessage: 'ข้อมูลซ้ำ (รหัส/คีย์นี้มีอยู่แล้ว)',
    })
  }
})
