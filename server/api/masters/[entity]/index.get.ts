// GET /api/masters/:entity — list all rows of a registered master (admin only).
// Unknown entity → 404 via the registry whitelist.
import { asc } from 'drizzle-orm'
import { db } from '../../../db'
import { requireUser } from '../../../utils/auth'
import { getMaster } from '../registry'

export default defineEventHandler(async (event) => {
  await requireUser(event, ['admin'])

  const entity = getRouterParam(event, 'entity') as string
  const def = getMaster(entity)

  const rows = await db
    .select()
    .from(def.table)
    .orderBy(asc(def.table[def.sortKey]))

  return { entity, editable: def.editable, rows }
})
