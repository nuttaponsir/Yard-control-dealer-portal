// GET /api/reports/low-stock (R-I2) — Dev3, Phase D.
// Admin-only: inventory rows below their reorder point, ranked by deficit.
import { eq, lt } from 'drizzle-orm'
import { db, schema } from '../../db'
import { requireUser } from '../../utils/auth'

interface LowStockRow {
  sku: string
  name: string
  warehouse: string
  qtyOnHand: number
  reorderPoint: number
  deficit: number
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
    .where(lt(schema.inventory.qtyOnHand, schema.inventory.reorderPoint))

  const rows: LowStockRow[] = inv
    .map((r) => ({
      sku: r.sku,
      name: r.name,
      warehouse: r.warehouse,
      qtyOnHand: r.qtyOnHand,
      reorderPoint: r.reorderPoint,
      deficit: r.reorderPoint - r.qtyOnHand,
    }))
    .sort((a, b) => b.deficit - a.deficit || a.sku.localeCompare(b.sku) || a.warehouse.localeCompare(b.warehouse))

  return { rows, count: rows.length }
})
