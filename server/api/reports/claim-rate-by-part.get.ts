// GET /api/reports/claim-rate-by-part (R-C2) — Dev4, Phase D.
// Admin-only. For each part SKU appearing in claims: claim count vs. qty sold
// (sum of order_items.qty over non-cancelled orders) and the implied claim
// rate (%). Sorted by claimCount desc, then sku asc.
import { db } from '../../db'
import { requireUser } from '../../utils/auth'

interface ClaimRateByPartRow {
  sku: string
  name: string
  claimCount: number
  qtySold: number
  ratePct: number | null
}

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['admin'])
  void user

  const claimRows = await db.query.claims.findMany()
  const partRows = await db.query.parts.findMany()
  const orderRows = await db.query.orders.findMany()
  const itemRows = await db.query.orderItems.findMany()

  // claim counts per sku
  const claimCountBySku = new Map<string, number>()
  for (const c of claimRows) {
    claimCountBySku.set(c.partSku, (claimCountBySku.get(c.partSku) ?? 0) + 1)
  }

  // qty sold per partId over non-cancelled orders
  const liveOrderIds = new Set(
    orderRows.filter((o) => o.status !== 'cancelled').map((o) => o.id),
  )
  const qtySoldByPartId = new Map<number, number>()
  for (const it of itemRows) {
    if (!liveOrderIds.has(it.orderId)) continue
    qtySoldByPartId.set(it.partId, (qtySoldByPartId.get(it.partId) ?? 0) + it.qty)
  }

  const partBySku = new Map(partRows.map((p) => [p.sku, p]))

  const rows: ClaimRateByPartRow[] = []
  for (const [sku, claimCount] of claimCountBySku) {
    const part = partBySku.get(sku)
    const qtySold = part ? qtySoldByPartId.get(part.id) ?? 0 : 0
    const ratePct = qtySold > 0 ? Math.round((claimCount / qtySold) * 10000) / 100 : null
    rows.push({
      sku,
      name: part?.name ?? sku,
      claimCount,
      qtySold,
      ratePct,
    })
  }

  rows.sort((a, b) => b.claimCount - a.claimCount || a.sku.localeCompare(b.sku))

  return { rows }
})
