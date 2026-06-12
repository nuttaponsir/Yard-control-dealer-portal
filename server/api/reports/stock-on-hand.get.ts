// GET /api/reports/stock-on-hand (R-I1) — Dev3, Phase D.
// Admin-only inventory snapshot: per part×warehouse rows plus a per-part total.
import { eq } from 'drizzle-orm'
import { db, schema } from '../../db'
import { requireUser } from '../../utils/auth'

interface StockRow {
  sku: string
  name: string
  warehouse: string
  qtyOnHand: number
  reorderPoint: number
}
interface ByPartRow {
  sku: string
  name: string
  totalQtyOnHand: number
}

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['admin'])
  void user

  const inv = await db
    .select({
      sku: schema.parts.sku,
      name: schema.parts.name,
      warehouse: schema.inventory.warehouse,
      qtyOnHand: schema.inventory.qtyOnHand,
      reorderPoint: schema.inventory.reorderPoint,
    })
    .from(schema.inventory)
    .innerJoin(schema.parts, eq(schema.inventory.partId, schema.parts.id))

  const rows: StockRow[] = inv
    .map((r) => ({
      sku: r.sku,
      name: r.name,
      warehouse: r.warehouse,
      qtyOnHand: r.qtyOnHand,
      reorderPoint: r.reorderPoint,
    }))
    .sort((a, b) => a.sku.localeCompare(b.sku) || a.warehouse.localeCompare(b.warehouse))

  const byPartMap = new Map<string, ByPartRow>()
  for (const r of rows) {
    const cur = byPartMap.get(r.sku)
    if (cur) cur.totalQtyOnHand += r.qtyOnHand
    else byPartMap.set(r.sku, { sku: r.sku, name: r.name, totalQtyOnHand: r.qtyOnHand })
  }
  const byPart: ByPartRow[] = [...byPartMap.values()].sort((a, b) => a.sku.localeCompare(b.sku))

  return { rows, byPart }
})
