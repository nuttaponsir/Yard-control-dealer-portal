// GET /api/reports/ar-aging (R-G1) — Phase G, admin-only.
// Accounts-receivable aging: every order with an outstanding balance bucketed
// by how long it has been unpaid (since createdAt), plus per-bucket totals.
// Buckets: current (0–30 days), 31–60, 61–90, 90+.
import { db } from '../../db'
import { requireUser } from '../../utils/auth'

interface AgingRow {
  orderId: number
  poNumber: string
  dealerId: number
  dealerName: string | null
  totalValue: number
  amountPaid: number
  outstanding: number
  ageDays: number
  bucket: 'current' | 'd31_60' | 'd61_90' | 'd90_plus'
  createdAt: string
}

type Bucket = AgingRow['bucket']

function bucketFor(ageDays: number): Bucket {
  if (ageDays <= 30) return 'current'
  if (ageDays <= 60) return 'd31_60'
  if (ageDays <= 90) return 'd61_90'
  return 'd90_plus'
}

const MS_PER_DAY = 24 * 60 * 60 * 1000

export default defineEventHandler(async (event) => {
  await requireUser(event, ['admin'])

  const orderRows = await db.query.orders.findMany()
  const dealerRows = await db.query.dealers.findMany()
  const dealerName = new Map(dealerRows.map((d) => [d.id, d.name]))

  const now = Date.now()

  const rows: AgingRow[] = orderRows
    // Cancelled orders carry no receivable; only count outstanding balances.
    .filter((o) => o.status !== 'cancelled' && o.totalValue - o.amountPaid > 0)
    .map((o) => {
      const outstanding = o.totalValue - o.amountPaid
      const ageDays = Math.max(0, Math.floor((now - new Date(o.createdAt).getTime()) / MS_PER_DAY))
      return {
        orderId: o.id,
        poNumber: o.poNumber,
        dealerId: o.dealerId,
        dealerName: dealerName.get(o.dealerId) ?? null,
        totalValue: o.totalValue,
        amountPaid: o.amountPaid,
        outstanding,
        ageDays,
        bucket: bucketFor(ageDays),
        createdAt: o.createdAt,
      }
    })
    .sort((a, b) => b.ageDays - a.ageDays || b.outstanding - a.outstanding)

  const totals: Record<Bucket | 'all', number> = {
    current: 0,
    d31_60: 0,
    d61_90: 0,
    d90_plus: 0,
    all: 0,
  }
  for (const r of rows) {
    totals[r.bucket] += r.outstanding
    totals.all += r.outstanding
  }

  return { rows, totals }
})
