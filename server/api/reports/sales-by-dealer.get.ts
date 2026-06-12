// GET /api/reports/sales-by-dealer (R-S1) — Dev2, Phase D.
// Admin-only. Per-dealer sales rollup over non-cancelled orders. Only dealers
// with at least one non-cancelled order appear. Sorted by totalSales desc,
// then dealer code asc.
import { db } from '../../db'
import { requireUser } from '../../utils/auth'

interface SalesByDealerRow {
  dealerId: number
  code: string
  name: string
  province: string
  grade: string
  orderCount: number
  totalSales: number
}

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['admin'])
  void user

  const orderRows = await db.query.orders.findMany()
  const dealerRows = await db.query.dealers.findMany()
  const dealerById = new Map(dealerRows.map((d) => [d.id, d]))

  const agg = new Map<number, { orderCount: number; totalSales: number }>()
  for (const o of orderRows) {
    if (o.status === 'cancelled') continue
    const cur = agg.get(o.dealerId) ?? { orderCount: 0, totalSales: 0 }
    cur.orderCount += 1
    cur.totalSales += o.totalValue
    agg.set(o.dealerId, cur)
  }

  const rows: SalesByDealerRow[] = []
  for (const [dealerId, v] of agg) {
    const d = dealerById.get(dealerId)
    if (!d) continue
    rows.push({
      dealerId,
      code: d.code,
      name: d.name,
      province: d.province,
      grade: d.grade,
      orderCount: v.orderCount,
      totalSales: v.totalSales,
    })
  }

  rows.sort((a, b) => b.totalSales - a.totalSales || a.code.localeCompare(b.code))

  return { rows }
})
