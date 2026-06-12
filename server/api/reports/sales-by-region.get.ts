// GET /api/reports/sales-by-region (R-S3) — Dev2, Phase D.
// Admin-only. Per-region order count + sales over non-cancelled orders. Region
// is resolved dealer.province → provinces.region (fallback 'ไม่ระบุ'). Sorted
// by totalSales desc, then region asc.
import { db } from '../../db'
import { requireUser } from '../../utils/auth'

interface SalesByRegionRow {
  region: string
  orderCount: number
  totalSales: number
}

const NO_REGION = 'ไม่ระบุ'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['admin'])
  void user

  const orderRows = await db.query.orders.findMany()
  const dealerRows = await db.query.dealers.findMany()
  const provinceRows = await db.query.provinces.findMany()

  const regionByProvince = new Map(provinceRows.map((p) => [p.name, p.region]))
  const provinceByDealer = new Map(dealerRows.map((d) => [d.id, d.province]))

  const agg = new Map<string, { orderCount: number; totalSales: number }>()
  for (const o of orderRows) {
    if (o.status === 'cancelled') continue
    const province = provinceByDealer.get(o.dealerId)
    const region = (province != null ? regionByProvince.get(province) : undefined) ?? NO_REGION
    const cur = agg.get(region) ?? { orderCount: 0, totalSales: 0 }
    cur.orderCount += 1
    cur.totalSales += o.totalValue
    agg.set(region, cur)
  }

  const rows: SalesByRegionRow[] = [...agg.entries()].map(([region, v]) => ({
    region,
    orderCount: v.orderCount,
    totalSales: v.totalSales,
  }))

  rows.sort((a, b) => b.totalSales - a.totalSales || a.region.localeCompare(b.region))

  return { rows }
})
