// POST /api/telematics/firmware — Phase 5. Push a firmware version to a device.
// admin/warehouse only. Updates the vin's firmware + lastConnectedAt and records
// a 'firmware_update' telematics event in a single transaction.
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { db, schema } from '../../db'
import { requireUser } from '../../utils/auth'
import { parseBody } from '../../utils/validation'
import { writeAudit } from '../../utils/audit'

const firmwareSchema = z.object({
  vin: z.string().length(17),
  firmware: z.string().min(1),
})

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['admin', 'warehouse'])

  const { vin, firmware } = await parseBody(event, firmwareSchema)

  const device = await db.query.vins.findFirst({ where: eq(schema.vins.vin, vin) })
  if (!device) {
    throw createError({ statusCode: 404, statusMessage: 'ไม่พบอุปกรณ์' })
  }

  const now = new Date().toISOString()

  await db.transaction(async (tx) => {
    await tx
      .update(schema.vins)
      .set({ firmware, lastConnectedAt: now })
      .where(eq(schema.vins.vin, vin))

    await tx.insert(schema.telematicsEvents).values({
      vin,
      type: 'firmware_update',
      severity: 'info',
      message: `อัปเดตเฟิร์มแวร์เป็น ${firmware}`,
      detail: null,
      createdBy: user.id,
      createdAt: now,
    })
  })

  await writeAudit(user.id, 'telematics.firmware', 'vin', vin, firmware)

  return { ok: true }
})
