// GET /api/reports/inventory-valuation (R-I4) — Dev3, Phase D.
// Admin-only: per-part on-hand value (sum qty across warehouses × unit price).
import { db } from '../../db'
import { requireUser } from '../../utils/auth'

interface ValuationRow {
  partId: number
  sku: string
  name: string
  totalQty: number
  price: number
  value: number
}

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['admin'])
  void user

  const parts = await db.query.parts.findMany({
    columns: { id: true, sku: true, name: true, price: true },
  })
  const inventory = await db.query.inventory.findMany({
    columns: { partId: true, qtyOnHand: true },
  })

  const qtyByPart = new Map<number, number>()
  for (const i of inventory) {
    qtyByPart.set(i.partId, (qtyByPart.get(i.partId) ?? 0) + i.qtyOnHand)
  }

  const rows: ValuationRow[] = parts
    .map((p) => {
      const totalQty = qtyByPart.get(p.id) ?? 0
      return {
        partId: p.id,
        sku: p.sku,
        name: p.name,
        totalQty,
        price: p.price,
        value: totalQty * p.price,
      }
    })
    .sort((a, b) => b.value - a.value || a.sku.localeCompare(b.sku))

  const grandTotal = rows.reduce((s, r) => s + r.value, 0)

  return { rows, grandTotal }
})
