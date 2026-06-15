// POST /api/wms/locations — Phase 3 (WMS). Create a storage-location bin.
// Warehouse-level; admin/warehouse only. The warehouse must exist in the
// `warehouses` master (matched by name). A duplicate `code` (unique) surfaces
// as a 409.
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { db, schema } from '../../../db'
import { requireUser } from '../../../utils/auth'
import { parseBody } from '../../../utils/validation'
import { writeAudit } from '../../../utils/audit'
import type { StorageLocation } from '../../../../app/types'

const createSchema = z.object({
  warehouse: z.string().min(1),
  code: z.string().trim().min(1),
  zone: z.string().nullish(),
  aisle: z.string().nullish(),
  bin: z.string().nullish(),
  active: z.boolean().default(true),
})

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['admin', 'warehouse'])
  const body = await parseBody(event, createSchema)

  // The warehouse must exist in the master (matched by name).
  const warehouse = await db.query.warehouses.findFirst({
    where: eq(schema.warehouses.name, body.warehouse),
  })
  if (!warehouse) {
    throw createError({ statusCode: 400, statusMessage: 'ไม่พบคลังที่ระบุ' })
  }

  const now = new Date().toISOString()

  let location: StorageLocation
  try {
    const [row] = await db
      .insert(schema.storageLocations)
      .values({
        warehouse: body.warehouse,
        code: body.code,
        zone: body.zone ?? null,
        aisle: body.aisle ?? null,
        bin: body.bin ?? null,
        active: body.active,
        createdAt: now,
      })
      .returning()
    location = row! as StorageLocation
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw createError({ statusCode: 409, statusMessage: `รหัสตำแหน่งซ้ำ: ${body.code}` })
    }
    throw err
  }

  await writeAudit(user.id, 'location.create', 'location', String(location.id), `code=${location.code}`)

  return { ok: true, location }
})

// Postgres unique-violation = SQLSTATE 23505. Probe the common shapes.
function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } }
  return e?.code === '23505' || e?.cause?.code === '23505'
}
