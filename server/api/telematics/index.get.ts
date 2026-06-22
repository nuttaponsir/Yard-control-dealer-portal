// GET /api/telematics — Phase 5 (Autologic Telematics).
// Device registry (vins with a deviceSerial) plus the recent telematics-event
// feed. Online/offline is derived in the page from lastConnectedAt; the API
// just returns the raw device rows + the latest 50 events.
import { desc, isNotNull } from 'drizzle-orm'
import { db, schema } from '../../db'
import { requireUser } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  await requireUser(event, ['admin', 'owner', 'sales', 'warehouse'])

  const deviceRows = await db.query.vins.findMany({
    where: isNotNull(schema.vins.deviceSerial),
  })

  const devices = deviceRows.map((v) => ({
    vin: v.vin,
    model: v.model,
    modelYear: v.modelYear,
    deviceSerial: v.deviceSerial,
    firmware: v.firmware,
    lastConnectedAt: v.lastConnectedAt,
    autologicInstalled: v.autologicInstalled,
    status: v.status,
  }))

  const events = await db.query.telematicsEvents.findMany({
    orderBy: [desc(schema.telematicsEvents.id)],
    limit: 50,
  })

  return { devices, events }
})
