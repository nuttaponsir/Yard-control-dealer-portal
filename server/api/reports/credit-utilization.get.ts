// GET /api/reports/credit-utilization (R-F1) — Dev3, Phase D.
// Admin-only: per-dealer credit usage ratio plus network totals.
import { db } from '../../db'
import { requireUser } from '../../utils/auth'

interface UtilizationRow {
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

  const dealers = await db.query.dealers.findMany({
    columns: { id: true, code: true, name: true, grade: true, creditLimit: true, creditUsed: true },
  })

  const rows: UtilizationRow[] = dealers
    .map((d) => ({
      dealerId: d.id,
      code: d.code,
      name: d.name,
      grade: d.grade,
      creditLimit: d.creditLimit,
      creditUsed: d.creditUsed,
      utilizationPct: d.creditLimit > 0 ? Math.round((d.creditUsed / d.creditLimit) * 100) : 0,
    }))
    .sort((a, b) => b.utilizationPct - a.utilizationPct || a.code.localeCompare(b.code))

  const sumLimit = rows.reduce((s, r) => s + r.creditLimit, 0)
  const sumUsed = rows.reduce((s, r) => s + r.creditUsed, 0)
  const avgUtilizationPct = rows.length
    ? Math.round(rows.reduce((s, r) => s + r.utilizationPct, 0) / rows.length)
    : 0

  return { rows, totals: { sumLimit, sumUsed, avgUtilizationPct } }
})
