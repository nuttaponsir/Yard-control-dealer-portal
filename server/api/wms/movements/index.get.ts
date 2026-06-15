// GET /api/wms/movements — Phase 3 (WMS). Stock-movement ledger list.
// Warehouse-level (admin/warehouse), NOT dealer-scoped. Optional filters:
// ?kind= ?warehouse= ?partId=. Newest first (id desc), capped to the most
// recent 300 rows. Each row is enriched with the referenced part's sku + name
// for display.
import { and, desc, eq } from 'drizzle-orm'
import { db, schema } from '../../../db'
import { requireUser } from '../../../utils/auth'
import type { StockMovement } from '../../../../app/types'

export interface MovementRow extends StockMovement {
  partSku: string | null
  partName: string | null
}

export default defineEventHandler(async (event) => {
  await requireUser(event, ['admin', 'warehouse'])

  const query = getQuery(event)
  const kind = typeof query.kind === 'string' ? query.kind : undefined
  const warehouse = typeof query.warehouse === 'string' ? query.warehouse : undefined
  const partIdRaw = query.partId != null ? Number(query.partId) : NaN
  const partId = Number.isInteger(partIdRaw) && partIdRaw > 0 ? partIdRaw : undefined

  const conditions = []
  if (kind) conditions.push(eq(schema.stockMovements.kind, kind))
  if (warehouse) conditions.push(eq(schema.stockMovements.warehouse, warehouse))
  if (partId) conditions.push(eq(schema.stockMovements.partId, partId))

  const rows = await db.query.stockMovements.findMany({
    where: conditions.length ? and(...conditions) : undefined,
    orderBy: [desc(schema.stockMovements.id)],
    limit: 300,
  })

  // Resolve part sku + name once for the referenced parts.
  const partRows = await db.query.parts.findMany()
  const partById = new Map(partRows.map((p) => [p.id, p]))

  const movements: MovementRow[] = rows.map((m) => {
    const part = partById.get(m.partId)
    return {
      ...(m as StockMovement),
      partSku: part?.sku ?? null,
      partName: part?.name ?? null,
    }
  })

  return { movements }
})
