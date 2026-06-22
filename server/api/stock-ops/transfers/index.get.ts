// GET /api/stock-ops/transfers — Phase 5 (Stock-ops). Warehouse-transfer list.
// Warehouse-level (admin/warehouse), NOT dealer-scoped. Newest first (id desc).
// Each row is enriched with the referenced part's sku + name for display.
import { desc } from 'drizzle-orm'
import { db, schema } from '../../../db'
import { requireUser } from '../../../utils/auth'
import type { StockTransfer } from '../../../../app/types'

export interface TransferRow extends StockTransfer {
  partSku: string | null
  partName: string | null
}

export default defineEventHandler(async (event) => {
  await requireUser(event, ['admin', 'warehouse'])

  const rows = await db.query.stockTransfers.findMany({
    orderBy: [desc(schema.stockTransfers.id)],
  })

  const partRows = await db.query.parts.findMany()
  const partById = new Map(partRows.map((p) => [p.id, p]))

  const transfers: TransferRow[] = rows.map((tr) => {
    const part = partById.get(tr.partId)
    return {
      ...(tr as StockTransfer),
      partSku: part?.sku ?? null,
      partName: part?.name ?? null,
    }
  })

  return { transfers }
})
