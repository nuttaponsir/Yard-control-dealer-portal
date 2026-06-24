// GET /api/claim-resolutions — Phase M. List of active claim resolution codes
// used when deciding a claim (refund | replace | repair | reject). Any
// authenticated user. Ordered by id.
import { asc, eq } from 'drizzle-orm'
import { db, schema } from '../db'
import { requireUser } from '../utils/auth'

export default defineEventHandler(async (event) => {
  await requireUser(event)

  const rows = await db
    .select({
      id: schema.claimResolutions.id,
      code: schema.claimResolutions.code,
      nameTh: schema.claimResolutions.nameTh,
      refundable: schema.claimResolutions.refundable,
    })
    .from(schema.claimResolutions)
    .where(eq(schema.claimResolutions.active, true))
    .orderBy(asc(schema.claimResolutions.id))

  return { resolutions: rows }
})
