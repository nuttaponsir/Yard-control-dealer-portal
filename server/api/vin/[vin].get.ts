// GET /api/vin/:vin — Dev1 owns. STUB: VIN lookup → Autologic status.
import { eq } from 'drizzle-orm'
import { db, schema } from '../../db'
import { requireUser } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  await requireUser(event)
  const vin = getRouterParam(event, 'vin') ?? ''
  // Real lookup already wired so the gate works end-to-end for dev agents.
  const row = await db.query.vins.findFirst({ where: eq(schema.vins.vin, vin.toUpperCase()) })
  return { vin: row ?? null }
})
