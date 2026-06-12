// GET /api/reports/sales-by-category (R-S2) — Dev2, Phase D.
// Admin-only. Line-level revenue/qty per parts.category over non-cancelled
// orders. Sorted by revenue desc, then category asc.
import { db } from '../../db'
import { requireUser } from '../../utils/auth'

interface SalesByCategoryRow {
  category: string
  qty: number
  revenue: number
}

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['admin'])
  void user

  const orderRows = await db.query.orders.findMany()
  const itemRows = await db.query.orderItems.findMany()
  const partRows = await db.query.parts.findMany()

  const liveOrderIds = new Set(
    orderRows.filter((o) => o.status !== 'cancelled').map((o) => o.id),
  )
  const categoryByPart = new Map(partRows.map((p) => [p.id, p.category]))

  const agg = new Map<string, { qty: number; revenue: number }>()
  for (const it of itemRows) {
    if (!liveOrderIds.has(it.orderId)) continue
    const category = categoryByPart.get(it.partId)
    if (category == null) continue
    const cur = agg.get(category) ?? { qty: 0, revenue: 0 }
    cur.qty += it.qty
    cur.revenue += it.unitPrice * it.qty
    agg.set(category, cur)
  }

  const rows: SalesByCategoryRow[] = [...agg.entries()].map(([category, v]) => ({
    category,
    qty: v.qty,
    revenue: v.revenue,
  }))

  rows.sort((a, b) => b.revenue - a.revenue || a.category.localeCompare(b.category))

  return { rows }
})
