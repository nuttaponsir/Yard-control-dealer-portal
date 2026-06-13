// GET /api/reports/export — Phase K. Admin-only .xlsx of the per-dealer sales
// rollup (the sales-by-dealer dataset the reports page leads with). One sheet,
// flat scalar columns. Mirrors the reports RBAC (admin-only).
import { db } from '../../db'
import { requireUser } from '../../utils/auth'
import { buildXlsx, sendXlsx, type XlsxColumn } from '../../utils/xlsx'

export default defineEventHandler(async (event) => {
  await requireUser(event, ['admin'])

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

  const rows: Record<string, unknown>[] = []
  for (const [dealerId, v] of agg) {
    const d = dealerById.get(dealerId)
    if (!d) continue
    rows.push({
      code: d.code,
      name: d.name,
      province: d.province,
      grade: d.grade,
      orderCount: v.orderCount,
      totalSales: v.totalSales,
    })
  }

  rows.sort(
    (a, b) =>
      (b.totalSales as number) - (a.totalSales as number) ||
      String(a.code).localeCompare(String(b.code)),
  )

  const columns: XlsxColumn[] = [
    { key: 'code' },
    { key: 'name', width: 32 },
    { key: 'province' },
    { key: 'grade' },
    { key: 'orderCount' },
    { key: 'totalSales' },
  ]

  const buf = await buildXlsx(columns, rows, 'Sales by Dealer')
  return sendXlsx(event, buf, `reports-${new Date().toISOString().slice(0, 10)}.xlsx`)
})
