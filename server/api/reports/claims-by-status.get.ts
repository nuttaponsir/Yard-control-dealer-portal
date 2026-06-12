// GET /api/reports/claims-by-status (R-C1) — Dev4, Phase D.
// Admin-only. Claim counts + total amount per status. Always returns all four
// statuses (zero-filled). Rows sorted by a fixed status order.
import { db } from '../../db'
import { requireUser } from '../../utils/auth'

interface ClaimsByStatusRow {
  status: string
  count: number
  totalAmount: number
}

const STATUS_ORDER = ['submitted', 'reviewing', 'rejected', 'approved'] as const

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['admin'])
  void user

  const claimRows = await db.query.claims.findMany()

  const agg = new Map<string, { count: number; totalAmount: number }>()
  for (const status of STATUS_ORDER) agg.set(status, { count: 0, totalAmount: 0 })
  for (const c of claimRows) {
    const cur = agg.get(c.status) ?? { count: 0, totalAmount: 0 }
    cur.count += 1
    cur.totalAmount += c.amount
    agg.set(c.status, cur)
  }

  const rows: ClaimsByStatusRow[] = STATUS_ORDER.map((status) => {
    const v = agg.get(status) ?? { count: 0, totalAmount: 0 }
    return { status, count: v.count, totalAmount: v.totalAmount }
  })

  const totalClaims = rows.reduce((s, r) => s + r.count, 0)

  return { rows, totalClaims }
})
