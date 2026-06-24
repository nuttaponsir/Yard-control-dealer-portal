// GET /api/autologic-devices — Phase M. Telematics devices/packages Autologic
// offers, with per-model compatibility. Any authenticated user. Optional
// ?vin= / ?model= filter returns only devices compatible with the vehicle's
// model (universal devices — empty compatibleModels — always included). If no
// model is resolvable, returns all active devices. Only active devices.
import { and, eq, or, sql } from 'drizzle-orm'
import { db, schema } from '../../db'
import { requireUser } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  await requireUser(event)

  const query = getQuery(event)
  const vinParam = typeof query.vin === 'string' ? query.vin.trim().toUpperCase() : undefined
  const modelParam = typeof query.model === 'string' ? query.model : undefined

  // Resolve the target model: explicit ?model= wins, else look up the VIN's model.
  let model = modelParam
  if (!model && vinParam) {
    const vinRow = await db.query.vins.findFirst({
      where: eq(schema.vins.vin, vinParam),
    })
    model = vinRow?.model
  }

  // Array-membership filter: keep universal devices (empty array) OR devices
  // whose compatible_models contains the model. `= ANY(...)` reads the text[].
  const devices = model
    ? await db
        .select()
        .from(schema.autologicDevices)
        .where(
          and(
            eq(schema.autologicDevices.active, true),
            or(
              sql`cardinality(${schema.autologicDevices.compatibleModels}) = 0`,
              sql`${model} = ANY(${schema.autologicDevices.compatibleModels})`,
            ),
          ),
        )
    : await db
        .select()
        .from(schema.autologicDevices)
        .where(eq(schema.autologicDevices.active, true))

  return { devices }
})
