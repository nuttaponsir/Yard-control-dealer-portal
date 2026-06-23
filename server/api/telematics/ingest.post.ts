// POST /api/telematics/ingest — device/gateway event ingestion (#4).
// ----------------------------------------------------------------------------
// The real-world seam for Autologic devices to push events. Authenticated EITHER
// by a logged-in admin/warehouse session (used by the in-app "simulate" control)
// OR by a shared device token in the `x-ingest-token` header matching the
// `telematics_ingest_token` config (used by devices/gateways in the field).
// On each event the device's lastConnectedAt is bumped; a firmware_update event
// with a version in `detail` also updates vins.firmware.
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { db, schema } from '../../db'
import { getUser } from '../../utils/auth'
import { getConfig } from '../../utils/config'
import { parseBody } from '../../utils/validation'
import type { TelematicsEventType, TelematicsSeverity } from '../../../app/types'

const EVENT_TYPES = ['connect', 'disconnect', 'fault', 'firmware_update', 'geofence', 'heartbeat'] as const

const ingestSchema = z.object({
  vin: z.string().length(17),
  type: z.enum(EVENT_TYPES),
  severity: z.enum(['info', 'warning', 'critical']).optional(),
  message: z.string().trim().max(300).optional(),
  detail: z.string().trim().max(500).nullish(),
})

// Sensible defaults when a device omits severity/message.
const DEFAULT_SEVERITY: Record<TelematicsEventType, TelematicsSeverity> = {
  connect: 'info',
  disconnect: 'warning',
  fault: 'critical',
  firmware_update: 'info',
  geofence: 'warning',
  heartbeat: 'info',
}
const DEFAULT_MESSAGE: Record<TelematicsEventType, string> = {
  connect: 'อุปกรณ์ออนไลน์',
  disconnect: 'อุปกรณ์ขาดการเชื่อมต่อ',
  fault: 'ตรวจพบข้อผิดพลาดของอุปกรณ์',
  firmware_update: 'อัปเดตเฟิร์มแวร์',
  geofence: 'ออกนอกพื้นที่ที่กำหนด',
  heartbeat: 'สัญญาณปกติ',
}

export default defineEventHandler(async (event) => {
  // Auth: session admin/warehouse, or a matching device ingest token.
  const user = await getUser(event)
  const sessionOk = !!user && (user.role === 'admin' || user.role === 'warehouse')
  const token = (await getConfig('telematics_ingest_token')).trim()
  const headerToken = getHeader(event, 'x-ingest-token')
  const tokenOk = token.length > 0 && headerToken === token
  if (!sessionOk && !tokenOk) {
    throw createError({ statusCode: 401, statusMessage: 'ไม่ได้รับอนุญาตให้ส่งข้อมูลอุปกรณ์' })
  }

  const body = await parseBody(event, ingestSchema)

  const vinRow = await db.query.vins.findFirst({ where: eq(schema.vins.vin, body.vin) })
  if (!vinRow) {
    throw createError({ statusCode: 404, statusMessage: `ไม่พบ VIN ${body.vin} ในระบบ` })
  }

  const now = new Date().toISOString()
  const severity = body.severity ?? DEFAULT_SEVERITY[body.type]
  const message = body.message?.trim() || DEFAULT_MESSAGE[body.type]

  const created = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(schema.telematicsEvents)
      .values({
        vin: body.vin,
        type: body.type,
        severity,
        message,
        detail: body.detail ?? null,
        createdBy: user?.id ?? null,
        createdAt: now,
      })
      .returning()

    // Any event counts as a check-in; firmware updates also bump the version.
    const patch: Partial<typeof schema.vins.$inferInsert> = { lastConnectedAt: now }
    if (body.type === 'firmware_update' && body.detail?.trim()) patch.firmware = body.detail.trim()
    await tx.update(schema.vins).set(patch).where(eq(schema.vins.vin, body.vin))

    return row!
  })

  return { ok: true, event: created }
})
