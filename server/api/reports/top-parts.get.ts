// GET /api/reports/top-parts (R-S6) — Dev2, Phase D.
// Admin-only. Line-level qty + revenue per part over non-cancelled orders.
// Returns top-N (default 10, via ?limit) ranked separately by qty and revenue.
import { db } from '../../db'
import { requireUser } from '../../utils/auth'

interface TopPartRow {
  partId: number
  sku: string
  name: string
  qty: number
  revenue: number
}

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['admin'])
  void user

  const q = getQuery(event)
  const parsed = Number.parseInt(String(q.limit ?? ''), 10)
  const limit = Number.isFinite(parsed) && parsed > 0 ? parsed : 10

  const orderRows = await db.query.orders.findMany()
  const itemRows = await db.query.orderItems.findMany()
  const partRows = await db.query.parts.findMany()

  const liveOrderIds = new Set(
    orderRows.filter((o) => o.status !== 'cancelled').map((o) => o.id),
  )
  const partById = new Map(partRows.map((p) => [p.id, p]))

  const agg = new Map<number, { qty: number; revenue: number }>()
  for (const it of itemRows) {
    if (!liveOrderIds.has(it.orderId)) continue
    const cur = agg.get(it.partId) ?? { qty: 0, revenue: 0 }
    cur.qty += it.qty
    cur.revenue += it.unitPrice * it.qty
    agg.set(it.partId, cur)
  }

  const all: TopPartRow[] = []
  for (const [partId, v] of agg) {
    const p = partById.get(partId)
    if (!p) continue
    all.push({ partId, sku: p.sku, name: p.name, qty: v.qty, revenue: v.revenue })
  }

  const topByQty = [...all]
    .sort((a, b) => b.qty - a.qty || a.sku.localeCompare(b.sku))
    .slice(0, limit)
  const topByRevenue = [...all]
    .sort((a, b) => b.revenue - a.revenue || a.sku.localeCompare(b.sku))
    .slice(0, limit)

  return { topByQty, topByRevenue }
})
