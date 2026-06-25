// GET /api/vin-accessories — accessories installed on vehicles. Any authed user.
// Optional ?vin= returns only that vehicle's installs (newest first), each
// joined with the accessory name/sku. No vin → recent installs across all VINs.
import { desc, eq } from 'drizzle-orm'
import { db, schema } from '../../db'
import { requireUser } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  await requireUser(event)
  const vinParam = typeof getQuery(event).vin === 'string' ? String(getQuery(event).vin).trim().toUpperCase() : undefined

  const rows = await db
    .select({
      id: schema.vinAccessories.id,
      vin: schema.vinAccessories.vin,
      accessoryId: schema.vinAccessories.accessoryId,
      accessoryName: schema.autologicDevices.name,
      accessorySku: schema.autologicDevices.sku,
      installedAt: schema.vinAccessories.installedAt,
      installCenter: schema.vinAccessories.installCenter,
      warrantyMonths: schema.vinAccessories.warrantyMonths,
      note: schema.vinAccessories.note,
      installedBy: schema.vinAccessories.installedBy,
      createdAt: schema.vinAccessories.createdAt,
    })
    .from(schema.vinAccessories)
    .innerJoin(schema.autologicDevices, eq(schema.vinAccessories.accessoryId, schema.autologicDevices.id))
    .where(vinParam ? eq(schema.vinAccessories.vin, vinParam) : undefined)
    .orderBy(desc(schema.vinAccessories.id))
    .limit(vinParam ? 100 : 30)

  return { accessories: rows }
})
