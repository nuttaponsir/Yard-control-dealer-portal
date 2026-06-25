// POST /api/vin-accessories — record an accessory installation on a vehicle.
// admin/warehouse. Validates the VIN + accessory exist, stamps installedBy/now,
// and flips the vehicle's "in program" gate (vins.autologicInstalled = true) so
// the catalog unlocks for that VIN.
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { db, schema } from '../../db'
import { requireUser } from '../../utils/auth'
import { parseBody } from '../../utils/validation'
import { writeAudit } from '../../utils/audit'

const bodySchema = z.object({
  vin: z.string().trim().length(17),
  accessoryId: z.number().int().positive(),
  installedAt: z.string().trim().min(1).optional(),
  installCenter: z.string().trim().max(200).nullish(),
  warrantyMonths: z.number().int().min(0).max(120).default(0),
  note: z.string().trim().max(500).nullish(),
})

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['admin', 'warehouse'])
  const body = await parseBody(event, bodySchema)
  const vin = body.vin.toUpperCase()

  const vehicle = await db.query.vins.findFirst({ where: eq(schema.vins.vin, vin) })
  if (!vehicle) throw createError({ statusCode: 400, statusMessage: 'ไม่พบ VIN นี้ในระบบ' })

  const accessory = await db.query.autologicDevices.findFirst({
    where: eq(schema.autologicDevices.id, body.accessoryId),
  })
  if (!accessory) throw createError({ statusCode: 400, statusMessage: 'ไม่พบอุปกรณ์ตกแต่งที่ระบุ' })

  const now = new Date().toISOString()
  const [row] = await db
    .insert(schema.vinAccessories)
    .values({
      vin,
      accessoryId: body.accessoryId,
      installedAt: body.installedAt || now.slice(0, 10),
      installCenter: body.installCenter ?? null,
      warrantyMonths: body.warrantyMonths,
      note: body.note ?? null,
      installedBy: user.id,
      createdAt: now,
    })
    .returning()

  // VIN now has an accessory → unlock ordering (gate).
  if (!vehicle.autologicInstalled) {
    await db.update(schema.vins).set({ autologicInstalled: true, status: 'installed' }).where(eq(schema.vins.vin, vin))
  }

  await writeAudit(user.id, 'accessory.install', 'vin', vin, `accessory=${accessory.sku}`)
  return { ok: true, accessory: row }
})
