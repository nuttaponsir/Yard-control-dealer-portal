// GET /api/reports/dealer-mix-by-grade (R-N1) — Dev4, Phase D.
// Admin-only. Dealer count, summed credit limit, and total sales (non-cancelled
// orders) per grade. Always returns all three grades (A, B, C), sorted asc.
import { db } from '../../db'
import { requireUser } from '../../utils/auth'

interface DealerMixByGradeRow {
  grade: string
  dealerCount: number
  sumCreditLimit: number
  totalSales: number
}

const GRADE_ORDER = ['A', 'B', 'C'] as const

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['admin'])
  void user

  const dealerRows = await db.query.dealers.findMany()
  const orderRows = await db.query.orders.findMany()

  const gradeByDealerId = new Map(dealerRows.map((d) => [d.id, d.grade]))

  const agg = new Map<string, { dealerCount: number; sumCreditLimit: number; totalSales: number }>()
  for (const grade of GRADE_ORDER) {
    agg.set(grade, { dealerCount: 0, sumCreditLimit: 0, totalSales: 0 })
  }

  for (const d of dealerRows) {
    const cur = agg.get(d.grade) ?? { dealerCount: 0, sumCreditLimit: 0, totalSales: 0 }
    cur.dealerCount += 1
    cur.sumCreditLimit += d.creditLimit
    agg.set(d.grade, cur)
  }

  for (const o of orderRows) {
    if (o.status === 'cancelled') continue
    const grade = gradeByDealerId.get(o.dealerId)
    if (grade == null) continue
    const cur = agg.get(grade) ?? { dealerCount: 0, sumCreditLimit: 0, totalSales: 0 }
    cur.totalSales += o.totalValue
    agg.set(grade, cur)
  }

  const rows: DealerMixByGradeRow[] = GRADE_ORDER.map((grade) => {
    const v = agg.get(grade) ?? { dealerCount: 0, sumCreditLimit: 0, totalSales: 0 }
    return {
      grade,
      dealerCount: v.dealerCount,
      sumCreditLimit: v.sumCreditLimit,
      totalSales: v.totalSales,
    }
  })

  return { rows }
})
