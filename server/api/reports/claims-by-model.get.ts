// GET /api/reports/claims-by-model — Dev4, Phase D (defect rate by model).
// Admin-only. Maps each claim.vin → vins.model and counts claims per model.
// Only models with at least one claim appear. Sorted by claimCount desc,
// then model asc.
import { db } from '../../db'
import { requireUser } from '../../utils/auth'

interface ClaimsByModelRow {
  model: string
  claimCount: number
}

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['admin'])
  void user

  const claimRows = await db.query.claims.findMany()
  const vinRows = await db.query.vins.findMany()

  const modelByVin = new Map(vinRows.map((v) => [v.vin, v.model]))

  const agg = new Map<string, number>()
  let totalClaims = 0
  for (const c of claimRows) {
    const model = modelByVin.get(c.vin)
    if (model == null) continue
    agg.set(model, (agg.get(model) ?? 0) + 1)
    totalClaims += 1
  }

  const rows: ClaimsByModelRow[] = [...agg.entries()].map(([model, claimCount]) => ({
    model,
    claimCount,
  }))

  rows.sort((a, b) => b.claimCount - a.claimCount || a.model.localeCompare(b.model))

  return { rows, totalClaims }
})
