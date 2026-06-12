// GET /api/reports/credit-risk (R-F2) — Dev3, Phase D.
// Admin-only: dealers whose credit utilization exceeds a threshold (default 80).
import { db } from '../../db'
import { requireUser } from '../../utils/auth'

interface RiskRow {
  dealerId: number
  code: string
  name: string
  grade: string
  creditLimit: number
  creditUsed: number
  utilizationPct: number
}

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['admin'])
  void user

  const q = getQuery(event)
  const parsed = Number(q.threshold)
  const threshold = Number.isFinite(parsed) ? parsed : 80

  const dealers = await db.query.dealers.findMany({
    columns: { id: true, code: true, name: true, grade: true, creditLimit: true, creditUsed: true },
  })

  const rows: RiskRow[] = dealers
    .map((d) => ({
      dealerId: d.id,
      code: d.code,
      name: d.name,
      grade: d.grade,
      creditLimit: d.creditLimit,
      creditUsed: d.creditUsed,
      utilizationPct: d.creditLimit > 0 ? Math.round((d.creditUsed / d.creditLimit) * 100) : 0,
    }))
    .filter((r) => r.utilizationPct > threshold)
    .sort((a, b) => b.utilizationPct - a.utilizationPct || a.code.localeCompare(b.code))

  return { threshold, count: rows.length, rows }
})
