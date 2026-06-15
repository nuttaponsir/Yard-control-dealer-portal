// GET /api/wms/locations — Phase 3 (WMS). List storage-location bins.
// Warehouse-level (NOT dealer-scoped); admin/warehouse only. Optional filters
// ?warehouse= (exact name) and ?active=(true|false). Sorted by warehouse asc,
// then code asc.
import { and, asc, eq } from 'drizzle-orm'
import { db, schema } from '../../../db'
import { requireUser } from '../../../utils/auth'
import type { StorageLocation } from '../../../../app/types'

export default defineEventHandler(async (event) => {
  await requireUser(event, ['admin', 'warehouse'])

  const q = getQuery(event)
  const conditions: ReturnType<typeof eq>[] = []

  const warehouse = typeof q.warehouse === 'string' ? q.warehouse.trim() : ''
  if (warehouse) conditions.push(eq(schema.storageLocations.warehouse, warehouse))

  if (q.active === 'true') conditions.push(eq(schema.storageLocations.active, true))
  else if (q.active === 'false') conditions.push(eq(schema.storageLocations.active, false))

  const rows = await db.query.storageLocations.findMany({
    where: conditions.length ? and(...conditions) : undefined,
    orderBy: [asc(schema.storageLocations.warehouse), asc(schema.storageLocations.code)],
  })

  return { locations: rows as StorageLocation[] }
})
