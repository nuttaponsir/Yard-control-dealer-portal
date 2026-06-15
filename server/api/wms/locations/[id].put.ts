// PUT /api/wms/locations/:id — Phase 3 (WMS). Partial update of a bin.
// Warehouse-level; admin/warehouse only. At least one field must be provided.
// `code` may be changed but a clash with another bin surfaces as a 409.
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { db, schema } from '../../../db'
import { requireUser } from '../../../utils/auth'
import { parseBody } from '../../../utils/validation'
import { writeAudit } from '../../../utils/audit'
import type { StorageLocation } from '../../../../app/types'

const updateSchema = z
  .object({
    warehouse: z.string().min(1).optional(),
    code: z.string().trim().min(1).optional(),
    zone: z.string().nullish(),
    aisle: z.string().nullish(),
    bin: z.string().nullish(),
    active: z.boolean().optional(),
  })
  .refine((b) => Object.keys(b).length > 0, { message: 'ต้องระบุอย่างน้อยหนึ่งฟิลด์' })

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

  const body = await parseBody(event, updateSchema)

  // A new warehouse, if given, must exist in the master (matched by name).
  if (body.warehouse !== undefined) {
    const warehouse = await db.query.warehouses.findFirst({
      where: eq(schema.warehouses.name, body.warehouse),
    })
    if (!warehouse) {
      throw createError({ statusCode: 400, statusMessage: 'ไม่พบคลังที่ระบุ' })
    }
  }

  // Patch only the provided keys (null clears optional fields).
  const patch: Record<string, unknown> = {}
  for (const key of ['warehouse', 'code', 'zone', 'aisle', 'bin', 'active'] as const) {
    if (key in body) patch[key] = (body as Record<string, unknown>)[key] ?? null
  }

  let location: StorageLocation
  try {
    const [row] = await db
      .update(schema.storageLocations)
      .set(patch)
      .where(eq(schema.storageLocations.id, id))
      .returning()
    location = row! as StorageLocation
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw createError({ statusCode: 409, statusMessage: `รหัสตำแหน่งซ้ำ: ${body.code}` })
    }
    throw err
  }

  await writeAudit(user.id, 'location.update', 'location', String(id), `code=${location.code}`)

  return { ok: true, location }
})

// Postgres unique-violation = SQLSTATE 23505. Probe the common shapes.
function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } }
  return e?.code === '23505' || e?.cause?.code === '23505'
}
