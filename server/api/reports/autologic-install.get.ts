// GET /api/reports/autologic-install (R-N3) — Dev4, Phase D.
// Admin-only. Autologic install penetration across the VIN population plus a
// list of un-installed VINs as upsell opportunities (sorted by vin asc).
import { db } from '../../db'
import { requireUser } from '../../utils/auth'

interface AutologicSummary {
  total: number
  installed: number
  notInstalled: number
  installRatePct: number
}

interface AutologicOpportunity {
  vin: string
  model: string
  status: string
}

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['admin'])
  void user

  const vinRows = await db.query.vins.findMany()

  const total = vinRows.length
  const installed = vinRows.filter((v) => v.autologicInstalled).length
  const notInstalled = total - installed
  const installRatePct = total > 0 ? Math.round((installed / total) * 100) : 0

  const summary: AutologicSummary = { total, installed, notInstalled, installRatePct }

  const opportunities: AutologicOpportunity[] = vinRows
    .filter((v) => !v.autologicInstalled)
    .map((v) => ({ vin: v.vin, model: v.model, status: v.status }))

  opportunities.sort((a, b) => a.vin.localeCompare(b.vin))

  return { summary, opportunities }
})
