// GET /api/stock-ops/counts — Phase 5 (Stock-ops). Cycle-count list.
// Warehouse-level (admin/warehouse), NOT dealer-scoped. Newest first (id desc).
// Each row is enriched with the referenced part's sku + name for display.
import { desc } from 'drizzle-orm'
import { db, schema } from '../../../db'
import { requireUser } from '../../../utils/auth'
import type { CycleCount } from '../../../../app/types'

export interface CountRow extends CycleCount {
  partSku: string | null
  partName: string | null
}

export default defineEventHandler(async (event) => {
  await requireUser(event, ['admin', 'warehouse'])

  const rows = await db.query.cycleCounts.findMany({
    orderBy: [desc(schema.cycleCounts.id)],
  })

  const partRows = await db.query.parts.findMany()
  const partById = new Map(partRows.map((p) => [p.id, p]))

  const counts: CountRow[] = rows.map((c) => {
    const part = partById.get(c.partId)
    return {
      ...(c as CycleCount),
      partSku: part?.sku ?? null,
      partName: part?.name ?? null,
    }
  })

  return { counts }
})
